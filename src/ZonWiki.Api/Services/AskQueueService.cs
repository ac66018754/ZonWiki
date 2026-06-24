using Markdig;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Notes;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 提問佇列服務：管理 AI 提問的生命週期（從提問建立至完成／失敗）、查詢歷史佇列。
/// 提供純函式生命週期轉換（單元測試友善）與資料庫查詢。
/// </summary>
public sealed class AskQueueService
{
    private readonly ZonWikiDbContext _db;
    private readonly ILogger<AskQueueService> _logger;

    /// <summary>
    /// Running 逾時門檻（分鐘）：Running 但建立後超過此時間仍未完成者，
    /// 視為已中斷／逾時（佇列顯示為失敗、不再計入「進行中」），避免孤兒永遠卡在等待中。
    /// 同步式 AI 工作正常應遠快於此。開機時的清理另見 Program.cs。
    /// </summary>
    private const int StaleRunningMinutes = 5;

    /// <summary>
    /// 初始化提問佇列服務。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="logger">記錄器。</param>
    public AskQueueService(ZonWikiDbContext db, ILogger<AskQueueService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// 建立「執行中」的框選提問 AiSession（純函式，無副作用）。
    /// 填入使用者 ID、提問文字、框選上下文、完整 prompt；稽核欄位（CreatedUser 等）交由呼叫端設置。
    /// QuestionText 與 AnchorText 超過 2000 字自動截斷。
    /// </summary>
    /// <param name="userId">提問使用者識別碼。</param>
    /// <param name="noteId">框選提問的來源筆記識別碼。</param>
    /// <param name="questionText">使用者的提問文字。</param>
    /// <param name="anchorText">框選的文字片段。</param>
    /// <param name="promptText">實際送給 AI 的完整 prompt。</param>
    /// <returns>新的 AiSession 實體（Status=Running，Kind=floatingnote）。</returns>
    public static AiSession BuildRunningNoteSession(
        Guid userId,
        Guid noteId,
        string questionText,
        string anchorText,
        string promptText)
    {
        // 截斷過長的文字（最多 2000 字元）。
        var truncatedQuestion = questionText.Length > 2000 ? questionText[..2000] : questionText;
        var truncatedAnchor = anchorText.Length > 2000 ? anchorText[..2000] : anchorText;

        return new AiSession
        {
            UserId = userId,
            NoteId = noteId,
            QuestionText = truncatedQuestion,
            AnchorText = truncatedAnchor,
            PromptText = promptText,
            Kind = "floatingnote",
            Status = "Running",
            CreatedUser = userId.ToString(),
            UpdatedUser = userId.ToString(),
        };
    }

    /// <summary>
    /// 將執行中的 AiSession 標記為已完成，並記錄答案筆記與錨點 ID。
    /// 更新 Status、AnswerNoteId、MarkId；同時刷新 UpdatedDateTime 與 UpdatedUser。
    /// </summary>
    /// <param name="session">要更新的 AiSession（已存在資料庫）。</param>
    /// <param name="answerNoteId">產生的答案筆記識別碼（便利貼模式無，為 null）。</param>
    /// <param name="markId">建立的 NoteMark 識別碼（來源筆記上的錨點；便利貼模式無，為 null）。</param>
    public static void ApplyCompleted(AiSession session, Guid? answerNoteId = null, Guid? markId = null)
    {
        session.Status = "Completed";
        session.AnswerNoteId = answerNoteId;
        session.MarkId = markId;
        session.UpdatedDateTime = DateTime.UtcNow;
        session.UpdatedUser = session.UserId.ToString();
    }

    /// <summary>
    /// 將執行中的 AiSession 標記為失敗，記錄安全摘要的失敗訊息。
    /// ErrorText 只保存異常訊息的第一行（前 500 字元），不含堆疊追蹤或檔案路徑。
    /// </summary>
    /// <param name="session">要更新的 AiSession（已存在資料庫）。</param>
    /// <param name="errorMessage">異常訊息。</param>
    public static void ApplyFailed(AiSession session, string errorMessage)
    {
        session.Status = "Failed";
        // 只取第一行（至第一個換行），且限制為 500 字元。
        var firstLine = errorMessage.Split('\n')[0];
        var safeError = firstLine.Length > 500 ? firstLine[..500] : firstLine;
        session.ErrorText = safeError;
        session.UpdatedDateTime = DateTime.UtcNow;
        session.UpdatedUser = session.UserId.ToString();
    }

    /// <summary>
    /// 查詢使用者的提問佇列（含篩選與排序）。
    /// 依 CreatedDateTime 由新到舊，相同時間以 Id 為二級排序（穩定排序）。
    /// 自動 LEFT-JOIN 來源筆記與答案筆記（可能已刪除）以補充 slug/title；
    /// 只查詢該使用者自己的筆記（使用者隔離）。
    /// </summary>
    /// <param name="userId">查詢的使用者識別碼。</param>
    /// <param name="status">可選狀態篩選（Running/Completed/Failed；null 表示不篩選）。</param>
    /// <param name="kind">可選種類篩選（node/floatingnote；null 表示不篩選）。</param>
    /// <param name="limit">回傳數量上限（預設 50；上限 200；超過自動夾住）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>符合條件的 AskQueueItemDto 清單（唯讀），依建立時間由新到舊。</returns>
    public async Task<IReadOnlyList<AskQueueItemDto>> GetQueueAsync(
        Guid userId,
        string? status = null,
        string? kind = null,
        int? limit = null,
        CancellationToken ct = default)
    {
        // 設定預設值與上限。
        var effectiveLimit = (limit ?? 50) switch
        {
            < 1 => 1,
            > 200 => 200,
            var x => x,
        };

        // 驗證 status 值（忽略無效值）。
        var validStatuses = new[] { "Running", "Completed", "Failed" };
        var filterByStatus = !string.IsNullOrWhiteSpace(status) && validStatuses.Contains(status);

        // 驗證 kind 值（忽略無效值）。
        var validKinds = new[] { "node", "floatingnote", "beautify", "reformat" };
        var filterByKind = !string.IsNullOrWhiteSpace(kind) && validKinds.Contains(kind);

        // 建立查詢。
        var query = from session in _db.AiSession
                    where session.UserId == userId && session.ValidFlag
                    where !filterByStatus || session.Status == status
                    where !filterByKind || session.Kind == kind
                    orderby session.CreatedDateTime descending, session.Id descending
                    select new
                    {
                        Session = session,
                        SourceNote = _db.Note
                            .Where(n => n.Id == session.NoteId && n.ValidFlag && n.UserId == userId)
                            .Select(n => new { n.Slug, n.Title })
                            .FirstOrDefault(),
                        AnswerNote = _db.Note
                            .Where(n => n.Id == session.AnswerNoteId && n.ValidFlag && n.UserId == userId)
                            .Select(n => new { n.Slug, n.Title })
                            .FirstOrDefault(),
                    };

        // 取用。
        var results = await query.Take(effectiveLimit).ToListAsync(ct);

        // 逾時保護：Running 但已超過門檻（AI 卡住或請求中斷而未經重啟）→ 顯示為失敗，
        // 不再計入「進行中」、也不會永遠卡在等待中。
        var now = DateTime.UtcNow;

        // 投影至 DTO。
        return results
            .Select(r =>
            {
                var isStale = r.Session.Status == "Running"
                    && (now - r.Session.CreatedDateTime).TotalMinutes > StaleRunningMinutes;
                var status = isStale ? "Failed" : r.Session.Status;
                var errorText = isStale
                    ? "逾時（可能已中斷，未在時限內完成）"
                    : r.Session.ErrorText;
                return new AskQueueItemDto(
                    SessionId: r.Session.Id,
                    Status: status,
                    Kind: r.Session.Kind,
                    QuestionText: r.Session.QuestionText,
                    AnchorText: r.Session.AnchorText,
                    NoteId: r.Session.NoteId,
                    NoteSlug: r.SourceNote?.Slug,
                    NoteTitle: r.SourceNote?.Title,
                    AnswerNoteId: r.Session.AnswerNoteId,
                    AnswerNoteSlug: r.AnswerNote?.Slug,
                    MarkId: r.Session.MarkId,
                    CanvasId: r.Session.CanvasId,
                    AskNodeId: r.Session.AskNodeId,
                    CreatedDateTime: r.Session.CreatedDateTime,
                    ErrorText: errorText);
            })
            .ToList()
            .AsReadOnly();
    }

    /// <summary>
    /// 執行框選提問的完整流程：建立 Running AiSession → 呼叫 AI → 成功時建答案筆記/錨點/更新為 Completed
    /// → 失敗時記錄 ErrorText/更新為 Failed（不建答案筆記）。
    /// </summary>
    /// <param name="userId">提問使用者識別碼。</param>
    /// <param name="noteId">框選的來源筆記識別碼。</param>
    /// <param name="request">框選提問請求（含問題、框選文字、anchor 位置等）。</param>
    /// <param name="aiService">AI 服務（呼叫 AskAboutAsync）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>框選提問結果 DTO（包含答案筆記 ID、slug、mark ID）。</returns>
    /// <exception cref="KeyNotFoundException">來源筆記不存在或不屬於使用者（handler 映射為 404）。</exception>
    /// <exception cref="ArgumentException">提問文字為空（handler 映射為 400）。</exception>
    public async Task<AskSelectionResultDto> ExecuteAskSelectionAsync(
        Guid userId,
        Guid noteId,
        AskSelectionRequest request,
        INoteAiService aiService,
        CancellationToken ct)
    {
        // 驗證來源筆記存在且屬於本人。
        var sourceNote = await _db.Note
            .FirstOrDefaultAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userId, ct)
            ?? throw new KeyNotFoundException("Note not found");

        var question = (request.Question ?? "").Trim();
        if (string.IsNullOrEmpty(question))
        {
            throw new ArgumentException("Question cannot be empty", nameof(request));
        }

        var selected = (request.AnchorText ?? "").Trim();

        // 組稽核用 prompt（保存框選與問題，供日後 Review）。
        var promptText = $"[框選]\n{selected}\n\n[問題]\n{question}";

        // 建立 Running AiSession 並立即存檔（記錄提問痕跡，即使後續 AI 失敗也留痕）。
        var session = BuildRunningNoteSession(userId, noteId, question, selected, promptText);
        _db.AiSession.Add(session);
        await _db.SaveChangesAsync(ct);

        try
        {
            // 呼叫 AI。
            var answer = await aiService.AskAboutAsync(selected, question, ct);

            // 組答案筆記內容（含來源出處引言 + 問題 + 回答）。
            var titleBase = question.Length <= 40 ? question : question[..40] + "…";
            var answerContent =
                $"> 來源：[[{sourceNote.Title}]]\n> 選取：「{selected}」\n\n" +
                $"**問題**：{question}\n\n**回答**：\n\n{answer}";

            // 建答案筆記（slug 去重、Markdig 渲染、建立 create 版本）。
            var baseSlug = NoteContentHelpers.GenerateSlug(titleBase);
            if (string.IsNullOrEmpty(baseSlug)) baseSlug = "note";
            var slug = baseSlug;
            for (var i = 2;
                 await _db.Note.AnyAsync(n => n.UserId == userId && n.Slug == slug && n.ValidFlag, ct);
                 i++)
            {
                slug = $"{baseSlug}-{i}";
            }

            var answerNote = new Note
            {
                UserId = userId,
                Title = titleBase,
                Slug = slug,
                ContentRaw = answerContent,
                ContentHtml = Markdown.ToHtml(answerContent, NoteContentHelpers.MarkdownPipeline),
                ContentHash = NoteContentHelpers.ComputeContentHash(answerContent),
                Kind = "note",
                IsDraft = false,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            // NoteMark 錨點：從來源筆記的選取範圍指向答案筆記。
            // （Id 為 client 端生成 = Guid.NewGuid()，故可在存檔前先參照 answerNote.Id。）
            var mark = new NoteMark
            {
                UserId = userId,
                NoteId = sourceNote.Id,
                Kind = "link",
                AnchorText = request.AnchorText ?? "",
                AnchorStart = request.AnchorStart,
                AnchorEnd = request.AnchorEnd,
                AnchorPrefix = request.AnchorPrefix ?? "",
                AnchorSuffix = request.AnchorSuffix ?? "",
                TargetType = "note",
                TargetId = answerNote.Id,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };

            // 答案筆記、create 版本、錨點、以及 Session 的「已完成」狀態，
            // 於「單次 SaveChanges」原子寫入——避免多次儲存之間崩潰而留下半完成狀態。
            _db.Note.Add(answerNote);
            _db.NoteRevision.Add(new NoteRevision
            {
                UserId = userId,
                NoteId = answerNote.Id,
                RevisionNo = 1,
                ChangeKind = "create",
                Title = answerNote.Title,
                ContentRaw = answerNote.ContentRaw,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            });
            _db.NoteMark.Add(mark);
            ApplyCompleted(session, answerNote.Id, mark.Id);
            await _db.SaveChangesAsync(ct);

            return new AskSelectionResultDto(answerNote.Id, answerNote.Slug, mark.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed ask-selection (userId={UserId}, noteId={NoteId})",
                userId,
                noteId);

            // 盡力記錄失敗狀態（萬一又失敗就忽略）。
            try
            {
                ApplyFailed(session, ex.Message);
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception logEx)
            {
                _logger.LogError(logEx, "Failed to log AiSession failure state");
            }

            // 向上拋出原異常讓 handler 回 500。
            throw;
        }
    }

    /// <summary>
    /// 通用「AI 工作追蹤」包裝器：先建一筆 Running AiSession，執行傳入的 AI 呼叫，
    /// 成功 → Completed、失敗 → Failed（記錄安全摘要）後把原例外向上拋。
    /// 讓「便利貼提問／美化筆記／整理排版」等任何 AI 生成動作都能進「AI 處理中」佇列。
    /// 注意：本方法「不」驗證筆記擁有權，呼叫端須先自行驗證。
    /// </summary>
    /// <typeparam name="T">AI 呼叫的回傳型別。</typeparam>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="noteId">關聯的筆記識別碼（可空）。</param>
    /// <param name="kind">工作種類（floatingnote／beautify／reformat／node…）。</param>
    /// <param name="label">佇列顯示用的標籤或問題（例如「美化筆記」或使用者的提問）。</param>
    /// <param name="anchorText">框選片段（無則 null）。</param>
    /// <param name="aiCall">實際的 AI 呼叫。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>AI 呼叫的結果。</returns>
    public async Task<T> TrackAiAsync<T>(
        Guid userId,
        Guid? noteId,
        string kind,
        string? label,
        string? anchorText,
        Func<CancellationToken, Task<T>> aiCall,
        CancellationToken ct)
    {
        static string? Trunc(string? s) => s is null ? null : (s.Length > 2000 ? s[..2000] : s);

        var session = new AiSession
        {
            UserId = userId,
            NoteId = noteId,
            Kind = kind,
            QuestionText = Trunc(label),
            AnchorText = Trunc(anchorText),
            PromptText = label ?? kind,
            Status = "Running",
            CreatedUser = userId.ToString(),
            UpdatedUser = userId.ToString(),
        };
        _db.AiSession.Add(session);
        await _db.SaveChangesAsync(ct);

        try
        {
            var result = await aiCall(ct);
            ApplyCompleted(session);
            await _db.SaveChangesAsync(ct);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Tracked AI failed (userId={UserId}, noteId={NoteId}, kind={Kind})",
                userId,
                noteId,
                kind);
            try
            {
                ApplyFailed(session, ex.Message);
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception logEx)
            {
                _logger.LogError(logEx, "Failed to log AiSession failure state");
            }
            throw;
        }
    }
}
