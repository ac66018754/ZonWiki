using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 跨模組「統一垃圾桶」API：
/// GET /api/trash（列出所有已軟刪除的使用者項目，含模組分區、內容預覽、刪除時間）、
/// POST /api/trash/{type}/{id}/restore（還原）、
/// DELETE /api/trash/{type}/{id}（永久刪除）。
///
/// 重點：全域查詢過濾器為「UserId==目前使用者 AND ValidFlag==true」，會把軟刪除列濾掉；
/// 因此垃圾桶相關查詢一律 <c>IgnoreQueryFilters()</c> 並明確比對 UserId + !ValidFlag。
/// 開問啦的畫布(Canvas)與節點(Node)也併入此統一垃圾桶（Node 非 IUserOwned，經其 Canvas 判擁）。
/// </summary>
public static class TrashEndpoints
{
    /// <summary>垃圾桶最多列出的項目數（個人工具足夠，避免極端情況一次撈爆）。</summary>
    private const int MaxItems = 2000;

    /// <summary>
    /// 截斷文字為預覽片段（去除換行、限制長度）。空白回傳 null。
    /// </summary>
    private static string? Snip(string? text, int max = 80)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var oneLine = text.Replace("\r", " ").Replace("\n", " ").Trim();
        return oneLine.Length > max ? oneLine[..max] + "…" : oneLine;
    }

    /// <summary>
    /// 從便利貼的 dataJson（{ title?, highlights? }）取自訂標題；無則回 null。
    /// </summary>
    private static string? StickyTitleFromDataJson(string? dataJson)
    {
        if (string.IsNullOrWhiteSpace(dataJson))
        {
            return null;
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(dataJson);
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("title", out var titleEl) &&
                titleEl.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var title = titleEl.GetString();
                return string.IsNullOrWhiteSpace(title) ? null : title.Trim();
            }
        }
        catch
        {
            // 舊格式（純陣列）或壞 JSON → 無自訂標題
        }

        return null;
    }

    /// <summary>
    /// 把 UTC 時間以指定時區格式化為「M/d」（給「排程於 …」用）；時區解析失敗則退回 UTC。
    /// </summary>
    private static string FormatDateInTz(DateTime utc, string? timeZoneId)
    {
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(timeZoneId) ? "Asia/Taipei" : timeZoneId);
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz);
            return local.ToString("M/d");
        }
        catch
        {
            return utc.ToString("M/d");
        }
    }

    /// <summary>
    /// 取節點顯示標題：優先用 Title，否則用內容首段，皆無則給預設字樣。
    /// </summary>
    private static string NodeTitle(string? title, string? content)
    {
        if (!string.IsNullOrWhiteSpace(title))
        {
            return title.Trim();
        }

        return Snip(content, 40) ?? "(無標題節點)";
    }

    /// <summary>
    /// 註冊統一垃圾桶相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapTrashEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 列出當前使用者垃圾桶內所有已軟刪除項目（依刪除時間倒序；含模組分區與內容預覽）。
        /// GET /api/trash
        /// </summary>
        app.MapGet("/api/trash", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct = default) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var items = new List<TrashItemDto>();

            // 使用者時區（給「排程於 …」這類日期 context 用；存 UTC、依使用者時區顯示）。
            var userTimeZone = await db.User
                .Where(u => u.Id == userGuid)
                .Select(u => u.TimeZone)
                .FirstOrDefaultAsync(ct);

            // 註：列「所有軟刪除列」(!ValidFlag)，刪除時間用 DeletedDateTime ?? UpdatedDateTime——
            // 早期刪除（修正前）未寫 DeletedDateTime，仍要能在垃圾桶看到（以更新時間近似刪除時間）。

            // --- 筆記 ---
            var notes = await db.Note.IgnoreQueryFilters()
                .Where(n => n.UserId == userGuid && !n.ValidFlag && n.PurgedDateTime == null)
                .Select(n => new { n.Id, n.Title, n.ContentRaw, D = n.DeletedDateTime ?? n.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(notes.Select(n => new TrashItemDto(
                n.Id, "Note", "筆記",
                string.IsNullOrWhiteSpace(n.Title) ? "(無標題筆記)" : n.Title,
                Snip(n.ContentRaw), n.D)));

            // --- 筆記分類 ---
            var categories = await db.Category.IgnoreQueryFilters()
                .Where(c => c.UserId == userGuid && !c.ValidFlag && c.PurgedDateTime == null)
                .Select(c => new { c.Id, c.Name, D = c.DeletedDateTime ?? c.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(categories.Select(c => new TrashItemDto(
                c.Id, "Category", "筆記分類", c.Name, null, c.D)));

            // --- 標籤（與筆記/任務/常用連結共用） ---
            var tags = await db.Tag.IgnoreQueryFilters()
                .Where(t => t.UserId == userGuid && !t.ValidFlag && t.PurgedDateTime == null)
                .Select(t => new { t.Id, t.Name, D = t.DeletedDateTime ?? t.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(tags.Select(t => new TrashItemDto(
                t.Id, "Tag", "標籤", t.Name, null, t.D)));

            // --- 任務 ---
            var taskCards = await db.TaskCard.IgnoreQueryFilters()
                .Where(tc => tc.UserId == userGuid && !tc.ValidFlag && tc.PurgedDateTime == null)
                .Select(tc => new { tc.Id, tc.Title, tc.Content, tc.PlannedDateTime, tc.DueDateTime, D = tc.DeletedDateTime ?? tc.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(taskCards.Select(tc =>
            {
                // 還原後回到哪：有排程/截止日 → 「排程於 M/D」（行事曆該天）；否則「未排程任務」。
                var when = tc.PlannedDateTime ?? tc.DueDateTime;
                var ctx = when.HasValue ? $"排程於 {FormatDateInTz(when.Value, userTimeZone)}" : "未排程任務";
                return new TrashItemDto(
                    tc.Id, "TaskCard", "任務",
                    string.IsNullOrWhiteSpace(tc.Title) ? "(無標題任務)" : tc.Title,
                    Snip(tc.Content), tc.D, ctx);
            }));

            // --- 任務分類 ---
            var taskGroups = await db.TaskGroup.IgnoreQueryFilters()
                .Where(tg => tg.UserId == userGuid && !tg.ValidFlag && tg.PurgedDateTime == null)
                .Select(tg => new { tg.Id, tg.Name, D = tg.DeletedDateTime ?? tg.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(taskGroups.Select(tg => new TrashItemDto(
                tg.Id, "TaskGroup", "任務分類", tg.Name, null, tg.D)));

            // --- 快速記錄 ---
            var captures = await db.CaptureItem.IgnoreQueryFilters()
                .Where(ci => ci.UserId == userGuid && !ci.ValidFlag && ci.PurgedDateTime == null)
                .Select(ci => new { ci.Id, ci.RawContent, D = ci.DeletedDateTime ?? ci.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(captures.Select(ci => new TrashItemDto(
                ci.Id, "CaptureItem", "快速記錄",
                Snip(ci.RawContent, 40) ?? "(空白記錄)",
                Snip(ci.RawContent), ci.D)));

            // --- 常用連結 ---
            var quickLinks = await db.QuickLink.IgnoreQueryFilters()
                .Where(ql => ql.UserId == userGuid && !ql.ValidFlag && ql.PurgedDateTime == null)
                .Select(ql => new { ql.Id, ql.Title, ql.Url, D = ql.DeletedDateTime ?? ql.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(quickLinks.Select(ql => new TrashItemDto(
                ql.Id, "QuickLink", "常用連結",
                string.IsNullOrWhiteSpace(ql.Title) ? "(無標題連結)" : ql.Title,
                ql.Url, ql.D)));

            // --- 開問啦・畫布 ---
            var canvases = await db.Canvas.IgnoreQueryFilters()
                .Where(cv => cv.UserId == userGuid && !cv.ValidFlag && cv.PurgedDateTime == null)
                .Select(cv => new { cv.Id, cv.Title, D = cv.DeletedDateTime ?? cv.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(canvases.Select(cv => new TrashItemDto(
                cv.Id, "Canvas", "開問啦・畫布",
                string.IsNullOrWhiteSpace(cv.Title) ? "(未命名畫布)" : cv.Title, null, cv.D)));

            // --- 開問啦・節點（Node 非 IUserOwned，經其 Canvas 判擁；只列「畫布仍在、節點被刪」者，
            //     避免與「整張畫布被刪」重複） ---
            var nodes = await db.Node.IgnoreQueryFilters()
                .Where(n => !n.ValidFlag && n.PurgedDateTime == null)
                .Join(
                    db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == userGuid && c.ValidFlag),
                    n => n.CanvasId,
                    c => c.Id,
                    (n, c) => new { n.Id, n.Title, n.Content, CanvasTitle = c.Title, D = n.DeletedDateTime ?? n.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(nodes.Select(n => new TrashItemDto(
                n.Id, "Node", "開問啦・節點",
                NodeTitle(n.Title, n.Content), Snip(n.Content), n.D,
                string.IsNullOrWhiteSpace(n.CanvasTitle) ? "畫布" : $"畫布《{n.CanvasTitle}》")));

            // --- 筆記浮層元件（便利貼 / 手繪塗鴉 / 圖片板）---
            // 歸入「便利貼」分區（使用者最直覺找得到；前端 GROUP_ORDER 對應此名）。
            // 標題：便利貼用文字片段；塗鴉/圖片板無文字，給人類可讀名稱。
            var overlayItems = await db.NoteOverlayItem.IgnoreQueryFilters()
                .Where(oi => oi.UserId == userGuid && !oi.ValidFlag && oi.PurgedDateTime == null)
                .Select(oi => new { oi.Id, oi.Kind, oi.Text, oi.DataJson, oi.NoteId, D = oi.DeletedDateTime ?? oi.UpdatedDateTime })
                .ToListAsync(ct);
            // 各便利貼所屬筆記標題（還原後回到哪篇筆記）。
            var overlayNoteIds = overlayItems.Select(oi => oi.NoteId).Distinct().ToList();
            var overlayNoteTitleMap = (await db.Note.IgnoreQueryFilters()
                .Where(n => overlayNoteIds.Contains(n.Id))
                .Select(n => new { n.Id, n.Title })
                .ToListAsync(ct))
                .ToDictionary(n => n.Id, n => n.Title);
            items.AddRange(overlayItems.Select(oi => new TrashItemDto(
                oi.Id, "NoteOverlayItem", "便利貼",
                oi.Kind == "sticky"
                    ? (StickyTitleFromDataJson(oi.DataJson) ?? Snip(oi.Text, 40) ?? "(空白便利貼)")
                    : oi.Kind == "drawing"
                        ? "手繪塗鴉"
                        : "圖片板",
                oi.Kind == "sticky" ? Snip(oi.Text) : null,
                oi.D,
                overlayNoteTitleMap.TryGetValue(oi.NoteId, out var nt) && !string.IsNullOrWhiteSpace(nt)
                    ? $"筆記《{nt}》"
                    : "（筆記已不存在）")));

            // --- 開問啦畫布便利貼（與筆記便利貼同一「便利貼」分區）---
            var canvasAnnos = await db.CanvasAnnotation.IgnoreQueryFilters()
                .Where(a => a.UserId == userGuid && !a.ValidFlag && a.PurgedDateTime == null)
                .Select(a => new { a.Id, a.Kind, a.Text, a.DataJson, a.CanvasId, D = a.DeletedDateTime ?? a.UpdatedDateTime })
                .ToListAsync(ct);
            // 各畫布便利貼所屬畫布標題（還原後回到哪張畫布）。
            var annoCanvasIds = canvasAnnos.Select(a => a.CanvasId).Distinct().ToList();
            var annoCanvasTitleMap = (await db.Canvas.IgnoreQueryFilters()
                .Where(c => annoCanvasIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Title })
                .ToListAsync(ct))
                .ToDictionary(c => c.Id, c => c.Title);
            items.AddRange(canvasAnnos.Select(a => new TrashItemDto(
                a.Id, "CanvasAnnotation", "便利貼",
                a.Kind == "sticky"
                    ? (StickyTitleFromDataJson(a.DataJson) ?? Snip(a.Text, 40) ?? "(空白便利貼)")
                    : a.Kind == "drawing"
                        ? "手繪塗鴉"
                        : "圖片板",
                a.Kind == "sticky" ? Snip(a.Text) : null,
                a.D,
                annoCanvasTitleMap.TryGetValue(a.CanvasId, out var cvt) && !string.IsNullOrWhiteSpace(cvt)
                    ? $"畫布《{cvt}》"
                    : "（畫布已不存在）")));

            var result = items
                .OrderByDescending(x => x.DeletedDateTime)
                .Take(MaxItems)
                .ToList();

            return Results.Ok(ApiResponse<List<TrashItemDto>>.Ok(result));
        });

        /// <summary>
        /// 還原已刪除的項目（ValidFlag=true、DeletedDateTime=null）。
        /// POST /api/trash/{type}/{id}/restore
        /// </summary>
        app.MapPost("/api/trash/{type}/{id:guid}/restore", async (
            string type,
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 依型別還原。每型別以 IgnoreQueryFilters + 明確 UserId 載入軟刪除列
            // （FindAsync 會套用全域 ValidFlag 過濾、找不到軟刪除列，故不可用）。
            return type switch
            {
                // Note 特例：還原時需處理 slug 唯一索引（partial）衝突，故走專屬流程。
                "Note" => await RestoreNoteAsync(db, id, userGuid, userId, ct),
                "Category" => await RestoreOwnedAsync(db, db.Category, id, userGuid, userId, ct),
                "Tag" => await RestoreOwnedAsync(db, db.Tag, id, userGuid, userId, ct),
                "TaskCard" => await RestoreOwnedAsync(db, db.TaskCard, id, userGuid, userId, ct),
                "TaskGroup" => await RestoreOwnedAsync(db, db.TaskGroup, id, userGuid, userId, ct),
                "CaptureItem" => await RestoreOwnedAsync(db, db.CaptureItem, id, userGuid, userId, ct),
                "QuickLink" => await RestoreOwnedAsync(db, db.QuickLink, id, userGuid, userId, ct),
                "Canvas" => await RestoreOwnedAsync(db, db.Canvas, id, userGuid, userId, ct),
                "NoteOverlayItem" => await RestoreOwnedAsync(db, db.NoteOverlayItem, id, userGuid, userId, ct),
                "CanvasAnnotation" => await RestoreOwnedAsync(db, db.CanvasAnnotation, id, userGuid, userId, ct),
                // 開問啦節點：非 IUserOwned，經其 Canvas 判擁，特例處理。
                "Node" => await RestoreNodeAsync(db, id, userGuid, userId, ct),
                _ => Results.BadRequest(ApiResponse<object>.Fail($"不支援的型別：{type}", 400)),
            };
        });

        /// <summary>
        /// 永久刪除已刪除的項目（直接從 DB 移除，不可恢復）。
        /// DELETE /api/trash/{type}/{id}
        /// </summary>
        app.MapDelete("/api/trash/{type}/{id:guid}", async (
            string type,
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 依型別永久刪除（同樣以 IgnoreQueryFilters + 明確 UserId 載入軟刪除列）。
            return type switch
            {
                "Note" => await PurgeOwnedAsync(db, db.Note, id, userGuid, ct),
                "Category" => await PurgeOwnedAsync(db, db.Category, id, userGuid, ct),
                "Tag" => await PurgeOwnedAsync(db, db.Tag, id, userGuid, ct),
                "TaskCard" => await PurgeOwnedAsync(db, db.TaskCard, id, userGuid, ct),
                "TaskGroup" => await PurgeOwnedAsync(db, db.TaskGroup, id, userGuid, ct),
                "CaptureItem" => await PurgeOwnedAsync(db, db.CaptureItem, id, userGuid, ct),
                "QuickLink" => await PurgeOwnedAsync(db, db.QuickLink, id, userGuid, ct),
                "Canvas" => await PurgeOwnedAsync(db, db.Canvas, id, userGuid, ct),
                "NoteOverlayItem" => await PurgeOwnedAsync(db, db.NoteOverlayItem, id, userGuid, ct),
                "CanvasAnnotation" => await PurgeOwnedAsync(db, db.CanvasAnnotation, id, userGuid, ct),
                // 開問啦節點：非 IUserOwned，經其 Canvas 判擁，特例處理。
                "Node" => await PurgeNodeAsync(db, id, userGuid, ct),
                _ => Results.BadRequest(ApiResponse<object>.Fail($"不支援的型別：{type}", 400)),
            };
        });
    }

    /// <summary>
    /// 還原一個 IUserOwned 實體（以 IgnoreQueryFilters + 明確 UserId 載入軟刪除列後復原）。
    /// </summary>
    private static async Task<IResult> RestoreOwnedAsync<T>(
        ZonWikiDbContext db,
        DbSet<T> set,
        Guid id,
        Guid userGuid,
        string userId,
        CancellationToken ct)
        where T : AuditableEntity, IUserOwned
    {
        var entity = await set.IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == id && x.UserId == userGuid, ct);
        if (entity is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail($"找不到該項目（ID：{id}）", 404));
        }

        entity.ValidFlag = true;
        entity.DeletedDateTime = null;
        entity.PurgedDateTime = null; // 還原時一併清除清除標記（即使是已 purged 的列也能救回）
        entity.UpdatedDateTime = DateTime.UtcNow;
        entity.UpdatedUser = userId;
        await db.SaveChangesAsync(ct);

        return Results.Ok(ApiResponse<object>.Ok(new { message = "還原成功" }));
    }

    /// <summary>
    /// 還原筆記（Note 特例）：除一般還原外，因 slug 唯一索引為 partial（只對「有效」筆記強制唯一），
    /// 若被還原筆記的 slug 在「還原當下」已被另一篇有效筆記佔用，會自動為被還原者的 slug 加序號
    /// （-2、-3…）以避免違反唯一索引（否則還原會回 500）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="id">要還原的筆記識別碼。</param>
    /// <param name="userGuid">使用者識別碼（擁有權驗證）。</param>
    /// <param name="userId">使用者識別字串（寫入 UpdatedUser）。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task<IResult> RestoreNoteAsync(
        ZonWikiDbContext db,
        Guid id,
        Guid userGuid,
        string userId,
        CancellationToken ct)
    {
        var note = await db.Note.IgnoreQueryFilters()
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userGuid, ct);
        if (note is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail($"找不到該項目（ID：{id}）", 404));
        }

        // slug 衝突保護：若同使用者已有「有效」筆記用了相同 slug，為被還原者加序號避免撞唯一索引。
        var baseSlug = note.Slug;
        var slug = baseSlug;
        for (var i = 2;
             await db.Note.IgnoreQueryFilters()
                 .AnyAsync(n => n.UserId == userGuid && n.ValidFlag && n.Slug == slug && n.Id != id, ct);
             i++)
        {
            slug = $"{baseSlug}-{i}";
        }
        note.Slug = slug;

        note.ValidFlag = true;
        note.DeletedDateTime = null;
        note.PurgedDateTime = null;
        note.UpdatedDateTime = DateTime.UtcNow;
        note.UpdatedUser = userId;
        await db.SaveChangesAsync(ct);

        return Results.Ok(ApiResponse<object>.Ok(new { message = "還原成功" }));
    }

    /// <summary>
    /// 永久刪除一個 IUserOwned 實體。
    /// 決策（「絕不硬刪除、一切可復原」）：不從 DB 移除實體列，改為標記 PurgedDateTime，
    /// ValidFlag 維持 false（仍是已刪除狀態），垃圾桶清單會排除已 purged 者 → 使用者看不到、
    /// 但資料仍留在 DB（必要時可由 DB 將 ValidFlag 壓回 true 復活）。
    /// </summary>
    private static async Task<IResult> PurgeOwnedAsync<T>(
        ZonWikiDbContext db,
        DbSet<T> set,
        Guid id,
        Guid userGuid,
        CancellationToken ct)
        where T : AuditableEntity, IUserOwned
    {
        var entity = await set.IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == id && x.UserId == userGuid, ct);
        if (entity is null)
        {
            return Results.NotFound(ApiResponse<object>.Fail($"找不到該項目（ID：{id}）", 404));
        }

        // 軟性永久刪除：標記清除時間，列留在 DB、可復原（非 set.Remove 硬刪）。
        entity.PurgedDateTime = DateTime.UtcNow;
        entity.UpdatedDateTime = DateTime.UtcNow;
        entity.UpdatedUser = userGuid.ToString();
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }

    /// <summary>
    /// 還原開問啦節點：經其所屬 Canvas 驗證擁有者後復原（ValidFlag=true）。
    /// </summary>
    private static async Task<IResult> RestoreNodeAsync(
        ZonWikiDbContext db,
        Guid nodeId,
        Guid userGuid,
        string userId,
        CancellationToken ct)
    {
        var node = await db.Node.IgnoreQueryFilters()
            .Include(n => n.Canvas)
            .FirstOrDefaultAsync(n => n.Id == nodeId, ct);

        if (node is null || node.Canvas is null || node.Canvas.UserId != userGuid)
        {
            return Results.NotFound(ApiResponse<object>.Fail($"找不到該節點（ID：{nodeId}）", 404));
        }

        node.ValidFlag = true;
        node.DeletedDateTime = null;
        node.PurgedDateTime = null; // 還原時一併清除清除標記
        node.UpdatedDateTime = DateTime.UtcNow;
        node.UpdatedUser = userId;

        await db.SaveChangesAsync(ct);

        return Results.Ok(ApiResponse<object>.Ok(new { message = "還原成功" }));
    }

    /// <summary>
    /// 永久刪除開問啦節點：經其所屬 Canvas 驗證擁有者後，標記 PurgedDateTime（列留 DB、可復原），
    /// 同樣不做硬刪（與 <see cref="PurgeOwnedAsync{T}"/> 一致的「絕不硬刪除」原則）。
    /// </summary>
    private static async Task<IResult> PurgeNodeAsync(
        ZonWikiDbContext db,
        Guid nodeId,
        Guid userGuid,
        CancellationToken ct)
    {
        var node = await db.Node.IgnoreQueryFilters()
            .Include(n => n.Canvas)
            .FirstOrDefaultAsync(n => n.Id == nodeId, ct);

        if (node is null || node.Canvas is null || node.Canvas.UserId != userGuid)
        {
            return Results.NotFound(ApiResponse<object>.Fail($"找不到該節點（ID：{nodeId}）", 404));
        }

        // 軟性永久刪除：標記清除時間，列留在 DB、可復原（非 db.Node.Remove 硬刪）。
        node.PurgedDateTime = DateTime.UtcNow;
        node.UpdatedDateTime = DateTime.UtcNow;
        node.UpdatedUser = userGuid.ToString();
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }
}
