using System.Text.RegularExpressions;
using Markdig;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Common;
using ZonWiki.Api.Notes;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記寫入端點（CRUD、分類、標籤、AI 輔助）。
/// 所有寫入操作需使用者驗證；每次 create/update/delete 都記錄版本（NoteRevision）。
/// 內容渲染使用 Markdig（禁用 raw HTML 防 XSS）；ContentHash 用於匯入衝突偵測。
/// </summary>
public static class NoteWriteEndpoints
{
    /// <summary>
    /// Wiki 連結比對：擷取 [[X]] 形式。
    /// </summary>
    private static readonly Regex WikiLinkRegex = new(
        @"\[\[([^\]\r\n]+)\]\]",
        RegexOptions.Compiled);

    /// <summary>
    /// 註冊筆記寫入相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    /// <param name="authConfigured">是否已設定驗證（未設定時略過授權要求）。</param>
    public static void MapNoteWriteEndpoints(this IEndpointRouteBuilder app, bool authConfigured)
    {
        // POST /api/notes - 建立筆記
        var createNote = app.MapPost("/api/notes", CreateNoteHandler);

        // PUT /api/notes/{id} - 更新筆記
        var updateNote = app.MapPut("/api/notes/{id:guid}", UpdateNoteHandler);

        // DELETE /api/notes/{id} - 軟刪除筆記
        var deleteNote = app.MapDelete("/api/notes/{id:guid}", DeleteNoteHandler);

        // PUT /api/notes/{id}/categories - 更新筆記分類（多對多）
        var assignCategories = app.MapPut("/api/notes/{id:guid}/categories", AssignCategoriesHandler);

        // POST /api/notes/{noteId}/categories/{categoryId} - 將筆記加入「單一」分類（冪等）
        // 供「拖曳筆記直接進某分類」用：只需 noteId + categoryId，不需要先知道該筆記既有的分類清單。
        var addNoteToCategory = app.MapPost(
            "/api/notes/{noteId:guid}/categories/{categoryId:guid}",
            AddNoteToCategoryHandler);

        // PUT /api/notes/{id}/tags - 更新筆記標籤（多對多；整組取代；自動建立不存在的標籤）
        var assignTags = app.MapPut("/api/notes/{id:guid}/tags", AssignTagsHandler);

        // POST /api/notes/{noteId}/tags/{tagId} - 將「單一」標籤加到筆記（冪等、原子；避免讀-改-寫競態）
        var addNoteTag = app.MapPost(
            "/api/notes/{noteId:guid}/tags/{tagId:guid}",
            AddNoteTagHandler);

        // DELETE /api/notes/{noteId}/tags/{tagId} - 從筆記移除「單一」標籤（冪等、原子）
        var removeNoteTag = app.MapDelete(
            "/api/notes/{noteId:guid}/tags/{tagId:guid}",
            RemoveNoteTagHandler);

        // GET /api/notes/{id}/revisions - 查詢筆記編輯歷史
        var getRevisions = app.MapGet("/api/notes/{id:guid}/revisions", GetRevisionsHandler);

        // GET /api/notes/{id}/backlinks - 查詢反向連結（有哪些筆記指向此筆記）
        var getBacklinks = app.MapGet("/api/notes/{id:guid}/backlinks", GetBacklinksHandler);

        // GET /api/graph - 知識圖譜（所有筆記與連結，供前端繪製）
        var getGraph = app.MapGet("/api/graph", GetKnowledgeGraphHandler);

        // POST /api/notes/{id}/reformat - AI 排版調整
        var reformatNote = app.MapPost("/api/notes/{id:guid}/reformat", ReformatNoteHandler);

        // POST /api/notes/{id}/beautify - AI 整體美化
        var beautifyNote = app.MapPost("/api/notes/{id:guid}/beautify", BeautifyNoteHandler);

        // POST /api/notes/{id}/ask-selection - 框選提問：AI 回答 → 建答案筆記 → 以錨點關聯回來
        var askSelection = app.MapPost("/api/notes/{id:guid}/ask-selection", AskSelectionHandler);

        // POST /api/notes/{id}/ask-selection-answer - 框選提問（便利貼模式）：以「整篇筆記+框選文字」為脈絡，
        // 只回傳 AI 答案文字，由前端放進便利貼浮層（不另建答案筆記）。
        var askSelectionAnswer = app.MapPost("/api/notes/{id:guid}/ask-selection-answer", AskSelectionAnswerHandler);

        // POST /api/notes/{id}/ask-question - 問題功能：以「整篇筆記內容」為脈絡請 AI 回答一則問題，
        // 只回傳答案文字（不落地），由前端放進答題彈窗的「回答」框。
        var askQuestion = app.MapPost("/api/notes/{id:guid}/ask-question", AskQuestionHandler);

        // AI 端點（會真實觸發付費 LLM 呼叫）一律掛「每使用者限流」（AiPolicy）——
        // 比照 /api/ai/ask（AiEndpoints）與精煉端點的既定政策（審查發現 #30/#58）：
        // 防止無窮迴圈或被盜憑證灌爆付費 API 額度與這台 2GB VM 的背景工作數。
        reformatNote.RequireRateLimiting(RateLimitingExtensions.AiPolicy);
        beautifyNote.RequireRateLimiting(RateLimitingExtensions.AiPolicy);
        askSelection.RequireRateLimiting(RateLimitingExtensions.AiPolicy);
        askSelectionAnswer.RequireRateLimiting(RateLimitingExtensions.AiPolicy);
        askQuestion.RequireRateLimiting(RateLimitingExtensions.AiPolicy);

        // 要求驗證的端點
        if (authConfigured)
        {
            createNote.RequireAuthorization();
            updateNote.RequireAuthorization();
            deleteNote.RequireAuthorization();
            assignCategories.RequireAuthorization();
            addNoteToCategory.RequireAuthorization();
            assignTags.RequireAuthorization();
            reformatNote.RequireAuthorization();
            beautifyNote.RequireAuthorization();
            askSelection.RequireAuthorization();
            askSelectionAnswer.RequireAuthorization();
            askQuestion.RequireAuthorization();
        }
    }

