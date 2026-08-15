using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Srs;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 單字庫（其他功能群 Phase 2）端點：CRUD、到期佇列、四鍵複習（後端 SM-2 排程）、
/// AI 友善補釋義（PAT，VertexAdc＋失敗降級）。
/// 統一 <see cref="ApiResponse{T}"/> 信封；一律軟刪除；多租戶鎖 UserId；時間存 UTC。
/// 所有回傳的 <see cref="VocabularyWordDto"/> 皆帶「四鍵下次排程預覽」（後端權威，與 /review 走同一段計算）。
/// </summary>
public static class VocabularyEndpoints
{
    /// <summary>降級／記錄用的日誌分類名稱。</summary>
    private const string LoggerCategory = "ZonWiki.Api.Endpoints.VocabularyEndpoints";

    /// <summary>單字最大長度（字元；對齊 DB Word HasMaxLength(200)）。</summary>
    private const int MaxWordLength = 200;

    /// <summary>音標最大長度（字元；對齊 DB Phonetic HasMaxLength(128)；超限入庫會觸發 22001→未攔截 500）。</summary>
    private const int MaxPhoneticLength = 128;

    /// <summary>詞性最大長度（字元；對齊 DB PartOfSpeech HasMaxLength(64)；超限入庫會觸發 22001→未攔截 500）。</summary>
    private const int MaxPartOfSpeechLength = 64;

    /// <summary>
    /// 釋義／例句的應用層長度上限（字元）。DefinitionEn／DefinitionZh／ExampleSentence 在 DB 為無界 text，
    /// 但純 CRUD 端點無限流，仍於應用層設界避免被塞爆。
    /// </summary>
    private const int MaxDefinitionLength = 2000;

    /// <summary>AI 補釋義 context 最大長度（字元；比照記帳 MaxParseTextLength）。</summary>
    private const int MaxContextLength = 1000;

    /// <summary>清單／到期佇列未帶 limit 時的預設回傳筆數。</summary>
    private const int DefaultListLimit = 50;

    /// <summary>清單分頁上限。</summary>
    private const int MaxListLimit = 2000;

    /// <summary>到期佇列設定鍵：預設回傳上限。</summary>
    private const string DueQueueLimitConfigKey = "Vocabulary:DueQueueLimit";

    /// <summary>AI 補釋義硬時間預算設定鍵（秒）。</summary>
    private const string EnrichBudgetConfigKey = "Vocabulary:EnrichBudgetSeconds";

    /// <summary>AI 補釋義硬時間預算預設值（秒；補釋義非延遲敏感，給較寬鬆）。</summary>
    private const double DefaultEnrichBudgetSeconds = 15.0;

    /// <summary>AI 補釋義硬時間預算下限（秒）。放寬到 0.2 純為讓「逾時降級」路徑能寫成快速確定性測試；生產維持 10~20。</summary>
    private const double MinEnrichBudgetSeconds = 0.2;

    /// <summary>AI 補釋義硬時間預算上限（秒）。</summary>
    private const double MaxEnrichBudgetSeconds = 30.0;

    /// <summary>ILike 樣式跳脫字元。</summary>
    private const string LikeEscapeChar = "\\";

    /// <summary>
    /// 註冊單字庫相關端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapVocabularyEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/vocabulary", ListHandler);
        app.MapPost("/api/vocabulary", CreateHandler);
        app.MapPut("/api/vocabulary/{id:guid}", UpdateHandler);
        app.MapDelete("/api/vocabulary/{id:guid}", DeleteHandler);
        app.MapGet("/api/vocabulary/due", DueHandler);
        app.MapPost("/api/vocabulary/{id:guid}/review", ReviewHandler);

