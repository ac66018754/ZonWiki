using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——畫布本身的 CRUD 與整張圖譜載入。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 列出目前使用者的所有畫布。
    /// </summary>
    private static async Task<IResult> ListCanvases(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<CanvasDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var canvases = await db.Canvas
            .Where(c => c.UserId == currentUser.UserId)
            .OrderByDescending(c => c.UpdatedDateTime)
            .Select(c => new CanvasDto(
                c.Id.ToString(),
                c.Title,
                c.Description,
                c.StateJson))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<CanvasDto>>.Ok(canvases));
    }

    /// <summary>
    /// 建立新的畫布。
    /// </summary>
    private static async Task<IResult> CreateCanvas(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateCanvasRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 驗證標題
        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasDto>.Fail("Title is required"),
                StatusCodes.Status400BadRequest);
        }

        var canvas = new Canvas
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            Title = req.Title,
            Description = string.Empty,
            StateJson = "{}",
        };

        db.Canvas.Add(canvas);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasDto>.Ok(canvas.ToDto()), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 取得畫布的完整圖譜（含所有節點、邊、行內連結、重點）。
    /// </summary>
    private static async Task<IResult> GetCanvasGraph(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Invalid canvas ID"),
                StatusCodes.Status400BadRequest);
        }

        // 驗證該畫布屬於目前使用者
        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Canvas not found", 404),
                StatusCodes.Status404NotFound);
        }

        // 逐一查詢（同一個 DbContext 不可並行多查詢，否則會丟「A second operation was started…」例外）
        //
        // 樂觀鎖版本（#4/#34）：xmin 是 PostgreSQL 的 xid 系統欄。若在投影裡直接寫
        // (long)EF.Property<uint>(n, "xmin")，EF 會把 (long) 轉型下推成 SQL 的
        // CAST(xmin AS bigint)——但 PostgreSQL 不允許 xid→bigint 轉型，執行期會丟
        // 「42846: cannot cast type xid to bigint」，導致整張畫布載入 500。
        // 因此改以「原生 xid→uint 讀出（不加任何轉型、不下推 CAST）」，材質化後再於記憶體
        // 把 uint 版本安全放大為 long 回填 DTO。
        //
        // 注意：以下 EF 投影會被翻譯成 SQL，不可改用 CanvasMappingExtensions.ToDto（無法翻譯）。
        var nodeRows = await db.Node
            .Where(n => n.CanvasId == canvasGuid)
            .Select(n => new
            {
                Dto = new NodeDto(
                    n.Id.ToString(),
                    n.CanvasId.ToString(),
                    n.Title,
                    n.Content,
                    n.ParentId.HasValue ? n.ParentId.Value.ToString() : null,
                    n.X,
                    n.Y,
                    n.Width,
                    n.Height,
                    n.ZIndex,
                    n.Color,
                    n.Model,
                    n.Origin,
                    n.AiSessionId.HasValue ? n.AiSessionId.Value.ToString() : null,
                    n.CreatedDateTime.ToString("O"),
                    n.UpdatedDateTime.ToString("O"),
                    // 版本先以 0 佔位，材質化後再回填（見上方註解）。
                    0L),
                Version = EF.Property<uint>(n, "xmin"),
            })
            .ToListAsync(ct);

        var nodes = nodeRows
            .Select(row => row.Dto with { Node_Version = (long)row.Version })
            .ToList();

        var edges = await db.Edge
            .Where(e => e.CanvasId == canvasGuid)
            .Select(e => new EdgeDto(
                e.Id.ToString(),
                e.CanvasId.ToString(),
                e.SourceNodeId.ToString(),
                e.TargetNodeId.ToString(),
                e.Kind,
                e.Label,
                e.SourceHandle,
                e.TargetHandle,
                e.CreatedDateTime.ToString("O")))
            .ToListAsync(ct);

        var inlineLinks = await db.InlineLink
            .Where(il => il.CanvasId == canvasGuid)
            .Select(il => new InlineLinkDto(
                il.Id.ToString(),
                il.CanvasId.ToString(),
                il.SourceNodeId.ToString(),
                il.AnchorText,
                il.AnchorStart,
                il.AnchorEnd,
                il.AnchorPrefix,
                il.AnchorSuffix,
                il.TargetNodeId.ToString(),
                il.Detached))
            .ToListAsync(ct);

        var highlights = await db.Highlight
            .Where(h => db.Node.Where(n => n.CanvasId == canvasGuid).Select(n => n.Id).Contains(h.NodeId))
            .Select(h => new HighlightDto(
                h.Id.ToString(),
                h.NodeId.ToString(),
                h.AnchorText,
                h.Start,
                h.End,
                h.AnchorPrefix,
                h.AnchorSuffix,
                h.Color,
                h.Detached))
            .ToListAsync(ct);

        var graphDto = new CanvasGraphDto(
            canvas.ToDto(),
            nodes,
            edges,
            inlineLinks,
            highlights);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasGraphDto>.Ok(graphDto));
    }

    /// <summary>
    /// 重新命名畫布。
    /// </summary>
    private static async Task<IResult> RenameCanvas(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        RenameCanvasRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<CanvasDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Title is required"), StatusCodes.Status400BadRequest);
        }

        canvas.Title = req.Title;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasDto>.Ok(canvas.ToDto()));
    }

    /// <summary>
    /// 刪除畫布（軟刪除 ValidFlag）。
    /// </summary>
    private static async Task<IResult> DeleteCanvas(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
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

        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟刪除
        canvas.ValidFlag = false;
        canvas.DeletedDateTime = DateTime.UtcNow; // 進統一垃圾桶需設刪除時間
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }
}
