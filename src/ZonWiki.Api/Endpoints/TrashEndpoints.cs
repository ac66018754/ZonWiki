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

            // 註：列「所有軟刪除列」(!ValidFlag)，刪除時間用 DeletedDateTime ?? UpdatedDateTime——
            // 早期刪除（修正前）未寫 DeletedDateTime，仍要能在垃圾桶看到（以更新時間近似刪除時間）。

            // --- 筆記 ---
            var notes = await db.Note.IgnoreQueryFilters()
                .Where(n => n.UserId == userGuid && !n.ValidFlag)
                .Select(n => new { n.Id, n.Title, n.ContentRaw, D = n.DeletedDateTime ?? n.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(notes.Select(n => new TrashItemDto(
                n.Id, "Note", "筆記",
                string.IsNullOrWhiteSpace(n.Title) ? "(無標題筆記)" : n.Title,
                Snip(n.ContentRaw), n.D)));

            // --- 筆記分類 ---
            var categories = await db.Category.IgnoreQueryFilters()
                .Where(c => c.UserId == userGuid && !c.ValidFlag)
                .Select(c => new { c.Id, c.Name, D = c.DeletedDateTime ?? c.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(categories.Select(c => new TrashItemDto(
                c.Id, "Category", "筆記分類", c.Name, null, c.D)));

            // --- 標籤（與筆記/任務/常用連結共用） ---
            var tags = await db.Tag.IgnoreQueryFilters()
                .Where(t => t.UserId == userGuid && !t.ValidFlag)
                .Select(t => new { t.Id, t.Name, D = t.DeletedDateTime ?? t.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(tags.Select(t => new TrashItemDto(
                t.Id, "Tag", "標籤", t.Name, null, t.D)));

            // --- 任務 ---
            var taskCards = await db.TaskCard.IgnoreQueryFilters()
                .Where(tc => tc.UserId == userGuid && !tc.ValidFlag)
                .Select(tc => new { tc.Id, tc.Title, tc.Content, D = tc.DeletedDateTime ?? tc.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(taskCards.Select(tc => new TrashItemDto(
                tc.Id, "TaskCard", "任務",
                string.IsNullOrWhiteSpace(tc.Title) ? "(無標題任務)" : tc.Title,
                Snip(tc.Content), tc.D)));

            // --- 任務分類 ---
            var taskGroups = await db.TaskGroup.IgnoreQueryFilters()
                .Where(tg => tg.UserId == userGuid && !tg.ValidFlag)
                .Select(tg => new { tg.Id, tg.Name, D = tg.DeletedDateTime ?? tg.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(taskGroups.Select(tg => new TrashItemDto(
                tg.Id, "TaskGroup", "任務分類", tg.Name, null, tg.D)));

            // --- 快速記錄 ---
            var captures = await db.CaptureItem.IgnoreQueryFilters()
                .Where(ci => ci.UserId == userGuid && !ci.ValidFlag)
                .Select(ci => new { ci.Id, ci.RawContent, D = ci.DeletedDateTime ?? ci.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(captures.Select(ci => new TrashItemDto(
                ci.Id, "CaptureItem", "快速記錄",
                Snip(ci.RawContent, 40) ?? "(空白記錄)",
                Snip(ci.RawContent), ci.D)));

            // --- 常用連結 ---
            var quickLinks = await db.QuickLink.IgnoreQueryFilters()
                .Where(ql => ql.UserId == userGuid && !ql.ValidFlag)
                .Select(ql => new { ql.Id, ql.Title, ql.Url, D = ql.DeletedDateTime ?? ql.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(quickLinks.Select(ql => new TrashItemDto(
                ql.Id, "QuickLink", "常用連結",
                string.IsNullOrWhiteSpace(ql.Title) ? "(無標題連結)" : ql.Title,
                ql.Url, ql.D)));

            // --- 開問啦・畫布 ---
            var canvases = await db.Canvas.IgnoreQueryFilters()
                .Where(cv => cv.UserId == userGuid && !cv.ValidFlag)
                .Select(cv => new { cv.Id, cv.Title, D = cv.DeletedDateTime ?? cv.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(canvases.Select(cv => new TrashItemDto(
                cv.Id, "Canvas", "開問啦・畫布",
                string.IsNullOrWhiteSpace(cv.Title) ? "(未命名畫布)" : cv.Title, null, cv.D)));

            // --- 開問啦・節點（Node 非 IUserOwned，經其 Canvas 判擁；只列「畫布仍在、節點被刪」者，
            //     避免與「整張畫布被刪」重複） ---
            var nodes = await db.Node.IgnoreQueryFilters()
                .Where(n => !n.ValidFlag)
                .Join(
                    db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == userGuid && c.ValidFlag),
                    n => n.CanvasId,
                    c => c.Id,
                    (n, c) => new { n.Id, n.Title, n.Content, D = n.DeletedDateTime ?? n.UpdatedDateTime })
                .ToListAsync(ct);
            items.AddRange(nodes.Select(n => new TrashItemDto(
                n.Id, "Node", "開問啦・節點",
                NodeTitle(n.Title, n.Content), Snip(n.Content), n.D)));

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
                "Note" => await RestoreOwnedAsync(db, db.Note, id, userGuid, userId, ct),
                "Category" => await RestoreOwnedAsync(db, db.Category, id, userGuid, userId, ct),
                "Tag" => await RestoreOwnedAsync(db, db.Tag, id, userGuid, userId, ct),
                "TaskCard" => await RestoreOwnedAsync(db, db.TaskCard, id, userGuid, userId, ct),
                "TaskGroup" => await RestoreOwnedAsync(db, db.TaskGroup, id, userGuid, userId, ct),
                "CaptureItem" => await RestoreOwnedAsync(db, db.CaptureItem, id, userGuid, userId, ct),
                "QuickLink" => await RestoreOwnedAsync(db, db.QuickLink, id, userGuid, userId, ct),
                "Canvas" => await RestoreOwnedAsync(db, db.Canvas, id, userGuid, userId, ct),
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
        entity.UpdatedDateTime = DateTime.UtcNow;
        entity.UpdatedUser = userId;
        await db.SaveChangesAsync(ct);

        return Results.Ok(ApiResponse<object>.Ok(new { message = "還原成功" }));
    }

    /// <summary>
    /// 永久刪除一個 IUserOwned 實體（以 IgnoreQueryFilters + 明確 UserId 載入軟刪除列後從 DB 移除）。
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

        set.Remove(entity);
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
        node.UpdatedDateTime = DateTime.UtcNow;
        node.UpdatedUser = userId;

        await db.SaveChangesAsync(ct);

        return Results.Ok(ApiResponse<object>.Ok(new { message = "還原成功" }));
    }

    /// <summary>
    /// 永久刪除開問啦節點：經其所屬 Canvas 驗證擁有者後從 DB 移除。
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

        db.Node.Remove(node);
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    }
}
