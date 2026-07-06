using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Common;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——節點的 CRUD、佈局/內容/模型更新與修訂清單。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 在指定畫布上建立新節點。
    /// </summary>
    private static async Task<IResult> CreateNode(
        string canvasId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CreateNodeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await canvasService.FindOwnedCanvasAsync(currentUser.UserId, canvasGuid, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 解析並驗證父節點：若有指定，必須屬於同一張（已驗證擁有的）畫布。
        // 否則使用者可把自己的節點掛到他人畫布的節點下，使後續祖先脈絡追溯越界（跨帳號外洩的前置條件）。
        Guid? parentNodeId = null;
        if (!string.IsNullOrWhiteSpace(req.ParentId))
        {
            if (!Guid.TryParse(req.ParentId, out var parentGuid))
            {
                return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid parent node ID"), StatusCodes.Status400BadRequest);
            }

            if (!await canvasService.NodesBelongToCanvasAsync(canvasGuid, ct, parentGuid))
            {
                return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Parent node not found in canvas", 404), StatusCodes.Status404NotFound);
            }

            parentNodeId = parentGuid;
        }

        var node = new Node
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            Title = req.Title ?? string.Empty,
            Content = req.Content ?? string.Empty,
            ParentId = parentNodeId,
            X = req.X,
            Y = req.Y,
            Width = null,
            Height = null,
            ZIndex = 0,
            Color = req.Color,
            Model = null,
            Origin = "user",
            AiSessionId = null,
            AiSessionConsumed = false,
        };

        db.Node.Add(node);
        await db.SaveChangesAsync(ct);

        var dto = node.ToDto(db.Entry(node).GetConcurrencyVersion());

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新節點的佈局屬性（位置、大小、顏色、Z-index、標題）。
    /// 以強型別 <see cref="UpdateNodeLayoutRequest"/> 綁定請求體（各欄位可空＝部分更新，null 表不更新）。
    /// 由 Minimal API 負責 JSON 反序列化：格式錯誤會自動回 400（不再手動 StreamReader/靜默 catch）。
    /// </summary>
    /// <param name="nodeId">節點識別碼（路由參數）。</param>
    /// <param name="request">佈局更新請求（可空欄位表部分更新；請求體可為 null=不更新任何欄位）。</param>
    /// <param name="currentUser">目前使用者。</param>
    /// <param name="canvasService">畫布業務服務（擁有權驗證）。</param>
    /// <param name="db">資料庫內容。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task<IResult> UpdateNodeLayout(
        string nodeId,
        UpdateNodeLayoutRequest? request,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 部分更新：只套用有帶值（非 null）的欄位；空請求體則不變更任何欄位。
        if (request is not null)
        {
            if (request.X.HasValue) node.X = request.X.Value;
            if (request.Y.HasValue) node.Y = request.Y.Value;
            if (request.Width.HasValue) node.Width = request.Width.Value;
            if (request.Height.HasValue) node.Height = request.Height.Value;
            if (request.ZIndex.HasValue) node.ZIndex = request.ZIndex.Value;
            if (request.Color is not null) node.Color = request.Color;
            if (request.Title is not null) node.Title = request.Title;
        }

        // 樂觀鎖（#4/#34）：若前端帶回 baseVersion，以其比對 xmin 偵測併發衝突。
        // 佈局多為高頻拖曳，前端通常不帶 baseVersion（維持 last-write-wins）；帶了才檢查。
        db.Entry(node).ApplyBaseVersion(request?.BaseVersion);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<NodeDto>.Fail("此項已被其他來源修改", 409),
                StatusCodes.Status409Conflict);
        }

        var dto = node.ToDto(db.Entry(node).GetConcurrencyVersion());

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 更新節點的內容（Markdown）。
    /// </summary>
    private static async Task<IResult> UpdateNodeContent(
        string nodeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        UpdateNodeContentRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 記錄修訂
        var revision = new NodeRevision
        {
            Id = Guid.NewGuid(),
            NodeId = node.Id,
            Content = req.Content,
            Source = "edited",
        };
        db.NodeRevision.Add(revision);

        // 更新節點內容
        node.Content = req.Content ?? string.Empty;

        // 樂觀鎖（#4/#34）：若前端帶回 baseVersion，以其比對 xmin 偵測併發衝突
        //（節點內容編輯是主要的多來源衝突情境）。
        db.Entry(node).ApplyBaseVersion(req.BaseVersion);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<NodeDto>.Fail("此項已被其他來源修改", 409),
                StatusCodes.Status409Conflict);
        }

        var dto = node.ToDto(db.Entry(node).GetConcurrencyVersion());

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 設定節點的偏好 AI 模型。
    /// </summary>
    private static async Task<IResult> SetNodeModel(
        string nodeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        SetNodeModelRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        node.Model = req.Model;
        await db.SaveChangesAsync(ct);

        var dto = node.ToDto(db.Entry(node).GetConcurrencyVersion());

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 刪除節點（軟刪除）。一併軟刪除以此節點為端點的連線（見 CanvasService.SoftDeleteNodeAsync）。
    /// </summary>
    private static async Task<IResult> DeleteNode(
        string nodeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
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

        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        await canvasService.SoftDeleteNodeAsync(node, ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 列出節點的所有修訂版本。
    /// </summary>
    private static async Task<IResult> ListNodeRevisions(
        string nodeId,
        ICurrentUser currentUser,
        CanvasService canvasService,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<List<NodeRevisionDto>>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<List<NodeRevisionDto>>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證節點屬於使用者
        var node = await canvasService.FindOwnedNodeAsync(currentUser.UserId, nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<List<NodeRevisionDto>>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        var revisions = await db.NodeRevision
            .Where(r => r.NodeId == nodeGuid)
            .OrderByDescending(r => r.CreatedDateTime)
            .Select(r => new NodeRevisionDto(
                r.Id.ToString(),
                r.NodeId.ToString(),
                r.Content,
                r.Source,
                r.CreatedDateTime.ToString("O")))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<NodeRevisionDto>>.Ok(revisions));
    }
}
