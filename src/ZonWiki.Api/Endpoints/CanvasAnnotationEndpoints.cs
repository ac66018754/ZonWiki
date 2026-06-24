using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布「標註浮層」(便利貼 / 塗鴉 / 圖片板) REST API 端點（CRUD）。
/// 與筆記浮層 (NoteOverlayEndpoints) 對等，但綁定畫布並以畫布座標儲存。
/// 沿用畫布既有慣例：ICurrentUser 取得使用者、CanvasJsonHelper 以 PascalCase 序列化。
/// 使用者隔離由全域查詢過濾 (IUserOwned) + fail-closed 具現化攔截器自動涵蓋；
/// 建立時另行驗證畫布屬於本人。v1 不發 SSE（單一使用者，前端樂觀更新即可）。
/// </summary>
public static class CanvasAnnotationEndpoints
{
    /// <summary>
    /// 註冊畫布標註相關端點。
    /// </summary>
    /// <param name="app">Web 應用程式建構結果。</param>
    public static void MapCanvasAnnotationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/canvas");

        group.MapGet("/canvases/{canvasId}/annotations", ListAnnotations)
            .WithName("ListCanvasAnnotations")
            .WithOpenApi()
            .Produces<ApiResponse<List<CanvasAnnotationDto>>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPost("/canvases/{canvasId}/annotations", CreateAnnotation)
            .WithName("CreateCanvasAnnotation")
            .WithOpenApi()
            .Produces<ApiResponse<CanvasAnnotationDto>>(StatusCodes.Status201Created)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPatch("/annotations/{annotationId}", UpdateAnnotation)
            .WithName("UpdateCanvasAnnotation")
            .WithOpenApi()
            .Produces<ApiResponse<CanvasAnnotationDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/annotations/{annotationId}", DeleteAnnotation)
            .WithName("DeleteCanvasAnnotation")
            .WithOpenApi()
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);
    }

    /// <summary>
    /// 列出指定畫布的所有標註（依 ZIndex 由小到大）。
    /// </summary>
    private static async Task<IResult> ListAnnotations(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<CanvasAnnotationDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<CanvasAnnotationDto>>.Fail("Invalid canvas ID"),
                StatusCodes.Status400BadRequest);
        }

        // 全域過濾已限制為本人且 ValidFlag；畫布不存在/非本人 → 視為找不到。
        var ownsCanvas = await db.Canvas.AnyAsync(c => c.Id == canvasGuid, ct);
        if (!ownsCanvas)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<CanvasAnnotationDto>>.Fail("Canvas not found", 404),
                StatusCodes.Status404NotFound);
        }

        // 明確再加 UserId 條件（與全域過濾重疊）：縱深防禦，且與 NoteOverlayEndpoints 一致，
        // 不單靠全域過濾（避免日後過濾被改動而外洩）。
        var items = await db.CanvasAnnotation
            .Where(a => a.CanvasId == canvasGuid && a.UserId == currentUser.UserId)
            .OrderBy(a => a.ZIndex)
            .Select(a => ToDto(a))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<CanvasAnnotationDto>>.Ok(items), StatusCodes.Status200OK);
    }

    /// <summary>
    /// 在指定畫布上建立一個標註。
    /// </summary>
    private static async Task<IResult> CreateAnnotation(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateCanvasAnnotationRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Invalid canvas ID"),
                StatusCodes.Status400BadRequest);
        }

        var kind = (req.Kind ?? string.Empty).Trim().ToLowerInvariant();
        if (kind != "sticky" && kind != "drawing" && kind != "slide")
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("未知的標註型別", 400),
                StatusCodes.Status400BadRequest);
        }

        // 邊界輸入驗證：拒絕 NaN / Infinity 座標或尺寸（會污染前端渲染、難以察覺）。
        if (!double.IsFinite(req.X) || !double.IsFinite(req.Y) ||
            !double.IsFinite(req.Width) || !double.IsFinite(req.Height))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("座標或尺寸數值無效", 400),
                StatusCodes.Status400BadRequest);
        }

        // 驗證畫布屬於本人（全域過濾已含 UserId + ValidFlag）。
        var ownsCanvas = await db.Canvas.AnyAsync(c => c.Id == canvasGuid, ct);
        if (!ownsCanvas)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Canvas not found", 404),
                StatusCodes.Status404NotFound);
        }

        var item = new CanvasAnnotation
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            CanvasId = canvasGuid,
            Kind = kind,
            X = req.X,
            Y = req.Y,
            Width = req.Width,
            Height = req.Height,
            ZIndex = req.ZIndex,
            Color = req.Color,
            Text = req.Text,
            DataJson = req.DataJson,
            CreatedUser = currentUser.UserId.ToString(),
            UpdatedUser = currentUser.UserId.ToString(),
        };

        db.CanvasAnnotation.Add(item);
        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasAnnotationDto>.Ok(ToDto(item)), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 部分更新一個標註（位置 / 尺寸 / 疊放 / 顏色 / 文字 / 資料）。
    /// </summary>
    private static async Task<IResult> UpdateAnnotation(
        string annotationId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateCanvasAnnotationRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(annotationId, out var annotationGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Invalid annotation ID"),
                StatusCodes.Status400BadRequest);
        }

        // 全域過濾已限本人 + ValidFlag；明確再加 UserId 條件做縱深防禦。
        var item = await db.CanvasAnnotation
            .FirstOrDefaultAsync(a => a.Id == annotationGuid && a.UserId == currentUser.UserId, ct);
        if (item is null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasAnnotationDto>.Fail("Annotation not found", 404),
                StatusCodes.Status404NotFound);
        }

        if (req.X.HasValue) item.X = req.X.Value;
        if (req.Y.HasValue) item.Y = req.Y.Value;
        if (req.Width.HasValue) item.Width = req.Width.Value;
        if (req.Height.HasValue) item.Height = req.Height.Value;
        if (req.ZIndex.HasValue) item.ZIndex = req.ZIndex.Value;
        if (req.Color != null) item.Color = req.Color;
        if (req.Text != null) item.Text = req.Text;
        if (req.DataJson != null) item.DataJson = req.DataJson;
        item.UpdatedUser = currentUser.UserId.ToString();

        await db.SaveChangesAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasAnnotationDto>.Ok(ToDto(item)), StatusCodes.Status200OK);
    }

    /// <summary>
    /// 軟刪除一個標註（ValidFlag=false）。
    /// </summary>
    private static async Task<IResult> DeleteAnnotation(
        string annotationId,
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

        if (!Guid.TryParse(annotationId, out var annotationGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Invalid annotation ID"),
                StatusCodes.Status400BadRequest);
        }

        // 全域過濾已限本人 + ValidFlag；明確再加 UserId 條件做縱深防禦。
        var item = await db.CanvasAnnotation
            .FirstOrDefaultAsync(a => a.Id == annotationGuid && a.UserId == currentUser.UserId, ct);
        if (item is null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Annotation not found", 404),
                StatusCodes.Status404NotFound);
        }

        item.ValidFlag = false;
        item.DeletedDateTime = DateTime.UtcNow;
        item.UpdatedUser = currentUser.UserId.ToString();
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 將實體轉為 DTO（{Table}_{Field} PascalCase 欄位名）。
    /// </summary>
    private static CanvasAnnotationDto ToDto(CanvasAnnotation a) => new(
        a.Id.ToString(),
        a.Kind,
        a.X,
        a.Y,
        a.Width,
        a.Height,
        a.ZIndex,
        a.Color,
        a.Text,
        a.DataJson);
}