    // ==================== Ask Selection（框選提問 → 答案筆記 + 關聯） ====================

    /// <summary>
    /// 框選提問：以選取文字為脈絡請 AI 回答，建立一則「答案筆記」，並從來源筆記的選取範圍
    /// 建立 NoteMark 關聯指向答案筆記（與開問啦節點「框選提問→產生回答節點+行內連結」對應）。
    /// 流程委由 AskQueueService 處理，並自動記錄 AiSession。
    /// </summary>
    private static async Task<IResult> AskSelectionHandler(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AskSelectionRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<AiAsyncStartedDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 同步驗證（立即回 404/400）。
        var owns = await db.Note.AnyAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);
        if (!owns)
        {
            return Results.NotFound(ApiResponse<AiAsyncStartedDto>.Fail("Note not found", 404));
        }
        var question = (request.Question ?? "").Trim();
        if (string.IsNullOrEmpty(question))
        {
            return Results.BadRequest(ApiResponse<AiAsyncStartedDto>.Fail("Question cannot be empty", 400));
        }
        var selected = (request.AnchorText ?? "").Trim();

        // 非同步：同步建 Running session 立即回 sessionId；答案筆記在背景建立（前端輪詢到 Completed 後用 answerNoteId 導向）。
        var session = await queueService.CreateRunningNoteAiSessionAsync(userId, id, "floatingnote", question, selected, ct);
        var sessionId = session.Id;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var bgDb = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            bgDb.SetCurrentUserId(userId);
            var bgQueue = scope.ServiceProvider.GetRequiredService<AskQueueService>();
            var bgAi = scope.ServiceProvider.GetRequiredService<INoteAiService>();
            var bgLogger = loggerFactory.CreateLogger("NoteAiBackground");
            // 背景總預算 1800 秒（30 分）：讓後援鏈能真的逐棒 fallback——claude 單次 300s、最多 2 次後仍有餘裕
            // 跌到 Google AI Studio／banana（較快）。非同步背景執行，不影響任何 HTTP 請求（前端只輪詢佇列）。
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1800));
            try
            {
                await bgQueue.FinishAskSelectionAsync(sessionId, userId, bgAi, request, cts.Token);
            }
            catch (Exception ex)
            {
                bgLogger.LogError(ex, "框選提問背景失敗（session={SessionId}）", sessionId);
            }
        });

        return Results.Accepted(value: ApiResponse<AiAsyncStartedDto>.Ok(new AiAsyncStartedDto(sessionId)));
    }

    /// <summary>
    /// 框選提問（便利貼模式）：以「整篇筆記內容 + 框選文字」為脈絡請 AI 回答，
    /// 只回傳答案文字（不建答案筆記、不建關聯）；由前端把答案放進便利貼浮層。
    /// </summary>
    private static async Task<IResult> AskSelectionAnswerHandler(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AskSelectionRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<AiAsyncStartedDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var sourceNote = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);
        if (sourceNote is null)
        {
            return Results.NotFound(ApiResponse<AiAsyncStartedDto>.Fail("Note not found", 404));
        }

        var question = (request.Question ?? "").Trim();
        var selected = (request.AnchorText ?? "").Trim();
        if (string.IsNullOrEmpty(question))
        {
            return Results.BadRequest(ApiResponse<AiAsyncStartedDto>.Fail("缺少問題", 400));
        }

        // 把「整篇筆記內容 + 框選段落」一起當成上下文（沿用 AskAboutAsync，不改 AI 介面）。
        var context =
            $"【整篇筆記內容】\n{sourceNote.ContentRaw}\n\n" +
            $"【使用者特別框選、想聚焦的段落】\n「{selected}」";

        // 非同步：同步建 Running session 立即回 sessionId；後援鏈在背景跑（避免 claude 冷啟動阻塞請求→502）。
        var session = await queueService.CreateRunningNoteAiSessionAsync(userId, id, "floatingnote", question, selected, ct);
        var sessionId = session.Id;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var bgDb = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            bgDb.SetCurrentUserId(userId);
            var bgQueue = scope.ServiceProvider.GetRequiredService<AskQueueService>();
            var bgAi = scope.ServiceProvider.GetRequiredService<INoteAiService>();
            var bgLogger = loggerFactory.CreateLogger("NoteAiBackground");
            // 背景總預算 1800 秒（30 分）：讓後援鏈能真的逐棒 fallback——claude 單次 300s、最多 2 次後仍有餘裕
            // 跌到 Google AI Studio／banana（較快）。非同步背景執行，不影響任何 HTTP 請求（前端只輪詢佇列）。
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1800));
            try
            {
                await bgQueue.FinishNoteAiAsync(
                    sessionId,
                    userId,
                    async (onStage, bgCt) => await bgAi.AskAboutAsync(context, question, bgCt, onStage),
                    cts.Token);
            }
            catch (Exception ex)
            {
                bgLogger.LogError(ex, "便利貼提問背景失敗（session={SessionId}）", sessionId);
            }
        });

        return Results.Accepted(value: ApiResponse<AiAsyncStartedDto>.Ok(new AiAsyncStartedDto(sessionId)));
    }

    /// <summary>
    /// 問題功能：以「整篇筆記內容」為脈絡請 AI 回答一則問題，只回傳答案文字（不建答案筆記、不落地）；
    /// 由前端把答案放進答題彈窗的「回答」框。完全模仿 <see cref="AskSelectionAnswerHandler"/> 的非同步流程。
    /// </summary>
    private static async Task<IResult> AskQuestionHandler(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AskNoteQuestionRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<AiAsyncStartedDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var sourceNote = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);
        if (sourceNote is null)
        {
            return Results.NotFound(ApiResponse<AiAsyncStartedDto>.Fail("Note not found", 404));
        }

        var question = (request.Question ?? "").Trim();
        if (string.IsNullOrEmpty(question))
        {
            return Results.BadRequest(ApiResponse<AiAsyncStartedDto>.Fail("缺少問題", 400));
        }

        // 長度上限比照 NoteOverlayItem_Text 的 DB 上限——問題文字來自便利貼／文字框，超過即拒。
        if (question.Length > MaxQuestionLength)
        {
            return Results.BadRequest(ApiResponse<AiAsyncStartedDto>.Fail($"問題過長（上限 {MaxQuestionLength} 字元）", 400));
        }

        // 把「整篇筆記內容」當成上下文（沿用 AskAboutAsync，不改 AI 介面）。
        var context = $"【整篇筆記內容】\n{sourceNote.ContentRaw}";

        // 非同步：同步建 Running session 立即回 sessionId；後援鏈在背景跑（避免 claude 冷啟動阻塞請求→502）。
        // kind="notequestion"：與框選提問（floatingnote）區隔，讓「AI 處理佇列」正確標示為「筆記提問」。
        var session = await queueService.CreateRunningNoteAiSessionAsync(userId, id, "notequestion", question, null, ct);
        var sessionId = session.Id;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var bgDb = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            bgDb.SetCurrentUserId(userId);
            var bgQueue = scope.ServiceProvider.GetRequiredService<AskQueueService>();
            var bgAi = scope.ServiceProvider.GetRequiredService<INoteAiService>();
            var bgLogger = loggerFactory.CreateLogger("NoteAiBackground");
            // 背景總預算 1800 秒（30 分）：讓後援鏈能真的逐棒 fallback。
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1800));
            try
            {
                await bgQueue.FinishNoteAiAsync(
                    sessionId,
                    userId,
                    async (onStage, bgCt) => await bgAi.AskAboutAsync(context, question, bgCt, onStage),
                    cts.Token);
            }
            catch (Exception ex)
            {
                bgLogger.LogError(ex, "筆記提問背景失敗（session={SessionId}）", sessionId);
            }
        });

        return Results.Accepted(value: ApiResponse<AiAsyncStartedDto>.Ok(new AiAsyncStartedDto(sessionId)));
    }

    /// <summary>
    /// 問題文字長度上限（字元）：與 NoteOverlayItem_Text 的 DB 上限共用同一常數（單一真相，避免魔術數字漂移）。
    /// </summary>
    private const int MaxQuestionLength = NoteOverlayItem.TextMaxLength;

    // ==================== Create Note ====================

    private static async Task<IResult> CreateNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        CreateNoteRequest request,
        CancellationToken ct)
    {
        // 取得使用者身分
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NoteDetailDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 驗證請求
        var validationError = ValidateCreateNoteRequest(request);
        if (validationError != null)
        {
            return Results.BadRequest(ApiResponse<NoteDetailDto>.Fail(validationError, 400));
        }

        try
        {
            // 產生 Slug（去除特殊字元、轉小寫、用連字號分隔）；全被濾掉就以 "note" 墊底。
            var baseSlug = NoteContentHelpers.GenerateSlug(request.Title);
            if (string.IsNullOrEmpty(baseSlug))
            {
                baseSlug = "note";
            }

            // 同使用者內 slug 若重複，自動加序號（-2, -3 …）而非報錯——避免「同標題就建不了筆記」。
            var slug = baseSlug;
            for (var i = 2;
                 await db.Note.AnyAsync(n => n.UserId == userId && n.Slug == slug && n.ValidFlag, ct);
                 i++)
            {
                slug = $"{baseSlug}-{i}";
            }

            // 內容允許為空（先建立、再編輯）；null 一律轉空字串避免後續 NPE。
            var contentRaw = request.ContentRaw ?? string.Empty;
            var contentHtml = NoteContentHelpers.RenderToHtml(contentRaw);
            var contentHash = NoteContentHelpers.ComputeContentHash(contentRaw);

            // 建立筆記實體
            var note = new Note
            {
                UserId = userId,
                Title = request.Title.Trim(),
                Slug = slug,
                ContentRaw = contentRaw,
                ContentHtml = contentHtml,
                ContentHash = contentHash,
                Kind = request.Kind ?? "note",
                IsDraft = request.IsDraft,
                JournalDate = request.JournalDate,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };

            db.Note.Add(note);
            // 注意：不在此先 SaveChanges。Id 於實體建構時即以 Guid.NewGuid() 產生，版本/分類/標籤/連結
            // 都可直接引用 note.Id，全部併入「單一 SaveChanges」原子寫入。這樣「建立即帶分類」只會產生
            // 一筆 created 活動——若拆成「先存筆記→再存分類」兩段式，活動攔截器會記成 created + updated 兩筆。

            // 建立版本紀錄（ChangeKind = "create"）
            var revision = new NoteRevision
            {
                UserId = userId,
                NoteId = note.Id,
                RevisionNo = 1,
                ChangeKind = "create",
                Title = note.Title,
                ContentRaw = note.ContentRaw,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.NoteRevision.Add(revision);

            // 指派分類（若傳入）
            if (request.CategoryIds?.Count > 0)
            {
                await SetNoteCategoriesAsync(db, userId, note.Id, request.CategoryIds, ct);
            }

            // 指派標籤（若傳入）
            if (request.TagIds?.Count > 0)
            {
                await SetNoteTagsAsync(db, userId, note.Id, request.TagIds, ct);
            }

            // 解析 wiki 連結並建立 NoteLink
            await ParseAndCreateWikiLinksAsync(db, userId, note.Id, note.ContentRaw, ct);

            await db.SaveChangesAsync(ct);

            // 回傳結果
            var dto = new NoteDetailDto(
                note.Id,
                note.Title,
                note.Slug,
                note.ContentHtml,
                note.ContentRaw,
                note.Kind,
                note.IsDraft,
                note.CreatedDateTime,
                note.UpdatedDateTime,
                0,
                Version: db.Entry(note).GetConcurrencyVersion());

            // Location 標頭只能是 ASCII；slug 可能含中文（GenerateSlug 保留 Unicode），故 URL 編碼，
            // 否則會丟 InvalidOperationException: Invalid non-ASCII character in header。
            return Results.Created(
                $"/api/notes/{Uri.EscapeDataString(note.Slug)}",
                ApiResponse<NoteDetailDto>.Ok(dto));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create note (userId={UserId}, title={Title})", userId, request.Title);
            return Results.StatusCode(500);
        }
    }

    // ==================== Update Note ====================

    private static async Task<IResult> UpdateNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid id,
        UpdateNoteRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NoteDetailDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 查詢筆記
        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);

        if (note is null)
        {
            return Results.NotFound(ApiResponse<NoteDetailDto>.Fail("Note not found", 404));
        }

        try
        {
            var contentChanged = false;

            // 更新標題：以 is not null 判斷「有無傳入該欄位」（PATCH 語意），與值本身分開。
            // 有傳入才動；但標題不可清空——傳入純空白視為無效（筆記必須有標題）。
            if (request.Title is not null)
            {
                var trimmedTitle = request.Title.Trim();
                if (trimmedTitle.Length == 0)
                {
                    return Results.Json(
                        ApiResponse<NoteDetailDto>.Fail("標題不可為空", 400),
                        statusCode: StatusCodes.Status400BadRequest);
                }
                note.Title = trimmedTitle;
            }

            // 更新內容：同樣以 is not null 判斷有無傳入。
            // 允許傳入空字串＝「清空內容」（與「未傳入、不更動」明確區分——修正舊版無法清空的缺陷）。
            if (request.ContentRaw is not null)
            {
                note.ContentRaw = request.ContentRaw;
                note.ContentHtml = NoteContentHelpers.RenderToHtml(request.ContentRaw);
                note.ContentHash = NoteContentHelpers.ComputeContentHash(request.ContentRaw);
                contentChanged = true;
            }

            // 更新草稿狀態（若傳入）
            if (request.IsDraft.HasValue)
            {
                note.IsDraft = request.IsDraft.Value;
            }

            note.UpdatedUser = userId.ToString();

            // 記錄版本
            var latestRevision = await db.NoteRevision
                .Where(r => r.NoteId == id)
                .OrderByDescending(r => r.RevisionNo)
                .FirstOrDefaultAsync(ct);

            var nextRevisionNo = (latestRevision?.RevisionNo ?? 0) + 1;

            var revision = new NoteRevision
            {
                UserId = userId,
                NoteId = note.Id,
                RevisionNo = nextRevisionNo,
                ChangeKind = "update",
                Title = note.Title,
                ContentRaw = note.ContentRaw,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.NoteRevision.Add(revision);

            // 更新分類（整組取代；reconcile 會復活軟刪除列，避免唯一索引衝突）
            if (request.CategoryIds != null)
            {
                await SetNoteCategoriesAsync(db, userId, id, request.CategoryIds, ct);
            }

            // 更新標籤（整組取代）
            if (request.TagIds != null)
            {
                await SetNoteTagsAsync(db, userId, id, request.TagIds, ct);
            }

            // 若內容有變，重新解析 wiki 連結
            if (contentChanged)
            {
                // 刪除舊連結
                var oldLinks = await db.NoteLink
                    .Where(nl => nl.SourceNoteId == id && nl.ValidFlag)
                    .ToListAsync(ct);
                foreach (var link in oldLinks)
                {
                    link.ValidFlag = false;
                }

                // 建立新連結
                await ParseAndCreateWikiLinksAsync(db, userId, id, note.ContentRaw, ct);
            }

            // 樂觀鎖（#4/#34）：若前端帶回 baseVersion，以其比對 xmin 偵測併發衝突。
            db.Entry(note).ApplyBaseVersion(request.BaseVersion);

            await db.SaveChangesAsync(ct);

            var dto = new NoteDetailDto(
                note.Id,
                note.Title,
                note.Slug,
                note.ContentHtml,
                note.ContentRaw,
                note.Kind,
                note.IsDraft,
                note.CreatedDateTime,
                note.UpdatedDateTime,
                await db.Comment.CountAsync(c => c.NoteId == id && c.ValidFlag, ct),
                Version: db.Entry(note).GetConcurrencyVersion());

            return Results.Ok(ApiResponse<NoteDetailDto>.Ok(dto));
        }
        catch (DbUpdateConcurrencyException)
        {
            // 載入後被其他來源（另一裝置／外部 AI）改過 → 回 409，讓前端提示覆蓋或重新載入。
            return Results.Json(
                ApiResponse<NoteDetailDto>.Fail("此項已被其他來源修改", 409),
                statusCode: StatusCodes.Status409Conflict);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update note (userId={UserId}, noteId={NoteId})", userId, id);
            return Results.StatusCode(500);
        }
    }

    // ==================== Delete Note ====================

    private static async Task<IResult> DeleteNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);

        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        try
        {
            note.ValidFlag = false;
            note.DeletedDateTime = DateTime.UtcNow;
            note.UpdatedUser = userId.ToString();

            // 記錄版本（ChangeKind = "delete"）
            var latestRevision = await db.NoteRevision
                .Where(r => r.NoteId == id)
                .OrderByDescending(r => r.RevisionNo)
                .FirstOrDefaultAsync(ct);

            var nextRevisionNo = (latestRevision?.RevisionNo ?? 0) + 1;

            var revision = new NoteRevision
            {
                UserId = userId,
                NoteId = note.Id,
                RevisionNo = nextRevisionNo,
                ChangeKind = "delete",
                Title = note.Title,
                ContentRaw = note.ContentRaw,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.NoteRevision.Add(revision);

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = note.Id }));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete note (userId={UserId}, noteId={NoteId})", userId, id);
            return Results.StatusCode(500);
        }
    }

    // ==================== Assign Categories ====================

    private static async Task<IResult> AssignCategoriesHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid id,
        List<Guid> categoryIds,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);

        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        try
        {
            await SetNoteCategoriesAsync(db, userId, id, categoryIds, ct);

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = note.Id }));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to assign categories (userId={UserId}, noteId={NoteId})", userId, id);
            return Results.StatusCode(500);
        }
    }

    // ==================== Add Note To Single Category ====================

    /// <summary>
    /// 將一篇筆記加入「單一」分類（冪等）。供「拖曳筆記直接進某分類」用。
    /// 與 AssignCategoriesHandler（整組取代）不同，本端點只「新增」一個關聯，不影響其它分類。
    /// </summary>
    /// <param name="http">HTTP 內容（用於取得使用者身分）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="logger">記錄器。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="categoryId">要加入的分類識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>成功時回傳 200；筆記或分類不存在時回傳 404；未驗證回傳 401。</returns>
    private static async Task<IResult> AddNoteToCategoryHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid noteId,
        Guid categoryId,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 確認筆記存在且屬於本人。
        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userId, ct);
        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        // 確認分類存在且屬於本人。
        var categoryExists = await db.Category
            .AnyAsync(c => c.Id == categoryId && c.ValidFlag && c.UserId == userId, ct);
        if (!categoryExists)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Category not found", 404));
        }

        try
        {
            // NoteCategory 對 (NoteId, CategoryId) 有唯一索引，因此每組配對至多一列（含已軟刪除者）。
            // 必須用 IgnoreQueryFilters 才能看見被軟刪除（ValidFlag=false）的舊關聯以便復活，
            // 否則直接 Add 新列會違反唯一索引。額外以 UserId 明確過濾，確保跨租戶安全。
            var existing = await db.NoteCategory
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(
                    nc => nc.NoteId == noteId && nc.CategoryId == categoryId && nc.UserId == userId,
                    ct);

            if (existing is null)
            {
                // 沒有任何關聯 → 新建一筆。
                db.NoteCategory.Add(new NoteCategory
                {
                    UserId = userId,
                    NoteId = noteId,
                    CategoryId = categoryId,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                });
            }
            else if (!existing.ValidFlag)
            {
                // 曾被移除（軟刪除）→ 復活，而非插入重複列。
                existing.ValidFlag = true;
                existing.DeletedDateTime = null;
                existing.UpdatedUser = userId.ToString();
            }
            // else：已是有效關聯 → 不做任何事（冪等）。

            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { noteId, categoryId }));
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Failed to add note to category (userId={UserId}, noteId={NoteId}, categoryId={CategoryId})",
                userId,
                noteId,
                categoryId);
            return Results.StatusCode(500);
        }
    }

    // ==================== Add / Remove single Tag (atomic) ====================

    /// <summary>
    /// 將「單一」標籤加到一篇筆記（冪等、原子）。
    /// 與 AssignTagsHandler（整組取代）不同，本端點只新增一個關聯、不影響其它標籤，
    /// 因此前端不需先讀目前標籤再整組送出，可避免讀-改-寫競態覆蓋他處的變更。
    /// </summary>
    /// <param name="http">HTTP 內容（取得使用者身分）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="logger">記錄器。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="tagId">要加入的標籤識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>成功 200；筆記或標籤不存在 404；未驗證 401。</returns>
    private static async Task<IResult> AddNoteTagHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid noteId,
        Guid tagId,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 確認筆記存在且屬於本人。
        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userId, ct);
        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        // 確認標籤存在且屬於本人。
        var tagExists = await db.Tag
            .AnyAsync(t => t.Id == tagId && t.ValidFlag && t.UserId == userId, ct);
        if (!tagExists)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Tag not found", 404));
        }

        try
        {
            // NoteTag 對 (NoteId, TagId) 有唯一索引；用 IgnoreQueryFilters 看見已軟刪除的舊關聯以便復活。
            var existing = await db.NoteTag
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(
                    nt => nt.NoteId == noteId && nt.TagId == tagId && nt.UserId == userId,
                    ct);

            if (existing is null)
            {
                db.NoteTag.Add(new NoteTag
                {
                    UserId = userId,
                    NoteId = noteId,
                    TagId = tagId,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                });
            }
            else if (!existing.ValidFlag)
            {
                existing.ValidFlag = true;
                existing.DeletedDateTime = null;
                existing.UpdatedUser = userId.ToString();
            }
            // else：已是有效關聯 → 冪等不動作。

            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { noteId, tagId }));
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Failed to add tag to note (userId={UserId}, noteId={NoteId}, tagId={TagId})",
                userId,
                noteId,
                tagId);
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// 從一篇筆記移除「單一」標籤（冪等、原子；軟刪除該關聯）。
    /// </summary>
    /// <param name="http">HTTP 內容（取得使用者身分）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="logger">記錄器。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="tagId">要移除的標籤識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>成功 200；筆記不存在 404；未驗證 401。</returns>
    private static async Task<IResult> RemoveNoteTagHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid noteId,
        Guid tagId,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 確認筆記存在且屬於本人。
        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userId, ct);
        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        try
        {
            var existing = await db.NoteTag
                .FirstOrDefaultAsync(
                    nt => nt.NoteId == noteId && nt.TagId == tagId && nt.UserId == userId && nt.ValidFlag,
                    ct);

            if (existing is not null)
            {
                existing.ValidFlag = false;
                existing.DeletedDateTime = DateTime.UtcNow;
                existing.UpdatedUser = userId.ToString();
                await db.SaveChangesAsync(ct);
            }
            // 找不到有效關聯 → 視為已移除（冪等）。

            return Results.Ok(ApiResponse<object>.Ok(new { noteId, tagId }));
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Failed to remove tag from note (userId={UserId}, noteId={NoteId}, tagId={TagId})",
                userId,
                noteId,
                tagId);
            return Results.StatusCode(500);
        }
    }

    // ==================== Assign Tags ====================

    private static async Task<IResult> AssignTagsHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        Guid id,
        List<Guid> tagIds,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<object>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var note = await db.Note
            .FirstOrDefaultAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);

        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
        }

        try
        {
            await SetNoteTagsAsync(db, userId, id, tagIds, ct);

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = note.Id }));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to assign tags (userId={UserId}, noteId={NoteId})", userId, id);
            return Results.StatusCode(500);
        }
    }

    // ==================== Get Revisions ====================

    private static async Task<IResult> GetRevisionsHandler(
        ZonWikiDbContext db,
        Guid id,
        CancellationToken ct)
    {
        var noteExists = await db.Note
            .AnyAsync(n => n.Id == id && n.ValidFlag, ct);

        if (!noteExists)
        {
            return Results.NotFound(ApiResponse<List<NoteRevisionDto>>.Fail("Note not found", 404));
        }

        var revisions = await db.NoteRevision
            .Where(r => r.NoteId == id && r.ValidFlag)
            .OrderBy(r => r.RevisionNo)
            .Select(r => new NoteRevisionDto(
                r.Id,
                r.RevisionNo,
                r.ChangeKind,
                r.Title,
                r.ContentRaw,
                r.CreatedDateTime,
                r.CreatedUser))
            .ToListAsync(ct);

        return Results.Ok(ApiResponse<List<NoteRevisionDto>>.Ok(revisions));
    }

    // ==================== Get Backlinks ====================

    private static async Task<IResult> GetBacklinksHandler(
        ZonWikiDbContext db,
        Guid id,
        CancellationToken ct)
    {
        var noteExists = await db.Note
            .AnyAsync(n => n.Id == id && n.ValidFlag, ct);

        if (!noteExists)
        {
            return Results.NotFound(ApiResponse<List<BacklinkDto>>.Fail("Note not found", 404));
        }

        // 先以真實欄位 n.Title 排序、再投影成 DTO。
        // 不可在 Join 投影成 BacklinkDto「之後」再 OrderBy(b => b.SourceNoteTitle)——
        // EF Core 會試圖在 SQL ORDER BY 內重建 BacklinkDto 而無法轉譯（造成 500）。
        var backlinks = await db.NoteLink
            .Where(nl => nl.TargetNoteId == id && nl.ValidFlag)
            .Join(
                db.Note,
                nl => nl.SourceNoteId,
                n => n.Id,
                (nl, n) => new { nl, n })
            .OrderBy(x => x.n.Title)
            .Select(x => new BacklinkDto(
                x.nl.Id,
                x.nl.SourceNoteId,
                x.n.Title,
                x.n.Slug,
                x.nl.AnchorText))
            .ToListAsync(ct);

        return Results.Ok(ApiResponse<List<BacklinkDto>>.Ok(backlinks));
    }

    // ==================== Get Knowledge Graph ====================

    private static async Task<IResult> GetKnowledgeGraphHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        int limit = 500,
        CancellationToken ct = default)
    {
        // 若啟用驗證，只返回使用者自己的筆記與連結
        Guid? userId = null;
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var uid))
        {
            userId = uid;
        }

        try
        {
            // 防爆量：知識圖最多回傳 N 個節點（取「最近更新」者），避免筆記一多就回傳 MB 級 JSON，
            // 拖垮弱核 VM 的序列化成本與前端繪圖。預設 500，夾在 [1, 2000]。
            var cappedLimit = Math.Clamp(limit, 1, 2000);

            // 取得有效筆記（若有使用者身分則過濾），依最近更新排序後取前 N 筆
            var notesQuery = db.Note.Where(n => n.ValidFlag);
            if (userId.HasValue)
            {
                notesQuery = notesQuery.Where(n => n.UserId == userId.Value);
            }

            var nodes = await notesQuery
                .OrderByDescending(n => n.UpdatedDateTime)
                .Take(cappedLimit)
                .Select(n => new GraphNodeDto(
                    n.Id,
                    n.Title,
                    n.Slug,
                    n.Kind))
                .ToListAsync(ct);

            // 連結保留規則：來源筆記須在本次節點集合內；目標若已解析（非 null）也須在集合內，
            // 避免指向「被上限截斷」節點的懸空邊。未解析（target 為 null，即指向尚未建立的筆記）
            // 的連結維持原行為照常回傳。未截斷（筆記數 < 上限）時，等同回傳全部有效連結。
            var nodeIds = nodes.Select(n => n.Id).ToHashSet();

            // 取得連結（若有使用者身分則過濾）
            var linksQuery = db.NoteLink.Where(nl => nl.ValidFlag);
            if (userId.HasValue)
            {
                linksQuery = linksQuery.Where(nl => nl.UserId == userId.Value);
            }

            var edges = await linksQuery
                .Select(nl => new GraphEdgeDto(
                    nl.SourceNoteId,
                    nl.TargetNoteId,
                    nl.AnchorText))
                .ToListAsync(ct);

            var prunedEdges = edges
                .Where(edge => nodeIds.Contains(edge.SourceNoteId)
                    && (!edge.TargetNoteId.HasValue || nodeIds.Contains(edge.TargetNoteId.Value)))
                .ToList();

            var graph = new KnowledgeGraphDto(nodes, prunedEdges);

            return Results.Ok(ApiResponse<KnowledgeGraphDto>.Ok(graph));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to generate knowledge graph (userId={UserId})", userId);
            return Results.StatusCode(500);
        }
    }

    // ==================== AI Reformat ====================

    private static async Task<IResult> ReformatNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AiTransformRequest request,
        CancellationToken ct)
        => await StartTransformNoteAsync(http, db, queueService, scopeFactory, loggerFactory, id, request, ct, "reformat");

    // ==================== AI Beautify ====================

    private static async Task<IResult> BeautifyNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AiTransformRequest request,
        CancellationToken ct)
        => await StartTransformNoteAsync(http, db, queueService, scopeFactory, loggerFactory, id, request, ct, "beautify");

    /// <summary>
    /// AI 排版／美化共用處理（**非同步**）：建立 Running AiSession、立即回 202 + sessionId，
    /// 實際的後援鏈轉換在背景 scope 執行（claude -p 在小機器冷啟動可達數十秒，同步會超過反向代理逾時 → 502）。
    /// 結果存進 <c>AiSession.ResultText</c>，前端輪詢 <c>/api/ask-queue/{sessionId}</c> 取回後套用到編輯器。
    /// 「不寫入筆記、不建版本」的精神不變——前端取回結果後仍由使用者按「保存」才落地。
    /// </summary>
    /// <param name="http">HTTP 內容（取得使用者身分）。</param>
    /// <param name="db">資料庫內容（驗證擁有權 + 同步建 session）。</param>
    /// <param name="queueService">佇列服務（建 session）。</param>
    /// <param name="scopeFactory">背景工作用的 DI scope 工廠。</param>
    /// <param name="loggerFactory">背景工作記錄器。</param>
    /// <param name="id">筆記識別碼（驗證擁有權用）。</param>
    /// <param name="request">請求內容（目前的 Markdown）。</param>
    /// <param name="ct">取消權杖（僅用於同步部分；背景另起逾時權杖）。</param>
    /// <param name="opName">操作名稱（reformat／beautify）。</param>
    /// <returns>202 Accepted + sessionId。</returns>
    private static async Task<IResult> StartTransformNoteAsync(
        HttpContext http,
        ZonWikiDbContext db,
        AskQueueService queueService,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory,
        Guid id,
        AiTransformRequest request,
        CancellationToken ct,
        string opName)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<AiAsyncStartedDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // 驗證筆記存在且屬於本人（防護；不讀其內容、不修改）。
        var owns = await db.Note.AnyAsync(n => n.Id == id && n.ValidFlag && n.UserId == userId, ct);
        if (!owns)
        {
            return Results.NotFound(ApiResponse<AiAsyncStartedDto>.Fail("Note not found", 404));
        }

        var input = request?.ContentRaw ?? string.Empty;
        var label = opName switch
        {
            "beautify" => "美化筆記",
            "reformat" => "整理排版",
            _ => opName,
        };

        // 同步：建 Running session，立即取得 sessionId 回前端（前端據此輪詢）。
        var session = await queueService.CreateRunningNoteAiSessionAsync(userId, id, opName, label, null, ct);
        var sessionId = session.Id;

        // 背景：開新 scope 跑後援鏈（不阻塞請求；避免 Cloudflare 100s 逾時 502）。
        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var bgDb = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            bgDb.SetCurrentUserId(userId); // 背景無 HttpContext，明確設使用者隔離
            var bgQueue = scope.ServiceProvider.GetRequiredService<AskQueueService>();
            var bgAi = scope.ServiceProvider.GetRequiredService<INoteAiService>();
            var bgLogger = loggerFactory.CreateLogger("NoteAiBackground");
            // 後援鏈最壞情況（claude 慢 + 換家）給較長逾時；遠大於前端輪詢，但不影響任何 HTTP 請求。
            // 背景總預算 1800 秒（30 分）：讓後援鏈能真的逐棒 fallback——claude 單次 300s、最多 2 次後仍有餘裕
            // 跌到 Google AI Studio／banana（較快）。非同步背景執行，不影響任何 HTTP 請求（前端只輪詢佇列）。
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1800));
            try
            {
                await bgQueue.FinishNoteAiAsync(
                    sessionId,
                    userId,
                    async (onStage, bgCt) => opName == "beautify"
                        ? await bgAi.BeautifyAsync(input, bgCt, onStage)
                        : await bgAi.ReformatAsync(input, bgCt, onStage),
                    cts.Token);
            }
            catch (Exception ex)
            {
                bgLogger.LogError(ex, "note-AI 背景啟動失敗（op={Op}, session={SessionId}）", opName, sessionId);
            }
        });

        return Results.Accepted(value: ApiResponse<AiAsyncStartedDto>.Ok(new AiAsyncStartedDto(sessionId)));
    }

    // ==================== Helper Methods ====================

    /// <summary>
    /// 從 HttpContext 提取使用者 ID。
    /// 只允許從使用者聲明（user claim）提取；禁止從查詢參數或其他來源讀取，避免用戶繞過授權。
    /// </summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId))
        {
            return userId;
        }

        return Guid.Empty;
    }

    /// <summary>
    /// 驗證建立筆記請求。
    /// </summary>
    private static string? ValidateCreateNoteRequest(CreateNoteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return "Title is required";

        if (request.Title.Length > 500)
            return "Title too long (max 500)";

        // 內容允許為空：新建筆記可先只有標題，之後再編輯內容。

        if (request.Kind != null && request.Kind != "note" && request.Kind != "journal")
            return "Kind must be 'note' or 'journal'";

        return null;
    }


    /// <summary>
    /// 設定筆記的分類（整組取代；reconcile）。
    /// 只接受屬於本人且有效的分類；用 IgnoreQueryFilters 載入既有關聯（含軟刪除）以便
    /// 「復活 / 軟刪除 / 新增」，避免重新加入已移除的分類時違反 (NoteId, CategoryId) 唯一索引。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="categoryIds">目標分類識別碼清單（空清單＝清空所有分類）。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task SetNoteCategoriesAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid noteId,
        List<Guid> categoryIds,
        CancellationToken ct)
    {
        var requested = (categoryIds ?? new List<Guid>()).Distinct().ToList();
        // 僅接受本人且有效的分類。
        var validCategoryIds = requested.Count == 0
            ? new List<Guid>()
            : await db.Category
                .Where(c => c.UserId == userId && c.ValidFlag && requested.Contains(c.Id))
                .Select(c => c.Id)
                .ToListAsync(ct);

        var existing = await db.NoteCategory
            .IgnoreQueryFilters()
            .Where(nc => nc.NoteId == noteId && nc.UserId == userId)
            .ToListAsync(ct);
        var existingIds = existing.Select(nc => nc.CategoryId).ToHashSet();

        foreach (var link in existing)
        {
            var shouldHave = validCategoryIds.Contains(link.CategoryId);
            if (link.ValidFlag != shouldHave)
            {
                link.ValidFlag = shouldHave;
                link.DeletedDateTime = shouldHave ? null : DateTime.UtcNow;
                link.UpdatedUser = userId.ToString();
                link.UpdatedDateTime = DateTime.UtcNow;
            }
        }

        foreach (var categoryId in validCategoryIds.Where(cid => !existingIds.Contains(cid)))
        {
            db.NoteCategory.Add(new NoteCategory
            {
                UserId = userId,
                NoteId = noteId,
                CategoryId = categoryId,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            });
        }
    }

    /// <summary>
    /// 設定筆記的標籤（整組取代；reconcile）。
    /// 同 <see cref="SetNoteCategoriesAsync"/>，以復活軟刪除列避免違反 (NoteId, TagId) 唯一索引。
    /// 標籤須事先存在（前端以 createNoteTag 建立後再傳 id）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="tagIds">目標標籤識別碼清單（空清單＝清空所有標籤）。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task SetNoteTagsAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid noteId,
        List<Guid> tagIds,
        CancellationToken ct)
    {
        var requested = (tagIds ?? new List<Guid>()).Distinct().ToList();
        var validTagIds = requested.Count == 0
            ? new List<Guid>()
            : await db.Tag
                .Where(t => t.UserId == userId && t.ValidFlag && requested.Contains(t.Id))
                .Select(t => t.Id)
                .ToListAsync(ct);

        var existing = await db.NoteTag
            .IgnoreQueryFilters()
            .Where(nt => nt.NoteId == noteId && nt.UserId == userId)
            .ToListAsync(ct);
        var existingIds = existing.Select(nt => nt.TagId).ToHashSet();

        foreach (var link in existing)
        {
            var shouldHave = validTagIds.Contains(link.TagId);
            if (link.ValidFlag != shouldHave)
            {
                link.ValidFlag = shouldHave;
                link.DeletedDateTime = shouldHave ? null : DateTime.UtcNow;
                link.UpdatedUser = userId.ToString();
                link.UpdatedDateTime = DateTime.UtcNow;
            }
        }

        foreach (var tagId in validTagIds.Where(tid => !existingIds.Contains(tid)))
        {
            db.NoteTag.Add(new NoteTag
            {
                UserId = userId,
                NoteId = noteId,
                TagId = tagId,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            });
        }
    }

    /// <summary>
    /// 解析 ContentRaw 的 wiki 連結（[[X]] 格式）並建立 NoteLink。
    /// 若同使用者內存在相符的 slug 或標題，填入 TargetNoteId；否則 TargetNoteId 為 null。
    /// 效能：先收集去重所有 anchorText，單一 WHERE...IN 一次撈回候選筆記（避免每個連結各查一次的 N+1）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">擁有者使用者識別碼。</param>
    /// <param name="sourceNoteId">來源筆記識別碼。</param>
    /// <param name="contentRaw">筆記原始內容（Markdown）。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task ParseAndCreateWikiLinksAsync(
        ZonWikiDbContext db,
        Guid userId,
        Guid sourceNoteId,
        string contentRaw,
        CancellationToken ct)
    {
        // 逐個出現的 anchorText（保留原始出現順序；重複出現＝建多條連結，維持原有行為）。
        var anchorTexts = ExtractAnchorTexts(contentRaw);
        if (anchorTexts.Count == 0)
        {
            return;
        }

        var resolver = await WikiLinkTargetResolver.BuildAsync(db, userId, anchorTexts, ct);

        foreach (var anchorText in anchorTexts)
        {
            db.NoteLink.Add(new NoteLink
            {
                UserId = userId,
                SourceNoteId = sourceNoteId,
                TargetNoteId = resolver.Resolve(anchorText),
                AnchorText = anchorText,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            });
        }
    }

    /// <summary>
    /// 從內容擷取所有非空的 wiki 連結錨點文字（[[X]] 內的 X，已 Trim）。
    /// 保留原始出現順序與重複（重複出現代表要建立多條連結）。
    /// </summary>
    /// <param name="contentRaw">筆記原始內容。</param>
    /// <returns>錨點文字清單（可能含重複）。</returns>
    private static List<string> ExtractAnchorTexts(string contentRaw)
    {
        var anchorTexts = new List<string>();
        foreach (Match match in WikiLinkRegex.Matches(contentRaw))
        {
            var anchorText = match.Groups[1].Value.Trim();
            if (!string.IsNullOrEmpty(anchorText))
            {
                anchorTexts.Add(anchorText);
            }
        }

        return anchorTexts;
    }
}
