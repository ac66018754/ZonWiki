using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——行內連結（節點文字上指向另一節點的連結）的建立、更新目標與刪除。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 建立行內連結（在某節點的文字上建立到另一節點的連結）。
    /// </summary>
    private static async Task<IResult> CreateInlineLink(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CreateInlineLinkRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<InlineLinkDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：行內連結的 source/target 節點都必須屬於這張（已驗證擁有的）畫布。
        if (!await canvasService.NodesBelongToCanvasAsync(canvasGuid, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        var inlineLink = new InlineLink
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            SourceNodeId = sourceNodeGuid,
            AnchorText = req.AnchorText,
            AnchorStart = req.AnchorStart,
            AnchorEnd = req.AnchorEnd,
            AnchorPrefix = req.AnchorPrefix,
            AnchorSuffix = req.AnchorSuffix,
            TargetNodeId = targetNodeGuid,
            Detached = false,
        };

        db.InlineLink.Add(inlineLink);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<InlineLinkDto>.Ok(inlineLink.ToDto()), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新行內連結的目標節點。
    /// </summary>
    private static async Task<IResult> UpdateInlineLinkTarget(
        string linkId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        UpdateInlineLinkTargetRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<InlineLinkDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(linkId, out var linkGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid link ID"), StatusCodes.Status400BadRequest);
        }

        var inlineLink = await canvasService.FindOwnedInlineLinkAsync(currentUser.UserId, linkGuid, ct);

        if (inlineLink is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Inline link not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid target node ID"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：新的目標節點必須屬於這條行內連結所在（已驗證擁有的）畫布。
        if (!await canvasService.NodesBelongToCanvasAsync(inlineLink.CanvasId, ct, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        inlineLink.TargetNodeId = targetNodeGuid;
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<InlineLinkDto>.Ok(inlineLink.ToDto()));
    }

    /// <summary>
    /// 刪除行內連結（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteInlineLink(
        string linkId,
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

        if (!Guid.TryParse(linkId, out var linkGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid link ID"), StatusCodes.Status400BadRequest);
        }

        var inlineLink = await canvasService.FindOwnedInlineLinkAsync(currentUser.UserId, linkGuid, ct);

        if (inlineLink is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Inline link not found", 404), StatusCodes.Status404NotFound);
        }

        inlineLink.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }
}