        // 外部 AI／教練 FC（PAT）：組合限流 marker（TokenBucket＋SlidingWindow 串接的 GlobalLimiter）。
        app.MapPost("/api/ai/vocabulary", AiVocabularyHandler)
            .WithMetadata(new PatAiRateLimitMarker());
    }

    // ── 清單 ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// 列出單字卡（state 篩選＋search＋分頁）。
    /// </summary>
    private static async Task<IResult> ListHandler(
        HttpContext http,
        ZonWikiDbContext db,
        string? state,
        string? search,
        int? limit,
        int? offset,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var query = db.VocabularyWord.IgnoreQueryFilters()
            .Where(v => v.UserId == userId && v.ValidFlag);

        if (!string.IsNullOrWhiteSpace(state))
        {
            if (!TryParseState(state, out var parsedState))
            {
                return Results.Json(
                    ApiResponse<List<VocabularyWordDto>>.Fail("state 須為 new／learning／review／relearning", 400),
                    statusCode: 400);
            }

            query = query.Where(v => v.State == parsedState);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{EscapeLike(search.Trim())}%";
            query = query.Where(v =>
                EF.Functions.ILike(v.Word, pattern, LikeEscapeChar)
                || (v.DefinitionZh != null && EF.Functions.ILike(v.DefinitionZh, pattern, LikeEscapeChar))
                || (v.DefinitionEn != null && EF.Functions.ILike(v.DefinitionEn, pattern, LikeEscapeChar)));
        }

        var total = await query.CountAsync(ct);

        IQueryable<VocabularyWord> pagedQuery = query.OrderByDescending(v => v.CreatedDateTime);
        if (offset.HasValue && offset.Value > 0)
        {
            pagedQuery = pagedQuery.Skip(offset.Value);
        }

        var effectiveLimit = limit.HasValue ? Math.Clamp(limit.Value, 1, MaxListLimit) : DefaultListLimit;
        pagedQuery = pagedQuery.Take(effectiveLimit);

        var rows = await pagedQuery.Select(ProjectRow).ToListAsync(ct);

        var now = DateTime.UtcNow;
        var dtos = rows.Select(r => ToDto(r, now)).ToList();
        return Results.Ok(ApiResponse<List<VocabularyWordDto>>.Ok(dtos, new { total }));
    }

    // ── 建立 ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// 手動新增單字卡（正規化＋復活 upsert；新建回 201、既有/復活回 200）。
    /// </summary>
    private static async Task<IResult> CreateHandler(
        HttpContext http,
        ZonWikiDbContext db,
        VocabularyService vocabularyService,
        CreateVocabularyRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var normalized = VocabularyService.NormalizeWord(request.Word);
        if (normalized.Length == 0)
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail("單字為必填", 400), statusCode: 400);
        }

        if (normalized.Length > MaxWordLength)
        {
            return Results.Json(
                ApiResponse<VocabularyWordDto>.Fail($"單字過長，請縮短到 {MaxWordLength} 字元以內", 400),
                statusCode: 400);
        }

        // 釋義欄長度守門（先擋再 upsert，避免建了卡才回 400 留下孤兒列）。
        var fieldLengthError = ValidateProvidedFieldLengths(
            request.Phonetic,
            request.PartOfSpeech,
            request.DefinitionEn,
            request.DefinitionZh,
            request.ExampleSentence);
        if (fieldLengthError is not null)
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail(fieldLengthError, 400), statusCode: 400);
        }

        // 若指定來源筆記，須屬本人且有效。
        if (request.SourceNoteId is Guid noteId && !await NoteBelongsToUserAsync(db, userId, noteId, ct))
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail("來源筆記不存在或不屬於你", 400), statusCode: 400);
        }

        var upsert = await vocabularyService.UpsertAsync(userId, normalized, ct);
        var card = upsert.Word;

        // 套用請求帶的釋義欄與來源筆記（手動新增：直接以請求值覆寫）。
        ApplyProvidedFields(
            card,
            request.Phonetic,
            request.PartOfSpeech,
            request.DefinitionEn,
            request.DefinitionZh,
            request.ExampleSentence,
            request.SourceNoteId);
        card.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        var dto = await LoadDtoAsync(db, userId, card.Id, ct);
        return upsert.Created
            ? Results.Created($"/api/vocabulary/{card.Id}", ApiResponse<VocabularyWordDto>.Ok(dto!))
            : Results.Ok(ApiResponse<VocabularyWordDto>.Ok(dto!));
    }

    // ── 更新 ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// 更新單字卡（只改有給的欄位；Word 不可改）。
    /// </summary>
    private static async Task<IResult> UpdateHandler(
        HttpContext http,
        ZonWikiDbContext db,
        VocabularyService vocabularyService,
        Guid id,
        UpdateVocabularyRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var card = await vocabularyService.FindByIdAsync(userId, id, ct);
        if (card is null)
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail("單字卡不存在", 404), statusCode: 404);
        }

        // 釋義欄長度守門（更新路徑同樣擋，避免超長值入庫觸發 22001→未攔截 500）。
        var fieldLengthError = ValidateProvidedFieldLengths(
            request.Phonetic,
            request.PartOfSpeech,
            request.DefinitionEn,
            request.DefinitionZh,
            request.ExampleSentence);
        if (fieldLengthError is not null)
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail(fieldLengthError, 400), statusCode: 400);
        }

        if (request.SourceNoteId is Guid noteId && !await NoteBelongsToUserAsync(db, userId, noteId, ct))
        {
            return Results.Json(ApiResponse<VocabularyWordDto>.Fail("來源筆記不存在或不屬於你", 400), statusCode: 400);
        }

        ApplyProvidedFields(
            card,
            request.Phonetic,
            request.PartOfSpeech,
            request.DefinitionEn,
            request.DefinitionZh,
            request.ExampleSentence,
            request.SourceNoteId);
        card.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        var dto = await LoadDtoAsync(db, userId, card.Id, ct);
        return Results.Ok(ApiResponse<VocabularyWordDto>.Ok(dto!));
    }

    // ── 軟刪除 ───────────────────────────────────────────────────────────────

    /// <summary>
    /// 軟刪除一張單字卡。
    /// </summary>
    private static async Task<IResult> DeleteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        VocabularyService vocabularyService,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var card = await vocabularyService.FindByIdAsync(userId, id, ct);
        if (card is null)
        {
            return Results.Json(ApiResponse<object>.Fail("單字卡不存在", 404), statusCode: 404);
        }

        card.ValidFlag = false;
        card.DeletedDateTime = DateTime.UtcNow;
        card.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }

    // ── 到期佇列 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 今日到期複習佇列（Due≤now，Due 升序）。
    /// </summary>
    private static async Task<IResult> DueHandler(
        HttpContext http,
        ZonWikiDbContext db,
        IConfiguration configuration,
        int? limit,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var now = DateTime.UtcNow;
        var defaultLimit = configuration.GetValue<int?>(DueQueueLimitConfigKey) ?? DefaultListLimit;
        var effectiveLimit = limit.HasValue ? Math.Clamp(limit.Value, 1, MaxListLimit) : Math.Clamp(defaultLimit, 1, MaxListLimit);

        var rows = await db.VocabularyWord.IgnoreQueryFilters()
            .Where(v => v.UserId == userId && v.ValidFlag && v.Due <= now)
            .OrderBy(v => v.Due)
            .Take(effectiveLimit)
            .Select(ProjectRow)
            .ToListAsync(ct);

        var dtos = rows.Select(r => ToDto(r, now)).ToList();
        return Results.Ok(ApiResponse<List<VocabularyWordDto>>.Ok(dtos, new { total = dtos.Count }));
    }

    // ── 複習（後端 SM-2 排程）──────────────────────────────────────────────────

    /// <summary>
    /// 四鍵評分→後端跑 SM-2 更新排程→回更新後的卡（含下一次的四鍵預覽）。
    /// </summary>
    private static async Task<IResult> ReviewHandler(
        HttpContext http,
        ZonWikiDbContext db,
        VocabularyService vocabularyService,
        Guid id,
        ReviewVocabularyRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        VocabularyRating rating;
        try
        {
            rating = Sm2Scheduler.ParseRating(request.Rating);
        }
        catch (ArgumentException)
        {
            return Results.Json(
                ApiResponse<ReviewVocabularyResponseDto>.Fail("rating 須為 again／hard／good／easy", 400),
                statusCode: 400);
        }

        var card = await vocabularyService.FindByIdAsync(userId, id, ct);
        if (card is null)
        {
            return Results.Json(ApiResponse<ReviewVocabularyResponseDto>.Fail("單字卡不存在", 404), statusCode: 404);
        }

        var now = DateTime.UtcNow;
        var current = ToSm2State(card);
        var result = Sm2Scheduler.Review(current, rating);

        // 寫回 SRS 欄位（後端計算為準，DB-as-truth）。
        card.Difficulty = result.EasinessFactor;
        card.Reps = result.Repetitions;
        card.Lapses = result.Lapses;
        card.Stability = result.IntervalDays;
        card.State = result.State;
        card.Due = now.AddDays(result.IntervalDays);
        card.LastReviewDateTime = now;
        card.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        var dto = await LoadDtoAsync(db, userId, card.Id, ct);
        return Results.Ok(ApiResponse<ReviewVocabularyResponseDto>.Ok(new ReviewVocabularyResponseDto(dto!)));
    }

    // ── AI 補釋義（PAT）───────────────────────────────────────────────────────

    /// <summary>
    /// AI 友善端點（教練 FC／外部 AI PAT）：只給 word＋context，後端 upsert（word 永不丟失）＋VertexAdc 補釋義。
    /// 逾時／壞 JSON／供應者不可用一律降級（word 已存、Enriched=false），絕不回 500。
    /// </summary>
    private static async Task<IResult> AiVocabularyHandler(
        HttpContext http,
        ZonWikiDbContext db,
        VocabularyService vocabularyService,
        VocabularyEnrichmentService enrichmentService,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        AiVocabularyRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var normalized = VocabularyService.NormalizeWord(request.Word);
        if (normalized.Length == 0)
        {
            return Results.Json(ApiResponse<AiVocabularyResponseDto>.Fail("單字為必填", 400), statusCode: 400);
        }

        if (normalized.Length > MaxWordLength)
        {
            return Results.Json(
                ApiResponse<AiVocabularyResponseDto>.Fail($"單字過長，請縮短到 {MaxWordLength} 字元以內", 400),
                statusCode: 400);
        }

        var context = request.Context?.Trim();
        if (context is not null && context.Length > MaxContextLength)
        {
            return Results.Json(
                ApiResponse<AiVocabularyResponseDto>.Fail($"上下文過長，請縮短到 {MaxContextLength} 字元以內", 400),
                statusCode: 400);
        }

        var logger = loggerFactory.CreateLogger(LoggerCategory);

        // 步驟 1：先 upsert（word 永不丟失；復活軟刪列）。
        var upsert = await vocabularyService.UpsertAsync(userId, normalized, ct);
        var card = upsert.Word;

        // 步驟 2：以「硬時間預算」跑補釋義；逾時／壞 JSON／供應者建構失敗一律吞成降級（絕不回 500）。
        var enriched = await TryEnrichAsync(
            db, enrichmentService, configuration, logger, userId, card, normalized, context, ct);

        var dto = await LoadDtoAsync(db, userId, card.Id, CancellationToken.None);
        var message = enriched ? "已加入單字庫並補上釋義" : "已加入單字庫，稍後可補釋義";
        return Results.Ok(ApiResponse<AiVocabularyResponseDto>.Ok(new AiVocabularyResponseDto(dto!, enriched, message)));
    }

    /// <summary>
    /// 以硬時間預算補釋義並套用（只填「原本為空」的欄位，不覆蓋使用者既有內容）。
    /// 逾時／壞 JSON／供應者建構失敗（ADC 不可用等 InvalidOperationException）／Error 事件 → 一律 catch 吞成降級。
    /// 超長的 Phonetic／PartOfSpeech（超過 DB 欄長）一律「跳過該欄」不入庫；apply-and-save 整段另包降級
    /// try/catch，DbUpdateException 也降級成「未補釋義」（word 已存、絕不 500）。
    /// 保底不需重寫 word（upsert 已存）；成功套用的存檔用 <see cref="CancellationToken.None"/>（避免逾時 CTS 讓 SaveChanges 立即取消）。
    /// </summary>
    /// <returns>是否實際補上任一釋義欄（true＝Enriched；LLM 僅吐超長值全被跳過時＝false）。</returns>
    private static async Task<bool> TryEnrichAsync(
        ZonWikiDbContext db,
        VocabularyEnrichmentService enrichmentService,
        IConfiguration configuration,
        ILogger logger,
        Guid userId,
        VocabularyWord card,
        string word,
        string? context,
        CancellationToken requestAborted)
    {
        var budgetSeconds = ResolveEnrichBudgetSeconds(configuration);
        using var budgetCts = new CancellationTokenSource(TimeSpan.FromSeconds(budgetSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, budgetCts.Token);

        VocabularyEnrichmentOutcome outcome;
        try
        {
            outcome = await enrichmentService.EnrichAsync(userId, word, context, linkedCts.Token);
        }
        catch (Exception exception)
        {
            if (exception is OperationCanceledException && budgetCts.IsCancellationRequested)
            {
                logger.LogInformation("單字補釋義逾時（budget={BudgetSeconds}s），降級（word 已存）。", budgetSeconds);
            }
            else
            {
                logger.LogWarning(exception, "單字補釋義失敗，降級（word 已存）。");
            }

            return false;
        }

        if (!outcome.Success)
        {
            return false;
        }

        // apply-and-save 整段包在降級 try/catch 內：即使某欄仍導致 DB 寫入失敗（DbUpdateException），
        // 也降級成 Enriched=false（word 已存、絕不 500），而非讓例外冒出成未攔截 500。
        try
        {
            // 只填「原本為空」的欄位（不覆蓋使用者既有內容）。
            // Phonetic／PartOfSpeech 有 DB 長度上限：LLM 可能被 context prompt injection 吐超長值，
            // 超過上限就「跳過該欄」（不入庫），避免寫入時觸發 Postgres 22001（值超出欄長）→ 未攔截 500。
            var changed = false;
            if (string.IsNullOrWhiteSpace(card.Phonetic)
                && !string.IsNullOrWhiteSpace(outcome.Phonetic)
                && outcome.Phonetic.Length <= MaxPhoneticLength)
            {
                card.Phonetic = outcome.Phonetic;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(card.PartOfSpeech)
                && !string.IsNullOrWhiteSpace(outcome.PartOfSpeech)
                && outcome.PartOfSpeech.Length <= MaxPartOfSpeechLength)
            {
                card.PartOfSpeech = outcome.PartOfSpeech;
                changed = true;
            }

            // 釋義／例句在 DB 為無界 text（無長度上限），照原邏輯只填空欄。
            if (string.IsNullOrWhiteSpace(card.DefinitionEn) && !string.IsNullOrWhiteSpace(outcome.DefinitionEn))
            {
                card.DefinitionEn = outcome.DefinitionEn;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(card.DefinitionZh) && !string.IsNullOrWhiteSpace(outcome.DefinitionZh))
            {
                card.DefinitionZh = outcome.DefinitionZh;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(card.ExampleSentence) && !string.IsNullOrWhiteSpace(outcome.ExampleSentence))
            {
                card.ExampleSentence = outcome.ExampleSentence;
                changed = true;
            }

            if (changed)
            {
                card.UpdatedUser = userId.ToString();
                // 關鍵：用 CancellationToken.None（非已逾時的 linked token），確保補上的釋義一定寫得進去。
                await db.SaveChangesAsync(CancellationToken.None);
            }

            // Enriched 真實反映「本次是否寫入任一釋義欄」：LLM 只吐超長值（全被跳過）時＝未補釋義。
            return changed;
        }
        catch (DbUpdateException exception)
        {
            logger.LogWarning(exception, "單字補釋義寫入失敗，降級（word 已存、僅不填釋義）。");
            return false;
        }
    }

    // ── 共用工具 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 驗證手動 CRUD 帶入的釋義欄長度（比照既有 Word／Context 的長度守門）。
    /// Phonetic／PartOfSpeech 有 DB 長度上限（超限入庫會觸發 Postgres 22001→未攔截 500，故須先擋）；
    /// DefinitionEn／DefinitionZh／ExampleSentence 雖為無界 text，仍於應用層設界避免被塞爆。
    /// </summary>
    /// <param name="phonetic">音標（可空）。</param>
    /// <param name="partOfSpeech">詞性（可空）。</param>
    /// <param name="definitionEn">英文釋義（可空）。</param>
    /// <param name="definitionZh">中文釋義（可空）。</param>
    /// <param name="exampleSentence">例句（可空）。</param>
    /// <returns>第一個超限欄位的中文錯誤訊息（端點據此回 400）；全部合法回 null。</returns>
    private static string? ValidateProvidedFieldLengths(
        string? phonetic,
        string? partOfSpeech,
        string? definitionEn,
        string? definitionZh,
        string? exampleSentence)
    {
        if (phonetic is { Length: > MaxPhoneticLength })
        {
            return $"音標過長，請縮短到 {MaxPhoneticLength} 字元以內";
        }

        if (partOfSpeech is { Length: > MaxPartOfSpeechLength })
        {
            return $"詞性過長，請縮短到 {MaxPartOfSpeechLength} 字元以內";
        }

        if (definitionEn is { Length: > MaxDefinitionLength })
        {
            return $"英文釋義過長，請縮短到 {MaxDefinitionLength} 字元以內";
        }

        if (definitionZh is { Length: > MaxDefinitionLength })
        {
            return $"中文釋義過長，請縮短到 {MaxDefinitionLength} 字元以內";
        }

        if (exampleSentence is { Length: > MaxDefinitionLength })
        {
            return $"例句過長，請縮短到 {MaxDefinitionLength} 字元以內";
        }

        return null;
    }

    /// <summary>套用請求帶的釋義欄與來源筆記（只在「本次有提供＝非 null」時覆寫；Word 不在此處理）。</summary>
    private static void ApplyProvidedFields(
        VocabularyWord card,
        string? phonetic,
        string? partOfSpeech,
        string? definitionEn,
        string? definitionZh,
        string? exampleSentence,
        Guid? sourceNoteId)
    {
        if (phonetic is not null)
        {
            card.Phonetic = phonetic;
        }

        if (partOfSpeech is not null)
        {
            card.PartOfSpeech = partOfSpeech;
        }

        if (definitionEn is not null)
        {
            card.DefinitionEn = definitionEn;
        }

        if (definitionZh is not null)
        {
            card.DefinitionZh = definitionZh;
        }

        if (exampleSentence is not null)
        {
            card.ExampleSentence = exampleSentence;
        }

        if (sourceNoteId is Guid noteId)
        {
            card.SourceNoteId = noteId;
        }
    }

    /// <summary>載入單張卡並映射成 DTO（含來源筆記 slug/title 與四鍵排程預覽）。</summary>
    private static async Task<VocabularyWordDto?> LoadDtoAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid cardId,
        CancellationToken ct)
    {
        var row = await db.VocabularyWord.IgnoreQueryFilters()
            .Where(v => v.Id == cardId && v.UserId == userId)
            .Select(ProjectRow)
            .FirstOrDefaultAsync(ct);

        return row is null ? null : ToDto(row, DateTime.UtcNow);
    }

    /// <summary>EF 投影：單字卡 → 中繼列（含來源筆記 slug/title）。</summary>
    private static readonly System.Linq.Expressions.Expression<Func<VocabularyWord, VocabularyRow>> ProjectRow =
        v => new VocabularyRow(
            v.Id,
            v.Word,
            v.Phonetic,
            v.PartOfSpeech,
            v.DefinitionEn,
            v.DefinitionZh,
            v.ExampleSentence,
            v.SourceNoteId,
            v.SourceNote != null ? v.SourceNote.Slug : null,
            v.SourceNote != null ? v.SourceNote.Title : null,
            v.Due,
            v.Stability,
            v.Difficulty,
            v.State,
            v.Reps,
            v.Lapses,
            v.LastReviewDateTime,
            v.CreatedDateTime);

    /// <summary>把中繼列映射成回應 DTO（計算四鍵排程預覽：now + 各鍵下次間隔）。</summary>
    private static VocabularyWordDto ToDto(VocabularyRow row, DateTime now)
    {
        var current = new Sm2State(row.Difficulty, row.Reps, row.Lapses, row.Stability, row.State);
        var preview = Sm2Scheduler.PreviewIntervals(current);

        var schedulePreview = new Dictionary<string, SchedulePreviewDto>(StringComparer.Ordinal)
        {
            ["again"] = ToPreviewDto(now, preview[VocabularyRating.Again]),
            ["hard"] = ToPreviewDto(now, preview[VocabularyRating.Hard]),
            ["good"] = ToPreviewDto(now, preview[VocabularyRating.Good]),
            ["easy"] = ToPreviewDto(now, preview[VocabularyRating.Easy]),
        };

        return new VocabularyWordDto(
            row.Id,
            row.Word,
            row.Phonetic,
            row.PartOfSpeech,
            row.DefinitionEn,
            row.DefinitionZh,
            row.ExampleSentence,
            row.SourceNoteId,
            row.SourceNoteSlug,
            row.SourceNoteTitle,
            row.Due,
            row.Stability,
            row.Difficulty,
            StateToString(row.State),
            row.Reps,
            row.Lapses,
            row.LastReviewDateTime,
            row.CreatedDateTime,
            schedulePreview);
    }

    /// <summary>單一鍵的排程預覽 DTO（Due＝now + 間隔天數）。</summary>
    private static SchedulePreviewDto ToPreviewDto(DateTime now, double intervalDays)
        => new(intervalDays, now.AddDays(intervalDays));

    /// <summary>把單字卡的 SRS 欄位組成 <see cref="Sm2State"/>。</summary>
    private static Sm2State ToSm2State(VocabularyWord card)
        => new(card.Difficulty, card.Reps, card.Lapses, card.Stability, card.State);

    /// <summary>卡片狀態列舉→字串。</summary>
    private static string StateToString(VocabularyReviewState state) => state switch
    {
        VocabularyReviewState.New => "new",
        VocabularyReviewState.Learning => "learning",
        VocabularyReviewState.Review => "review",
        VocabularyReviewState.Relearning => "relearning",
        _ => "new",
    };

    /// <summary>解析 state 篩選字串（大小寫不敏感）為卡片狀態列舉；非法回 false。</summary>
    private static bool TryParseState(string raw, out VocabularyReviewState state)
    {
        switch (raw.Trim().ToLowerInvariant())
        {
            case "new":
                state = VocabularyReviewState.New;
                return true;
            case "learning":
                state = VocabularyReviewState.Learning;
                return true;
            case "review":
                state = VocabularyReviewState.Review;
                return true;
            case "relearning":
                state = VocabularyReviewState.Relearning;
                return true;
            default:
                state = VocabularyReviewState.New;
                return false;
        }
    }

    /// <summary>解析 AI 補釋義的硬時間預算（秒），夾在 [Min, Max]。</summary>
    private static double ResolveEnrichBudgetSeconds(IConfiguration configuration)
    {
        var configured = configuration.GetValue<double?>(EnrichBudgetConfigKey) ?? DefaultEnrichBudgetSeconds;
        return Math.Clamp(configured, MinEnrichBudgetSeconds, MaxEnrichBudgetSeconds);
    }

    /// <summary>檢查來源筆記是否屬於使用者且有效。</summary>
    private static Task<bool> NoteBelongsToUserAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid noteId,
        CancellationToken ct)
        => db.Note.IgnoreQueryFilters()
            .AnyAsync(n => n.Id == noteId && n.UserId == userId && n.ValidFlag, ct);

    /// <summary>
    /// 跳脫 ILike 樣式中的特殊字元（% _ \），避免使用者輸入被當成萬用字元。
    /// 搭配 <see cref="LikeEscapeChar"/> 使用。
    /// </summary>
    private static string EscapeLike(string term)
        => term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>自 HttpContext 取使用者 Id（Cookie 或 PAT 皆帶 user_id 宣告）；缺失回 Guid.Empty。</summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return !string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId)
            ? userId
            : Guid.Empty;
    }

    /// <summary>統一 401 回應。</summary>
    private static IResult Unauthorized()
        => Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);

    /// <summary>清單／單筆查詢的中繼投影列（供 EF 投影後在記憶體映射 DTO 與計算排程預覽）。</summary>
    private sealed record VocabularyRow(
        Guid Id,
        string Word,
        string? Phonetic,
        string? PartOfSpeech,
        string? DefinitionEn,
        string? DefinitionZh,
        string? ExampleSentence,
        Guid? SourceNoteId,
        string? SourceNoteSlug,
        string? SourceNoteTitle,
        DateTime Due,
        double Stability,
        double Difficulty,
        VocabularyReviewState State,
        int Reps,
        int Lapses,
        DateTime? LastReviewDateTime,
        DateTime CreatedDateTime);
}
