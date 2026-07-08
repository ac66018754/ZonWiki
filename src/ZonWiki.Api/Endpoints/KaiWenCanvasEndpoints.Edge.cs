using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——邊（連線）的建立、重接與刪除。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 在指定畫布上建立邊（連線）。
    /// </summary>
    private static async Task<IResult> CreateEdge(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CreateEdgeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<EdgeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：source/target 節點都必須屬於這張（已驗證擁有的）畫布，避免建立指向他人/別張畫布節點的邊。
        if (!await canvasService.NodesBelongToCanvasAsync(canvasGuid, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        var edge = new Edge
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            SourceNodeId = sourceNodeGuid,
            TargetNodeId = targetNodeGuid,
            Kind = "default",
            Label = string.Empty,
            SourceHandle = req.SourceHandle,
            TargetHandle = req.TargetHandle,
            DataJson = "{}",
        };

        db.Edge.Add(edge);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<EdgeDto>.Ok(edge.ToDto()), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 重新連接邊到不同的節點。
    /// </summary>
    private static async Task<IResult> ReconnectEdge(
        string edgeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        ReconnectEdgeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<EdgeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(edgeId, out var edgeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid edge ID"), StatusCodes.Status400BadRequest);
        }

        var edge = await canvasService.FindOwnedEdgeAsync(currentUser.UserId, edgeGuid, ct);

        if (edge is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Edge not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：重接後的 source/target 節點都必須屬於這條邊所在（已驗證擁有的）畫布。
        if (!await canvasService.NodesBelongToCanvasAsync(edge.CanvasId, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        edge.SourceNodeId = sourceNodeGuid;
        edge.TargetNodeId = targetNodeGuid;
        edge.SourceHandle = req.SourceHandle;
        edge.TargetHandle = req.TargetHandle;

        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<EdgeDto>.Ok(edge.ToDto()));
    }

    /// <summary>
    /// 刪除邊（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteEdge(
        string edgeId,
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

        if (!Guid.TryParse(edgeId, out var edgeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid edge ID"), StatusCodes.Status400BadRequest);
        }

        var edge = await canvasService.FindOwnedEdgeAsync(currentUser.UserId, edgeGuid, ct);

        if (edge is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Edge not found", 404), StatusCodes.Status404NotFound);
        }

        edge.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }
}
