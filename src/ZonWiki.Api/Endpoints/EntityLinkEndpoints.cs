using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 通用實體關聯端點：在「任務 / 子任務 / 筆記 / 開問啦節點」之間建立雙向連結，
/// 並提供「從某實體一鍵建立並連結一篇筆記 / 一張畫布(含初始節點)」。
/// 連結以一筆代表雙向；查詢時 Source/Target 兩端都比對。
/// </summary>
public static class EntityLinkEndpoints
{
    // 支援的實體型別
    private const string TypeTask = "taskcard";
    private const string TypeSubtask = "subtask";
    private const string TypeNote = "note";
    private const string TypeNode = "node";

    /// <summary>建立關聯請求。</summary>
    public sealed record CreateLinkRequest(string SourceType, Guid SourceId, string TargetType, Guid TargetId);

    /// <summary>「從某實體建立並連結」請求（建立筆記 / 畫布用）。</summary>
    public sealed record CreateFromRequest(string SourceType, Guid SourceId, string Title);

    /// <summary>關聯「另一端」的顯示資料（給前端列出 + 導覽）。</summary>
    public sealed record LinkedEntityDto(
        Guid LinkId,
        string Type,
        Guid Id,
        string Title,
        string Url,
        string? SubText);

    /// <summary>
    /// 可關聯的「候選既有實體」（搜尋既有項目來建立關聯時使用）。
    /// </summary>
    public sealed record LinkCandidateDto(
        string Type,
        Guid Id,
        string Title,
        string? SubText,
        bool AlreadyLinked);

    /// <summary>
    /// 註冊通用實體關聯端點。
    /// </summary>
    public static void MapEntityLinkEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出某實體的所有關聯（雙向；回傳「另一端」的顯示資料）
        app.MapGet("/api/links", async (
            string type, Guid id, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var t = Norm(type);

            var links = await db.EntityLink
                .Where(l => l.UserId == userGuid && l.ValidFlag &&
                    ((l.SourceType == t && l.SourceId == id) || (l.TargetType == t && l.TargetId == id)))
                .OrderByDescending(l => l.CreatedDateTime)
                .ToListAsync(ct);

            var result = new List<LinkedEntityDto>();
            foreach (var l in links)
            {
                // 取「另一端」
                var (otherType, otherId) = (l.SourceType == t && l.SourceId == id)
                    ? (l.TargetType, l.TargetId)
                    : (l.SourceType, l.SourceId);
                var resolved = await ResolveAsync(db, userGuid, otherType, otherId, ct);
                if (resolved is null) continue; // 對端已刪 → 略過
                result.Add(resolved with { LinkId = l.Id });
            }

            return Results.Ok(new { success = true, data = result });
        }).RequireAuthorization();

        // 建立關聯（去重；若曾軟刪除則復活）
        app.MapPost("/api/links", async (
            CreateLinkRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var st = Norm(req.SourceType);
            var tt = Norm(req.TargetType);
            if (!IsValidType(st) || !IsValidType(tt))
                return Results.BadRequest(new { success = false, error = "未知的實體型別" });

            // 多租戶邊界：來源與目標都必須是本人擁有的有效實體，才允許建立關聯
            if (!await OwnsEntityAsync(db, userGuid, st, req.SourceId, ct) ||
                !await OwnsEntityAsync(db, userGuid, tt, req.TargetId, ct))
                return Results.NotFound(new { success = false, error = "找不到項目或無權限" });

            var link = await UpsertLinkAsync(db, userGuid, st, req.SourceId, tt, req.TargetId, ct);
            return Results.Ok(new { success = true, data = new { linkId = link.Id } });
        }).RequireAuthorization();

