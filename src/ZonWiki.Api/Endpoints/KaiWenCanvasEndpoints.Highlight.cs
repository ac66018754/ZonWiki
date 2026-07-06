using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——節點文字上的重點標記（畫重點）的建立、改色與刪除。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 在指定節點上建立重點標記（畫重點）。
    /// </summary>
    private static async Task<IResult> CreateHighlight(
        string nodeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CreateHighlightRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<HighlightDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證節點屬於使用者
        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        var highlight = new Highlight
        {
            Id = Guid.NewGuid(),
            NodeId = nodeGuid,
            AnchorText = req.AnchorText,
            Start = req.Start,
            End = req.End,
            AnchorPrefix = req.AnchorPrefix,
            AnchorSuffix = req.AnchorSuffix,
            Color = req.Color,
            Detached = false,
        };

        db.Highlight.Add(highlight);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<HighlightDto>.Ok(highlight.ToDto()), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新重點顏色（供「畫重點後不滿意，直接在工具面板改色」即時調整）。
    /// </summary>
    private static async Task<IResult> UpdateHighlight(
        string highlightId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        UpdateHighlightRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<HighlightDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(highlightId, out var highlightGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Invalid highlight ID"), StatusCodes.Status400BadRequest);
        }

        if (string.IsNullOrWhiteSpace(req.Color))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Color is required"), StatusCodes.Status400BadRequest);
        }

        // 經節點所屬畫布驗證擁有者（與 DeleteHighlight 相同隔離方式）。
        var highlight = await canvasService.FindOwnedHighlightAsync(currentUser.UserId, highlightGuid, ct);

        if (highlight is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Highlight not found", 404), StatusCodes.Status404NotFound);
        }

        highlight.Color = req.Color;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<HighlightDto>.Ok(highlight.ToDto()), StatusCodes.Status200OK);
    }

    /// <summary>
    /// 刪除重點標記（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteHighlight(
        string highlightId,
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

        if (!Guid.TryParse(highlightId, out var highlightGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid highlight ID"), StatusCodes.Status400BadRequest);
        }

        var highlight = await canvasService.FindOwnedHighlightAsync(currentUser.UserId, highlightGuid, ct);

        if (highlight is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Highlight not found", 404), StatusCodes.Status404NotFound);
        }

        highlight.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }
}
