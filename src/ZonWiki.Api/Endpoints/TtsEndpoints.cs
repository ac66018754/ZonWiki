using System.Data.Common;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tts;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// TTS 子系統（其他功能群 Phase 2）端點：觸發合成、狀態輪詢、授權供檔（HTTP Range）、聲音清單、TTS 偏好設定。
///
/// v1 穩健路線（監工裁定）：背景合成全部段落 → ffmpeg 併成單一 MP3 → 授權供檔＋HTTP Range。
/// 統一 <see cref="ApiResponse{T}"/> 信封（供檔端點除外，回二進位）；一律鎖 UserId；時間存 UTC。
///
/// <b>前端契約鎖定（審查修正）</b>：合成／狀態回應的音檔主鍵欄名為 <c>ttsAudioId</c>（#1）、
/// 章節時間欄名為 <c>startSeconds</c>（#2）、聲音顯示標籤欄名為 <c>label</c>（#7）——皆與前端契約一致。
/// </summary>
public static class TtsEndpoints
{
    /// <summary>降級／記錄用的日誌分類名稱。</summary>
    private const string LoggerCategory = "ZonWiki.Api.Endpoints.TtsEndpoints";

    /// <summary>系統預設聲音設定鍵。</summary>
    private const string DefaultVoiceConfigKey = "Tts:DefaultVoice";

    /// <summary>系統預設語言設定鍵。</summary>
    private const string DefaultLanguageConfigKey = "Tts:DefaultLanguage";

    /// <summary>系統預設格式設定鍵。</summary>
    private const string DefaultFormatConfigKey = "Tts:DefaultFormat";

    /// <summary>系統預設聲音保底值（recon 實打 cmn-TW 200 的女聲）。</summary>
    private const string FallbackVoice = "Kore";

    /// <summary>系統預設語言保底值。</summary>
    private const string FallbackLanguage = "cmn-TW";

    /// <summary>系統預設格式保底值（MP3 保底、OGG_OPUS 進階）。</summary>
    private const string FallbackFormat = "MP3";

    /// <summary>反序列化 TTS 設定 JSON 的選項（camelCase、不分大小寫）。</summary>
    private static readonly JsonSerializerOptions SettingsJsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// 註冊 TTS 相關端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapTtsEndpoints(this IEndpointRouteBuilder app)
    {
        // 觸發合成：會打付費 TTS → 掛 AiPolicy 限流（防迴圈灌爆）。
        app.MapPost("/api/tts/notes/{noteId:guid}/synthesize", SynthesizeHandler)
            .RequireRateLimiting(RateLimitingExtensions.AiPolicy);

        app.MapGet("/api/tts/audio/{id:guid}/status", StatusHandler);
        app.MapGet("/api/tts/audio/{id:guid}", ServeAudioHandler);
        app.MapGet("/api/tts/voices", VoicesHandler);
        app.MapGet("/api/me/tts-settings", GetSettingsHandler);
        app.MapPut("/api/me/tts-settings", UpdateSettingsHandler);
    }

    // ── POST /synthesize（快取決策表＋背景合成）─────────────────────────────────

    /// <summary>
    /// 觸發（或取用快取）筆記朗讀合成。快取命中回 200 ready；合成中／新建回 202 processing。
    /// </summary>
    private static async Task<IResult> SynthesizeHandler(
        HttpContext http,
        ZonWikiDbContext db,
        TtsSynthesisService synthesisService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        IConfiguration configuration,
        IWebHostEnvironment environment,
        Guid noteId,
        TtsSynthesizeRequest? request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        // 驗筆記本人＋有效（否則 404，不洩漏他人存在）。
        var note = await db.Note.IgnoreQueryFilters()
            .FirstOrDefaultAsync(n => n.Id == noteId && n.UserId == userId && n.ValidFlag, ct);
        if (note is null)
        {
            return Results.Json(ApiResponse<TtsSynthesizeResponseDto>.Fail("筆記不存在或不屬於你", 404), statusCode: 404);
        }

        // 資源/成本上限（審查修正 #3-①）：拒絕過大筆記，避免 fan-out 成不設上限的逐塊付費 TTS。
        var maxContentBytes = synthesisService.ResolveMaxNoteContentBytes();
        if (Encoding.UTF8.GetByteCount(note.ContentRaw ?? string.Empty) > maxContentBytes)
        {
            return Results.Json(
                ApiResponse<TtsSynthesizeResponseDto>.Fail(
                    $"筆記內容過長，超過單次朗讀上限（約 {maxContentBytes / 1024} KB），請縮短內容後再試。", 400),
                statusCode: 400);
        }

        // 解析 voice/language/format：request → 使用者設定 → 系統預設；並驗白名單（含 language，審查修正 #4）。
        var userSettings = await db.User.Where(u => u.Id == userId)
            .Select(u => u.TtsSettingsJson).FirstOrDefaultAsync(ct);
        var (voice, language, format, validationError) = ResolveVoiceLanguageFormat(request, userSettings, configuration);
        if (validationError is not null)
        {
            return Results.Json(ApiResponse<TtsSynthesizeResponseDto>.Fail(validationError, 400), statusCode: 400);
        }

        var modelName = synthesisService.ResolveModelName();
        var contentHash = TtsSynthesisService.ComputeContentHash(
            note.ContentRaw, voice, language, format, TtsScriptService.PromptVersion, modelName);

        var existing = await db.TtsAudio.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.UserId == userId && t.ContentHash == contentHash, ct);