        // 刪除關聯（軟刪除）
        app.MapDelete("/api/links/{linkId:guid}", async (
            Guid linkId, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var link = await db.EntityLink.IgnoreQueryFilters()
                .FirstOrDefaultAsync(l => l.Id == linkId && l.UserId == userGuid, ct);
            if (link is null) return Results.NotFound(new { success = false });
            link.ValidFlag = false;
            link.DeletedDateTime = DateTime.UtcNow;
            link.UpdatedDateTime = DateTime.UtcNow;
            link.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { success = true });
        }).RequireAuthorization();

        // 從某實體「建立並連結」一篇筆記（草稿、標題帶入；不寫內容）
        app.MapPost("/api/links/note-from", async (
            CreateFromRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var st = Norm(req.SourceType);
            if (!IsValidType(st)) return Results.BadRequest(new { success = false, error = "未知的實體型別" });
            // 多租戶邊界：只能從「本人擁有的來源」建立並關聯
            if (!await OwnsEntityAsync(db, userGuid, st, req.SourceId, ct))
                return Results.NotFound(new { success = false, error = "找不到來源項目或無權限" });

            var title = string.IsNullOrWhiteSpace(req.Title) ? "未命名筆記" : req.Title.Trim();
            var now = DateTime.UtcNow;
            var user = userGuid.ToString();

            var baseSlug = GenerateSlug(title);
            if (string.IsNullOrEmpty(baseSlug)) baseSlug = "note";
            var slug = baseSlug;
            for (var i = 2; await db.Note.AnyAsync(n => n.UserId == userGuid && n.Slug == slug && n.ValidFlag, ct); i++)
                slug = $"{baseSlug}-{i}";

            var note = new Note
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Title = title,
                Slug = slug,
                ContentRaw = "",
                ContentHtml = "",
                ContentHash = "",
                Kind = "note",
                IsDraft = true,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = user,
                UpdatedUser = user,
                ValidFlag = true,
            };
            db.Note.Add(note);
            await db.SaveChangesAsync(ct);

            var link = await UpsertLinkAsync(db, userGuid, st, req.SourceId, TypeNote, note.Id, ct);
            return Results.Ok(new { success = true, data = new { noteId = note.Id, slug = note.Slug, linkId = link.Id } });
        }).RequireAuthorization();

        // 從某實體「建立並連結」一張畫布 + 初始節點（內容帶入；不問 AI）
        app.MapPost("/api/links/canvas-from", async (
            CreateFromRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var st = Norm(req.SourceType);
            if (!IsValidType(st)) return Results.BadRequest(new { success = false, error = "未知的實體型別" });
            // 多租戶邊界：只能從「本人擁有的來源」建立並關聯
            if (!await OwnsEntityAsync(db, userGuid, st, req.SourceId, ct))
                return Results.NotFound(new { success = false, error = "找不到來源項目或無權限" });

            var title = string.IsNullOrWhiteSpace(req.Title) ? "未命名" : req.Title.Trim();
            var now = DateTime.UtcNow;
            var user = userGuid.ToString();

            var canvas = new Canvas
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Title = title,
                Description = "",
                StateJson = "{}",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = user,
                UpdatedUser = user,
                ValidFlag = true,
            };
            db.Canvas.Add(canvas);

            // 初始節點：內容預填來源標題；Origin=user、不觸發 AI（純建立節點）。
            var node = new Node
            {
                Id = Guid.NewGuid(),
                CanvasId = canvas.Id,
                Title = "",
                Content = title,
                X = 0,
                Y = 0,
                ZIndex = 0,
                Origin = "user",
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = user,
                UpdatedUser = user,
                ValidFlag = true,
            };
            db.Node.Add(node);
            await db.SaveChangesAsync(ct);

            var link = await UpsertLinkAsync(db, userGuid, st, req.SourceId, TypeNode, node.Id, ct);
            return Results.Ok(new
            {
                success = true,
                data = new { canvasId = canvas.Id.ToString(), nodeId = node.Id.ToString(), linkId = link.Id },
            });
        }).RequireAuthorization();

        // 搜尋「可關聯的既有實體」：依來源型別決定要搜尋哪些目標型別。
        // 例：來源是任務 → 搜尋既有筆記 / 節點；來源是筆記 → 搜尋既有任務 / 節點。
        // 回傳每筆候選的標題與「是否已關聯」（前端據此標示/避免重複）。
        app.MapGet("/api/links/candidates", async (
            string sourceType,
            Guid sourceId,
            string? q,
            HttpContext http,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var st = Norm(sourceType);
            if (!IsValidType(st)) return Results.BadRequest(new { success = false, error = "未知的實體型別" });
            // 多租戶邊界：來源必須是本人擁有（避免以任意 sourceId 探測他人資料）
            if (!await OwnsEntityAsync(db, userGuid, st, sourceId, ct))
                return Results.NotFound(new { success = false, error = "找不到來源項目或無權限" });

            // 來源型別 → 可關聯的目標型別（子任務與任務同樣可關聯筆記/節點）。
            // 筆記來源也允許關聯到「其他筆記」（self 會在最後排除），與全域搜尋一致，
            // 否則框選某段文字想關聯到另一篇筆記時會「搜不到」。
            var targets = st switch
            {
                TypeTask or TypeSubtask => new[] { TypeNote, TypeNode },
                TypeNote => new[] { TypeNote, TypeTask, TypeNode },
                TypeNode => new[] { TypeTask, TypeNote },
                _ => Array.Empty<string>(),
            };

            // 找出此來源「已關聯」的另一端（用於標記 AlreadyLinked）
            var existingLinks = await db.EntityLink
                .Where(l => l.UserId == userGuid && l.ValidFlag &&
                    ((l.SourceType == st && l.SourceId == sourceId) ||
                     (l.TargetType == st && l.TargetId == sourceId)))
                .ToListAsync(ct);

            var linkedKeys = new HashSet<string>();
            foreach (var l in existingLinks)
            {
                var (otherType, otherId) = (l.SourceType == st && l.SourceId == sourceId)
                    ? (l.TargetType, l.TargetId)
                    : (l.SourceType, l.SourceId);
                linkedKeys.Add($"{otherType}:{otherId}");
            }

            var term = (q ?? string.Empty).Trim();
            var like = "%" + EscapeLike(term) + "%"; // 供 ILike 使用（已跳脫 % _ \）
            // 每型別只取少量最相關（避免一次列太多眼花）；使用者可再打字縮小範圍。
            const int perTypeLimit = 6;
            var candidates = new List<LinkCandidateDto>();

            foreach (var tt in targets)
            {
                switch (tt)
                {
                    case TypeNote:
                    {
                        var noteQuery = db.Note.Where(n => n.UserId == userGuid && n.ValidFlag);
                        if (term.Length > 0)
                            noteQuery = noteQuery.Where(n => EF.Functions.ILike(n.Title, like, "\\"));
                        var notes = await noteQuery
                            .OrderByDescending(n => n.UpdatedDateTime)
                            .Take(perTypeLimit)
                            .ToListAsync(ct);
                        foreach (var n in notes)
                        {
                            candidates.Add(new LinkCandidateDto(
                                TypeNote,
                                n.Id,
                                string.IsNullOrWhiteSpace(n.Title) ? "(無標題筆記)" : n.Title,
                                "筆記",
                                linkedKeys.Contains($"{TypeNote}:{n.Id}")));
                        }
                        break;
                    }
                    case TypeTask:
                    {
                        var taskQuery = db.TaskCard.Where(x => x.UserId == userGuid && x.ValidFlag);
                        if (term.Length > 0)
                            taskQuery = taskQuery.Where(x => EF.Functions.ILike(x.Title, like, "\\"));
                        var tasks = await taskQuery
                            .OrderByDescending(x => x.UpdatedDateTime)
                            .Take(perTypeLimit)
                            .ToListAsync(ct);
                        foreach (var x in tasks)
                        {
                            candidates.Add(new LinkCandidateDto(
                                TypeTask,
                                x.Id,
                                string.IsNullOrWhiteSpace(x.Title) ? "(未命名任務)" : x.Title,
                                "任務",
                                linkedKeys.Contains($"{TypeTask}:{x.Id}")));
                        }
                        break;
                    }
                    case TypeNode:
                    {
                        // Node 非 IUserOwned：以 Canvas 擁有權 Join 過濾；以 Content 搜尋。
                        var nodeQuery = db.Node.Where(nd => nd.ValidFlag);
                        if (term.Length > 0)
                            nodeQuery = nodeQuery.Where(nd => EF.Functions.ILike(nd.Content, like, "\\"));
                        var nodes = await nodeQuery
                            .Join(
                                db.Canvas.Where(c => c.UserId == userGuid && c.ValidFlag),
                                nd => nd.CanvasId,
                                c => c.Id,
                                (nd, c) => new { Node = nd, CanvasTitle = c.Title })
                            .OrderByDescending(z => z.Node.UpdatedDateTime)
                            .Take(perTypeLimit)
                            .ToListAsync(ct);
                        foreach (var z in nodes)
                        {
                            var title = FirstLine(z.Node.Content);
                            candidates.Add(new LinkCandidateDto(
                                TypeNode,
                                z.Node.Id,
                                string.IsNullOrWhiteSpace(title) ? "(空白節點)" : title,
                                $"開問啦節點 · {z.CanvasTitle}",
                                linkedKeys.Contains($"{TypeNode}:{z.Node.Id}")));
                        }
                        break;
                    }
                }
            }

            // 保險：不要把來源自己列為候選（理論上 targets 已排除來源型別）
            candidates = candidates.Where(c => !(c.Type == st && c.Id == sourceId)).ToList();

            return Results.Ok(new { success = true, data = candidates });
        }).RequireAuthorization();
    }

    /// <summary>建立或復活一筆關聯（依方向化的成對鍵去重）。</summary>
    private static async Task<EntityLink> UpsertLinkAsync(
        ZonWikiDbContext db, Guid userGuid,
        string srcType, Guid srcId, string tgtType, Guid tgtId, CancellationToken ct)
    {
        // 兩個方向都查（A→B 與 B→A 視為同一關聯）。
        var existing = await db.EntityLink.IgnoreQueryFilters().FirstOrDefaultAsync(l =>
            l.UserId == userGuid &&
            ((l.SourceType == srcType && l.SourceId == srcId && l.TargetType == tgtType && l.TargetId == tgtId) ||
             (l.SourceType == tgtType && l.SourceId == tgtId && l.TargetType == srcType && l.TargetId == srcId)),
            ct);

        var now = DateTime.UtcNow;
        var user = userGuid.ToString();
        if (existing is not null)
        {
            existing.ValidFlag = true; // 復活（曾軟刪除）
            existing.DeletedDateTime = null;
            existing.UpdatedDateTime = now;
            existing.UpdatedUser = user;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var link = new EntityLink
        {
            Id = Guid.NewGuid(),
            UserId = userGuid,
            SourceType = srcType,
            SourceId = srcId,
            TargetType = tgtType,
            TargetId = tgtId,
            Kind = "link",
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = user,
            UpdatedUser = user,
            ValidFlag = true,
        };
        db.EntityLink.Add(link);
        await db.SaveChangesAsync(ct);
        return link;
    }

    /// <summary>把某實體解析成「顯示標題 + 前端導覽 URL + 副標」。找不到/非本人擁有則回 null。</summary>
    private static async Task<LinkedEntityDto?> ResolveAsync(
        ZonWikiDbContext db, Guid userGuid, string type, Guid id, CancellationToken ct)
    {
        switch (type)
        {
            case TypeTask:
            {
                var t = await db.TaskCard.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
                if (t is null) return null;
                return new LinkedEntityDto(Guid.Empty, TypeTask, id, t.Title, TaskUrl(t.PlannedDateTime ?? t.DueDateTime), "任務");
            }
            case TypeSubtask:
            {
                var s = await db.SubTask.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
                if (s is null) return null;
                var parent = await db.TaskCard.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(x => x.Id == s.TaskCardId && x.UserId == userGuid, ct);
                return new LinkedEntityDto(Guid.Empty, TypeSubtask, id, s.Title,
                    TaskUrl(parent?.PlannedDateTime ?? parent?.DueDateTime), "子任務");
            }
            case TypeNote:
            {
                var n = await db.Note.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
                if (n is null) return null;
                return new LinkedEntityDto(Guid.Empty, TypeNote, id,
                    string.IsNullOrWhiteSpace(n.Title) ? "(無標題筆記)" : n.Title,
                    $"/notes/{Uri.EscapeDataString(n.Slug)}", "筆記");
            }
            case TypeNode:
            {
                // Node 非 IUserOwned：經 Canvas 驗證擁有權。
                var node = await db.Node.FirstOrDefaultAsync(x => x.Id == id && x.ValidFlag, ct);
                if (node is null) return null;
                var canvas = await db.Canvas.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(c => c.Id == node.CanvasId && c.UserId == userGuid && c.ValidFlag, ct);
                if (canvas is null) return null;
                var title = FirstLine(node.Content);
                return new LinkedEntityDto(Guid.Empty, TypeNode, id,
                    string.IsNullOrWhiteSpace(title) ? "(空白節點)" : title,
                    $"/canvas?canvasId={node.CanvasId}&nodeId={id}", $"開問啦節點 · {canvas.Title}");
            }
            default:
                return null;
        }
    }

    /// <summary>任務/子任務的導覽 URL：有日期 → 行事曆週視圖定位到該天；無日期 → 任務頁。</summary>
    private static string TaskUrl(DateTime? when)
    {
        if (when is null) return "/tasks";
        var d = when.Value.ToString("yyyy-MM-dd");
        return $"/tasks?view=calendar&calendarView=week&date={d}";
    }

    private static string FirstLine(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var line = s.Split('\n')[0].Trim();
        return line.Length > 40 ? line[..40] + "…" : line;
    }

    private static string Norm(string? t) => (t ?? "").Trim().ToLowerInvariant();
    private static bool IsValidType(string t) => t is TypeTask or TypeSubtask or TypeNote or TypeNode;

    /// <summary>
    /// 驗證某實體存在、有效，且為該使用者所擁有（多租戶邊界）。
    /// 任務/子任務/筆記以 UserId 驗擁；節點非 IUserOwned，改以其 Canvas 的 UserId 驗擁。
    /// 任何寫入關聯（建立/從某實體建立）前都必須通過此檢查，避免跨使用者關聯。
    /// </summary>
    private static async Task<bool> OwnsEntityAsync(
        ZonWikiDbContext db, Guid userGuid, string type, Guid id, CancellationToken ct)
    {
        switch (type)
        {
            case TypeTask:
                return await db.TaskCard.IgnoreQueryFilters()
                    .AnyAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
            case TypeSubtask:
                return await db.SubTask.IgnoreQueryFilters()
                    .AnyAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
            case TypeNote:
                return await db.Note.IgnoreQueryFilters()
                    .AnyAsync(x => x.Id == id && x.UserId == userGuid && x.ValidFlag, ct);
            case TypeNode:
                // 節點非 IUserOwned：經 Canvas.UserId 驗擁
                return await db.Node.Where(n => n.Id == id && n.ValidFlag)
                    .Join(
                        db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == userGuid && c.ValidFlag),
                        n => n.CanvasId,
                        c => c.Id,
                        (n, c) => c.Id)
                    .AnyAsync(ct);
            default:
                return false;
        }
    }

    /// <summary>
    /// 跳脫 ILike 樣式中的特殊字元（% _ \），避免使用者輸入被當成萬用字元。
    /// 搭配 EF.Functions.ILike 的跳脫字元參數 "\\" 使用。
    /// </summary>
    private static string EscapeLike(string term) =>
        term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var id = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(id, out userGuid);
    }

    private static string GenerateSlug(string title)
    {
        var slug = Regex.Replace(title.ToLowerInvariant(), @"[^\w\s-]", string.Empty);
        slug = Regex.Replace(slug, @"[\s]+", "-");
        slug = Regex.Replace(slug, @"-+", "-").Trim('-');
        return slug;
    }
}
