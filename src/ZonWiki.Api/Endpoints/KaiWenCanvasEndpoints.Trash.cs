using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——垃圾桶（還原誤刪的畫布 / 節點、軟性清除、清空）。
/// 這些端點以 <c>IgnoreQueryFilters</c> 讀取 ValidFlag=false 的資料，語意與一般 CRUD 不同，
/// 故不經 <see cref="ZonWiki.Api.Services.CanvasService"/>，保留專用查詢。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 取得垃圾桶清單：該使用者已軟刪除的畫布，以及「單獨刪除、其畫布仍存在」的節點。
    /// </summary>
    private static async Task<IResult> GetTrash(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<TrashListingDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 已刪除的畫布（須 IgnoreQueryFilters 才看得到 ValidFlag=false 的資料）
        var deletedCanvases = await db.Canvas
            .IgnoreQueryFilters()
            .Where(c => c.UserId == currentUser.UserId && !c.ValidFlag && c.PurgedDateTime == null)
            .OrderByDescending(c => c.UpdatedDateTime)
            .Select(c => new TrashCanvasDto(
                c.Id.ToString(),
                c.Title,
                (c.DeletedDateTime ?? c.UpdatedDateTime).ToString("o"),
                c.Nodes.Count))
            .ToListAsync(ct);

        // 已刪除的節點：節點本身被刪、但其畫布仍存在（避免與「整張畫布刪除」重複列出）
        var rawNodes = await db.Node
            .IgnoreQueryFilters()
            .Where(n => !n.ValidFlag && n.PurgedDateTime == null)
            .Join(
                db.Canvas.IgnoreQueryFilters()
                    .Where(c => c.UserId == currentUser.UserId && c.ValidFlag),
                n => n.CanvasId,
                c => c.Id,
                (n, c) => new
                {
                    n.Id,
                    n.CanvasId,
                    CanvasTitle = c.Title,
                    n.Content,
                    n.CreatedDateTime,
                    n.UpdatedDateTime,
                    n.DeletedDateTime,
                })
            .OrderByDescending(x => x.UpdatedDateTime)
            .ToListAsync(ct);

        var deletedNodes = rawNodes
            .Select(x => new TrashNodeDto(
                x.Id.ToString(),
                x.CanvasId.ToString(),
                x.CanvasTitle,
                FirstLineSnippet(x.Content),
                FirstLineSnippet(x.Content),
                x.CreatedDateTime.ToString("o"),
                (x.DeletedDateTime ?? x.UpdatedDateTime).ToString("o")))
            .ToList();

        return CanvasJsonHelper.JsonOk(
            ApiResponse<TrashListingDto>.Ok(new TrashListingDto(deletedCanvases, deletedNodes)));
    }

    /// <summary>
    /// 取內容首行作為片段（去除開頭的 Markdown 標記、限長 80），空白則回「(空白節點)」。
    /// </summary>
    private static string FirstLineSnippet(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return "(空白節點)";
        }

        var line = content
            .Split('\n')
            .Select(l => l.Trim())
            .FirstOrDefault(l => l.Length > 0) ?? string.Empty;

        line = line.TrimStart('#', ' ', '>', '-', '*').Trim();
        if (line.Length > 80)
        {
            line = string.Concat(line.AsSpan(0, 80), "…");
        }

        return line.Length > 0 ? line : "(空白節點)";
    }

    /// <summary>
    /// 還原已刪除的畫布（ValidFlag=true、清空刪除時間）。
    /// </summary>
    private static async Task<IResult> RestoreCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        canvas.ValidFlag = true;
        canvas.DeletedDateTime = null;
        canvas.PurgedDateTime = null; // 還原時一併清除清除標記
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 還原已刪除的節點（須屬於該使用者的畫布）。
    /// </summary>
    private static async Task<IResult> RestoreNode(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // Node 無 UserId，藉由其畫布的 UserId 做 per-user 授權
        var node = await db.Node
            .IgnoreQueryFilters()
            .Where(n => n.Id == nodeGuid)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .FirstOrDefaultAsync(ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        node.ValidFlag = true;
        node.DeletedDateTime = null;
        node.PurgedDateTime = null; // 還原時一併清除清除標記
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 永久刪除垃圾桶中的畫布。
    /// 決策（「絕不硬刪除、一切可復原」，見 CLAUDE.md §3）：不從 DB 移除，改標記 PurgedDateTime，
    /// ValidFlag 維持 false，垃圾桶清單排除已 purged 者；列仍留在 DB（可由 DB 將 ValidFlag 壓回復活）。
    /// </summary>
    private static async Task<IResult> PurgeCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟性永久刪除（絕不硬刪）：標記 PurgedDateTime，列留 DB、可復原。
        canvas.PurgedDateTime = DateTime.UtcNow;
        canvas.UpdatedDateTime = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 永久刪除垃圾桶中的節點（軟性標記，須屬於該使用者的畫布；絕不硬刪、可復原）。
    /// </summary>
    private static async Task<IResult> PurgeNode(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .IgnoreQueryFilters()
            .Where(n => n.Id == nodeGuid)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .FirstOrDefaultAsync(ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟性永久刪除（絕不硬刪）：標記 PurgedDateTime，列留 DB、可復原。
        node.PurgedDateTime = DateTime.UtcNow;
        node.UpdatedDateTime = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 清空垃圾桶：把該使用者所有「在垃圾桶中（軟刪除、尚未 purged）」的畫布與節點標記為 purged
    /// （軟性，絕不硬刪、可復原）。
    /// </summary>
    private static async Task<IResult> EmptyTrash(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var purgedAt = DateTime.UtcNow;

        var canvases = await db.Canvas
            .IgnoreQueryFilters()
            .Where(c => c.UserId == currentUser.UserId && !c.ValidFlag && c.PurgedDateTime == null)
            .ToListAsync(ct);

        var nodes = await db.Node
            .IgnoreQueryFilters()
            .Where(n => !n.ValidFlag && n.PurgedDateTime == null)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .ToListAsync(ct);

        // 軟性清空（絕不硬刪）：逐筆標記 PurgedDateTime，列留 DB、可復原。
        foreach (var node in nodes)
        {
            node.PurgedDateTime = purgedAt;
            node.UpdatedDateTime = purgedAt;
        }
        foreach (var canvas in canvases)
        {
            canvas.PurgedDateTime = purgedAt;
            canvas.UpdatedDateTime = purgedAt;
        }
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }
}