        if (existing is not null)
        {
            // 快取命中（ready）：實體檔仍在才回 ready；檔案被清（磁碟清理／外部移除）則自我修復重跑（審查修正 #6）。
            if (existing is { ValidFlag: true, Status: "ready" })
            {
                if (ReadyFileExists(environment, existing))
                {
                    return ReadyResult(existing);
                }

                // 檔案遺失 → 條件式原子搶佔（ready→processing），受並發上限保護（審查修正 #1/#3/#6）。
                if (!await CanLaunchWithinConcurrencyLimitAsync(db, synthesisService, userId, existing.Id, ct))
                {
                    return TooManyProcessing();
                }

                if (await TryClaimReadyMissingFileAsync(db, existing.Id, userId, voice, modelName, ct))
                {
                    LaunchBackgroundSynthesis(
                        scopeFactory, loggerFactory, synthesisService, existing.Id, userId, noteId, voice, language, format);
                }

                // 搶到→已啟動；沒搶到→另一近同時請求已搶先重跑 → in-flight 合流。皆回 202。
                return Accepted(existing.Id);
            }

            // 合成中（未逾陳舊門檻）→ in-flight 合流，不重跑（未新增背景工作，不受並發上限影響）。
            if (existing is { ValidFlag: true, Status: "processing" } && !IsStaleProcessing(existing, synthesisService))
            {
                return Accepted(existing.Id);
            }

            // failed／陳舊 processing／軟刪列 → 重用重跑。先擋並發上限（本列自身若在算，不計入）。
            if (!await CanLaunchWithinConcurrencyLimitAsync(db, synthesisService, userId, existing.Id, ct))
            {
                return TooManyProcessing();
            }

            // 條件式原子轉換（審查修正 #1）：以 ExecuteUpdateAsync 只讓「贏得轉換」的請求（受影響列數==1）啟背景工作，
            // 沒贏的視為 in-flight 合流回 202；杜絕兩條近同時 POST 各自啟背景管線跑同一 row／同一檔造成資料損毀。
            var staleThreshold = DateTime.UtcNow.AddSeconds(-synthesisService.ResolveSynthesisBudgetSeconds());
            if (await TryClaimForRerunAsync(db, existing.Id, userId, voice, modelName, staleThreshold, ct))
            {
                LaunchBackgroundSynthesis(
                    scopeFactory, loggerFactory, synthesisService, existing.Id, userId, noteId, voice, language, format);
            }

            return Accepted(existing.Id);
        }

        // 未命中：先擋並發上限，再失效同筆記＋聲音的不同 hash 舊列（軟刪＋刪實體檔），最後建新 processing 列。
        if (!await CanLaunchWithinConcurrencyLimitAsync(db, synthesisService, userId, Guid.Empty, ct))
        {
            return TooManyProcessing();
        }

        await synthesisService.InvalidateOtherVersionsAsync(userId, noteId, voice, contentHash, ct);

