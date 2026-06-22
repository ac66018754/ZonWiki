using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記浮層元件端點：對一篇筆記的「便利貼 / 塗鴉 / 圖片輪播」做 CRUD。
/// 持久化於資料庫（取代舊的 localStorage 浮動白板），位置/尺寸以相對內文的像素儲存。
/// </summary>
public static class NoteOverlayEndpoints
{
    /// <summary>
    /// 註冊筆記浮層元件端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapNoteOverlayEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出某筆記的所有浮層元件
        app.MapGet("/api/notes/{noteId:guid}/overlay", async (
            Guid noteId, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            var items = await db.NoteOverlayItem
                .Where(i => i.UserId == userGuid && i.NoteId == noteId && i.ValidFlag)
                .OrderBy(i => i.ZIndex)
                .Select(i => new NoteOverlayItemDto(
                    i.Id, i.Kind, i.X, i.Y, i.Width, i.Height, i.ZIndex, i.Color, i.Text, i.DataJson))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteOverlayItemDto>>.Ok(items));
        }).RequireAuthorization();

        // 建立浮層元件
        app.MapPost("/api/notes/{noteId:guid}/overlay", async (
            Guid noteId, CreateNoteOverlayItemRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            var owns = await db.Note.AnyAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userGuid, ct);
            if (!owns) return Results.NotFound(ApiResponse<NoteOverlayItemDto>.Fail("Note not found", 404));

            var kind = (req.Kind ?? "").Trim().ToLowerInvariant();
            if (kind != "sticky" && kind != "drawing" && kind != "slide")
                return Results.BadRequest(ApiResponse<NoteOverlayItemDto>.Fail("未知的浮層型別", 400));

            var item = new NoteOverlayItem
            {
                UserId = userGuid,
                NoteId = noteId,
                Kind = kind,
                X = req.X,
                Y = req.Y,
                Width = req.Width,
                Height = req.Height,
                ZIndex = req.ZIndex,
                Color = req.Color,
                Text = req.Text,
                DataJson = req.DataJson,
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.NoteOverlayItem.Add(item);
            await db.SaveChangesAsync(ct);

            var dto = new NoteOverlayItemDto(
                item.Id, item.Kind, item.X, item.Y, item.Width, item.Height, item.ZIndex,
                item.Color, item.Text, item.DataJson);
            return Results.Ok(ApiResponse<NoteOverlayItemDto>.Ok(dto));
        }).RequireAuthorization();

        // 更新浮層元件（位置/尺寸/內容；欄位皆選擇性）
        app.MapPut("/api/notes/overlay/{itemId:guid}", async (
            Guid itemId, UpdateNoteOverlayItemRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var item = await db.NoteOverlayItem.FirstOrDefaultAsync(
                i => i.Id == itemId && i.UserId == userGuid && i.ValidFlag, ct);
            if (item is null) return Results.NotFound(ApiResponse<object>.Fail("Overlay item not found", 404));

            if (req.X.HasValue) item.X = req.X.Value;
            if (req.Y.HasValue) item.Y = req.Y.Value;
            if (req.Width.HasValue) item.Width = req.Width.Value;
            if (req.Height.HasValue) item.Height = req.Height.Value;
            if (req.ZIndex.HasValue) item.ZIndex = req.ZIndex.Value;
            if (req.Color != null) item.Color = req.Color;
            if (req.Text != null) item.Text = req.Text;
            if (req.DataJson != null) item.DataJson = req.DataJson;
            item.UpdatedDateTime = DateTime.UtcNow;
            item.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = item.Id }));
        }).RequireAuthorization();

        // 刪除浮層元件（軟刪除）
        app.MapDelete("/api/notes/overlay/{itemId:guid}", async (
            Guid itemId, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var item = await db.NoteOverlayItem.FirstOrDefaultAsync(
                i => i.Id == itemId && i.UserId == userGuid && i.ValidFlag, ct);
            if (item is null) return Results.NotFound(ApiResponse<object>.Fail("Overlay item not found", 404));
            item.ValidFlag = false;
            item.DeletedDateTime = DateTime.UtcNow;
            item.UpdatedDateTime = DateTime.UtcNow;
            item.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { id = item.Id }));
        }).RequireAuthorization();
    }

    /// <summary>從 claim 取出登入使用者 Id。</summary>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var id = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(id, out userGuid);
    }
}