        var row = new TtsAudio
        {
            UserId = userId,
            NoteId = noteId,
            ContentHash = contentHash,
            ScriptJson = string.Empty,
            Status = "processing",
            VoiceName = voice,
            ModelKey = modelName,
            FilePath = string.Empty,
            ContentType = TtsSynthesisService.ResolveFormat(format).Mime,
            CreatedUser = userId.ToString(),
            UpdatedUser = userId.ToString(),
        };
        db.TtsAudio.Add(row);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // 並發首建撞 (UserId, ContentHash) 唯一索引：卸掉本次新列，改查既有列回其狀態。
            db.Entry(row).State = EntityState.Detached;
            var raced = await db.TtsAudio.IgnoreQueryFilters()
                .FirstOrDefaultAsync(t => t.UserId == userId && t.ContentHash == contentHash, ct);
            if (raced is null)
            {
                throw;
            }

            return raced is { ValidFlag: true, Status: "ready" } && ReadyFileExists(environment, raced)
                ? ReadyResult(raced)
                : Accepted(raced.Id);
        }

        LaunchBackgroundSynthesis(
            scopeFactory, loggerFactory, synthesisService, row.Id, userId, noteId, voice, language, format);
        return Accepted(row.Id);
    }

    /// <summary>快取命中（ready）的 200 回應（帶章節/時長，供前端「重播零成本」路徑消費）。</summary>
    private static IResult ReadyResult(TtsAudio row)
        => Results.Ok(ApiResponse<TtsSynthesizeResponseDto>.Ok(
            new TtsSynthesizeResponseDto(
                row.Id, "ready", row.DurationSeconds, DeserializeChapters(row.ChaptersJson))));

    /// <summary>檢查 ready 列的實體檔是否仍存在（審查修正 #6：避免回報就緒卻播不出）。</summary>
    private static bool ReadyFileExists(IWebHostEnvironment environment, TtsAudio row)
        => !string.IsNullOrEmpty(row.FilePath)
            && File.Exists(Path.Combine(environment.ContentRootPath, row.FilePath));

    /// <summary>
    /// 檢查是否還在「單一使用者同時 processing 列數」上限內（審查修正 #3-③）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="synthesisService">供解析上限設定值。</param>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="excludeId">要排除計數的列 Id（重用既有列時傳其 Id，避免把自己算進去；新建時傳 <see cref="Guid.Empty"/>）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>仍在上限內（可啟動新背景工作）時為 true。</returns>
    private static async Task<bool> CanLaunchWithinConcurrencyLimitAsync(
        ZonWikiDbContext db,
        TtsSynthesisService synthesisService,
        Guid userId,
        Guid excludeId,
        CancellationToken ct)
    {
        var maxConcurrent = synthesisService.ResolveMaxConcurrentProcessingPerUser();
        var activeProcessing = await db.TtsAudio.IgnoreQueryFilters()
            .CountAsync(
                t => t.UserId == userId && t.ValidFlag && t.Status == "processing" && t.Id != excludeId, ct);
        return activeProcessing < maxConcurrent;
    }

    /// <summary>
    /// 條件式原子搶佔「failed／陳舊 processing／軟刪列」重跑（審查修正 #1）：
    /// 以單一 <c>UPDATE ... WHERE</c>（<see cref="RelationalQueryableExtensions.ExecuteUpdateAsync"/>）轉為 processing，
    /// WHERE 僅匹配「可重用」狀態；DB 會序列化並發 UPDATE，故只有一個請求受影響列數==1（贏得轉換）。
    /// 註：ExecuteUpdate 繞過稽核攔截器，故手動寫 UpdatedDateTime/UpdatedUser。
    /// </summary>
    /// <returns>本請求贏得轉換（可啟動背景工作）時為 true。</returns>
    private static Task<bool> TryClaimForRerunAsync(
        ZonWikiDbContext db,
        Guid id,
        Guid userId,
        string voice,
        string modelName,
        DateTime staleThreshold,
        CancellationToken ct)
    {
        var query = db.TtsAudio.IgnoreQueryFilters()
            .Where(t => t.Id == id
                && t.UserId == userId
                && (!t.ValidFlag
                    || t.Status == "failed"
                    || (t.Status == "processing" && t.UpdatedDateTime < staleThreshold)));
        return ExecuteClaimAsync(query, voice, modelName, userId, ct);
    }

    /// <summary>
    /// 條件式原子搶佔「ready 但實體檔遺失」列重跑（審查修正 #6，配合 #1 的並發安全）：
    /// WHERE 僅匹配 <c>Status == "ready"</c>，故第一個請求把它轉成 processing 後，其餘近同時請求受影響列數==0 而合流。
    /// </summary>
    /// <returns>本請求贏得轉換（可啟動背景工作）時為 true。</returns>
    private static Task<bool> TryClaimReadyMissingFileAsync(
        ZonWikiDbContext db,
        Guid id,
        Guid userId,
        string voice,
        string modelName,
        CancellationToken ct)
    {
        var query = db.TtsAudio.IgnoreQueryFilters()
            .Where(t => t.Id == id && t.UserId == userId && t.Status == "ready");
        return ExecuteClaimAsync(query, voice, modelName, userId, ct);
    }

    /// <summary>執行「轉為 processing」的原子 UPDATE，回傳是否恰好搶到一列（受影響列數==1）。</summary>
    private static async Task<bool> ExecuteClaimAsync(
        IQueryable<TtsAudio> claimQuery,
        string voice,
        string modelName,
        Guid userId,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var affected = await claimQuery.ExecuteUpdateAsync(
            setters => setters
                .SetProperty(t => t.Status, "processing")
                .SetProperty(t => t.ValidFlag, true)
                .SetProperty(t => t.DeletedDateTime, (DateTime?)null)
                .SetProperty(t => t.ErrorText, (string?)null)
                .SetProperty(t => t.VoiceName, voice)
                .SetProperty(t => t.ModelKey, modelName)
                .SetProperty(t => t.UpdatedDateTime, now)
                .SetProperty(t => t.UpdatedUser, userId.ToString()),
            ct);
        return affected == 1;
    }

    /// <summary>429：單一使用者同時進行的合成過多（審查修正 #3-③）。</summary>
    private static IResult TooManyProcessing()
        => Results.Json(
            ApiResponse<TtsSynthesizeResponseDto>.Fail("同時進行的朗讀合成過多，請稍候再試。", 429),
            statusCode: StatusCodes.Status429TooManyRequests);

    // ── GET /status ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 狀態輪詢：回本人音檔列的合成狀態（含章節與時長）。他人／不存在 → 404。
    /// </summary>
    private static async Task<IResult> StatusHandler(
        HttpContext http,
        ZonWikiDbContext db,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var row = await db.TtsAudio.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId && t.ValidFlag, ct);
        if (row is null)
        {
            return Results.Json(ApiResponse<TtsStatusDto>.Fail("音檔不存在", 404), statusCode: 404);
        }

        var dto = new TtsStatusDto(
            row.Id, row.Status, row.DurationSeconds, DeserializeChapters(row.ChaptersJson), row.ErrorText);
        return Results.Ok(ApiResponse<TtsStatusDto>.Ok(dto));
    }

    // ── GET /audio/{id}（授權供檔＋HTTP Range）──────────────────────────────────

    /// <summary>
    /// 授權供檔：僅供本人、有效、ready 的音檔列；否則 404（不洩漏他人存在）。
    /// enableRangeProcessing=true → 自動處理 Range（206／Content-Range／Accept-Ranges，iOS 拖進度條必需）。
    /// 註：瀏覽器 &lt;audio&gt; 只能帶 Cookie（無法帶 PAT Bearer），故此端點在瀏覽器情境等同 Cookie 認證。
    /// </summary>
    private static async Task<IResult> ServeAudioHandler(
        HttpContext http,
        ZonWikiDbContext db,
        IWebHostEnvironment environment,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var row = await db.TtsAudio.IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                t => t.Id == id && t.UserId == userId && t.ValidFlag && t.Status == "ready", ct);
        if (row is null || string.IsNullOrEmpty(row.FilePath))
        {
            return Results.NotFound();
        }

        // FilePath 由伺服器以列 Id 生成（非使用者輸入）→ 無路徑穿越；仍檢查檔案存在。
        var absolutePath = Path.Combine(environment.ContentRootPath, row.FilePath);
        if (!File.Exists(absolutePath))
        {
            return Results.NotFound();
        }

        return Results.File(absolutePath, row.ContentType, enableRangeProcessing: true);
    }

    // ── GET /voices ─────────────────────────────────────────────────────────────

    /// <summary>回 30 聲清單（硬編自 recon；含 name/gender/label/language）。</summary>
    private static IResult VoicesHandler(HttpContext http)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        return Results.Ok(ApiResponse<IReadOnlyList<VoiceDto>>.Ok(TtsVoiceCatalog.Voices));
    }

    // ── GET/PUT /api/me/tts-settings ─────────────────────────────────────────────

    /// <summary>取當前使用者的 TTS 偏好（未設回系統預設）。</summary>
    private static async Task<IResult> GetSettingsHandler(
        HttpContext http,
        ZonWikiDbContext db,
        IConfiguration configuration,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var settingsJson = await db.User.Where(u => u.Id == userId)
            .Select(u => u.TtsSettingsJson)
            .FirstOrDefaultAsync(ct);

        var (voice, language, format, _) = ResolveVoiceLanguageFormat(null, settingsJson, configuration);
        return Results.Ok(ApiResponse<TtsSettingsDto>.Ok(new TtsSettingsDto(voice, language, format)));
    }

    /// <summary>更新當前使用者的 TTS 偏好（只更新有給的欄位；非法值回 400）。</summary>
    private static async Task<IResult> UpdateSettingsHandler(
        HttpContext http,
        ZonWikiDbContext db,
        IConfiguration configuration,
        UpdateTtsSettingsRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var user = await db.User.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
        {
            return Results.Json(ApiResponse<TtsSettingsDto>.Fail("使用者不存在", 404), statusCode: 404);
        }

        // 以既有設定為基底，套上本次有給的欄位，再整體驗證＋序列化存回。
        var existing = ParseSettings(user.TtsSettingsJson);
        var voice = string.IsNullOrWhiteSpace(request.Voice) ? existing.Voice : request.Voice.Trim();
        var language = string.IsNullOrWhiteSpace(request.Language) ? existing.Language : request.Language.Trim();
        var format = string.IsNullOrWhiteSpace(request.Format) ? existing.Format : request.Format.Trim();

        if (voice is not null && !TtsVoiceCatalog.IsValidVoice(voice))
        {
            return Results.Json(ApiResponse<TtsSettingsDto>.Fail("無效的聲音代號", 400), statusCode: 400);
        }

        if (format is not null && !TtsSynthesisService.ValidFormats.Contains(format))
        {
            return Results.Json(ApiResponse<TtsSettingsDto>.Fail("無效的音檔格式（只接受 MP3 或 OGG_OPUS）", 400), statusCode: 400);
        }

        // language 白名單（審查修正 #4）：只在使用者明確給了語言時驗（null＝沿用預設，不驗）。
        if (language is not null && !TtsVoiceCatalog.IsValidLanguage(language))
        {
            return Results.Json(ApiResponse<TtsSettingsDto>.Fail("無效的語言代碼", 400), statusCode: 400);
        }

        var normalizedFormat = format is null ? null : TtsSynthesisService.ResolveFormat(format).Canonical;
        var stored = new StoredTtsSettings(voice, language, normalizedFormat);
        user.TtsSettingsJson = JsonSerializer.Serialize(stored, SettingsJsonOptions);
        user.UpdatedUser = userId.ToString();
        await db.SaveChangesAsync(ct);

        var (resolvedVoice, resolvedLanguage, resolvedFormat, _) =
            ResolveVoiceLanguageFormat(null, user.TtsSettingsJson, configuration);
        return Results.Ok(ApiResponse<TtsSettingsDto>.Ok(
            new TtsSettingsDto(resolvedVoice, resolvedLanguage, resolvedFormat)));
    }

    // ── 共用工具 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 解析最終要用的 voice/language/format：request → 使用者設定 → 系統預設（設定值→保底常數），並驗白名單。
    /// </summary>
    /// <returns>(voice, language, format, 錯誤訊息)；錯誤訊息非 null 時表示驗證失敗（端點回 400）。</returns>
    private static (string Voice, string Language, string Format, string? Error) ResolveVoiceLanguageFormat(
        TtsSynthesizeRequest? request,
        string? userSettingsJson,
        IConfiguration configuration)
    {
        var settings = ParseSettings(userSettingsJson);

        var voice = FirstNonBlank(
            request?.Voice, settings.Voice, configuration[DefaultVoiceConfigKey], FallbackVoice)!;
        var language = FirstNonBlank(
            request?.Language, settings.Language, configuration[DefaultLanguageConfigKey], FallbackLanguage)!;
        var format = FirstNonBlank(
            request?.Format, settings.Format, configuration[DefaultFormatConfigKey], FallbackFormat)!;

        if (!TtsVoiceCatalog.IsValidVoice(voice))
        {
            return (voice, language, format, "無效的聲音代號");
        }

        if (!TtsSynthesisService.ValidFormats.Contains(format))
        {
            return (voice, language, format, "無效的音檔格式（只接受 MP3 或 OGG_OPUS）");
        }

        // language 白名單（審查修正 #4）：非清單值回 400。空字串在上方 FirstNonBlank 已回退成預設 cmn-TW，
        // 故此處失敗代表 request/使用者設定明確給了非白名單語言。
        if (!TtsVoiceCatalog.IsValidLanguage(language))
        {
            return (voice, language, format, "無效的語言代碼");
        }

        // 正規化格式（大小寫統一）。
        format = TtsSynthesisService.ResolveFormat(format).Canonical;
        return (voice.Trim(), language.Trim(), format, null);
    }

    /// <summary>回第一個非空白的字串（皆空則回最後一個保底值）。</summary>
    private static string? FirstNonBlank(params string?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (!string.IsNullOrWhiteSpace(candidate))
            {
                return candidate;
            }
        }

        return candidates.Length > 0 ? candidates[^1] : null;
    }

    /// <summary>解析 User_TtsSettingsJson（壞 JSON／空 → 各欄回 null，由呼叫端退回系統預設）。</summary>
    private static StoredTtsSettings ParseSettings(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new StoredTtsSettings(null, null, null);
        }

        try
        {
            return JsonSerializer.Deserialize<StoredTtsSettings>(json, SettingsJsonOptions)
                ?? new StoredTtsSettings(null, null, null);
        }
        catch (JsonException)
        {
            return new StoredTtsSettings(null, null, null);
        }
    }

    /// <summary>反序列化 ChaptersJson → 章節清單（壞 JSON／null → null）。</summary>
    private static IReadOnlyList<ChapterDto>? DeserializeChapters(string? chaptersJson)
    {
        if (string.IsNullOrWhiteSpace(chaptersJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<List<ChapterDto>>(chaptersJson, SettingsJsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>判斷 processing 列是否已陳舊（UpdatedDateTime 超過合成硬預算 → 背景大概率已死於重啟）。</summary>
    private static bool IsStaleProcessing(TtsAudio row, TtsSynthesisService synthesisService)
    {
        var budgetSeconds = synthesisService.ResolveSynthesisBudgetSeconds();
        return row.UpdatedDateTime < DateTime.UtcNow.AddSeconds(-budgetSeconds);
    }

    /// <summary>
    /// 啟動背景合成（fire-and-forget，照 <c>AiEndpoints</c> 範式）：child scope＋SetCurrentUserId（於管線內）
    /// ＋合成預算 CTS；例外一律在背景 catch（絕不冒成未攔截）。
    /// </summary>
    private static void LaunchBackgroundSynthesis(
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        TtsSynthesisService synthesisServiceForBudget,
        Guid ttsAudioId,
        Guid userId,
        Guid noteId,
        string voice,
        string language,
        string format)
    {
        var budgetSeconds = synthesisServiceForBudget.ResolveSynthesisBudgetSeconds();

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<TtsSynthesisService>();
            var bgLogger = loggerFactory.CreateLogger(LoggerCategory);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(budgetSeconds));
            try
            {
                await svc.RunPipelineAsync(ttsAudioId, userId, noteId, voice, language, format, cts.Token);
            }
            catch (Exception ex)
            {
                bgLogger.LogError(ex, "TTS 背景合成未攔截例外（ttsAudioId={TtsAudioId}）", ttsAudioId);
            }
        });
    }

    /// <summary>202 Accepted＋processing DTO（processing 無時長／章節）。</summary>
    private static IResult Accepted(Guid ttsAudioId)
        => Results.Json(
            ApiResponse<TtsSynthesizeResponseDto>.Ok(
                new TtsSynthesizeResponseDto(ttsAudioId, "processing", null, null)),
            statusCode: StatusCodes.Status202Accepted);

    /// <summary>判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。</summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is DbException { SqlState: "23505" };

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

    /// <summary>User_TtsSettingsJson 的內部形狀（voice/language/format 皆可空＝未設）。</summary>
    private sealed record StoredTtsSettings(string? Voice, string? Language, string? Format);
}
