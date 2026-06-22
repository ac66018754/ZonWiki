using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記標籤端點（列出所有標籤及其計數；新增 / 重新命名 / 刪除）。
/// 使用者隔離透過全域查詢過濾器（IUserOwned）達成；寫入時以 ICurrentUser 設定擁有者並擋未登入。
/// </summary>
public static class TagEndpoints
{
    /// <summary>
    /// 註冊標籤相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapTagEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 列出所有有效標籤，含該標籤底下的有效筆記數。
        /// </summary>
        app.MapGet("/api/notes/tags", async (
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            var tags = await db.Tag
                .Where(t => t.ValidFlag)
                // 先依手動排序序號，再以名稱作為次要排序鍵（同序號時的穩定排序）。
                .OrderBy(t => t.SortOrder)
                .ThenBy(t => t.Name)
                .Select(t => new NoteTagDto(
                    t.Id,
                    t.Name,
                    t.NoteTags.Count(nt => nt.ValidFlag && nt.Note!.ValidFlag)))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteTagDto>>.Ok(tags));
        });

        // 建立新標籤（同一使用者底下名稱不重複）。
        app.MapPost("/api/notes/tags", async (
            CreateNoteTagRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("Authentication required", 401), statusCode: 401);
            }
            if (string.IsNullOrWhiteSpace(req.Name))
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("Name is required"), statusCode: 400);
            }

            var name = req.Name.Trim();
            // 全域過濾器已限定本人 + 有效；重名檢查。
            var duplicate = await db.Tag.AnyAsync(t => t.Name == name, ct);
            if (duplicate)
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("標籤名稱已存在", 409), statusCode: 409);
            }

            var tag = new Tag
            {
                Id = Guid.NewGuid(),
                UserId = currentUser.UserId,
                Name = name,
            };
            db.Tag.Add(tag);
            await db.SaveChangesAsync(ct);

            return Results.Json(ApiResponse<NoteTagDto>.Ok(new NoteTagDto(tag.Id, tag.Name, 0)), statusCode: 201);
        });

        // 重新排序標籤：依傳入的識別碼順序，把每個標籤的 SortOrder 設為其索引（0、1、2…）。
        // 路由為固定字串 "reorder"，與 "{id:guid}" 不衝突（reorder 非 GUID）。
        app.MapPut("/api/notes/tags/reorder", async (
            ReorderRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<object>.Fail("Authentication required", 401), statusCode: 401);
            }

            var orderedIds = req.OrderedIds ?? new List<Guid>();
            if (orderedIds.Count == 0)
            {
                return Results.Ok(ApiResponse<object>.Ok(new { Count = 0 }));
            }

            try
            {
                // 全域過濾器已限定本人 + 有效；只載入清單中存在的標籤。
                var tags = await db.Tag
                    .Where(t => orderedIds.Contains(t.Id))
                    .ToListAsync(ct);

                // 依清單順序設定 SortOrder（索引）。
                for (var index = 0; index < orderedIds.Count; index++)
                {
                    var tag = tags.FirstOrDefault(t => t.Id == orderedIds[index]);
                    if (tag is not null)
                    {
                        tag.SortOrder = index;
                    }
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ApiResponse<object>.Ok(new { Count = tags.Count }));
            }
            catch (Exception ex)
            {
                logger.LogError(
                    ex,
                    "Failed to reorder tags (userId={UserId}, count={Count})",
                    currentUser.UserId,
                    orderedIds.Count);
                return Results.StatusCode(500);
            }
        });

        // 重新命名標籤。
        app.MapPut("/api/notes/tags/{id:guid}", async (
            Guid id,
            UpdateNoteTagRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("Authentication required", 401), statusCode: 401);
            }
            if (string.IsNullOrWhiteSpace(req.Name))
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("Name is required"), statusCode: 400);
            }

            var tag = await db.Tag.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (tag is null)
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("Tag not found", 404), statusCode: 404);
            }

            var name = req.Name.Trim();
            var duplicate = await db.Tag.AnyAsync(t => t.Name == name && t.Id != id, ct);
            if (duplicate)
            {
                return Results.Json(ApiResponse<NoteTagDto>.Fail("標籤名稱已存在", 409), statusCode: 409);
            }

            tag.Name = name;
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<NoteTagDto>.Ok(new NoteTagDto(tag.Id, tag.Name, 0)));
        });

        // 刪除標籤（軟刪除本體 + 硬刪除其在筆記 / 分類上的關聯）。
        app.MapDelete("/api/notes/tags/{id:guid}", async (
            Guid id,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<object>.Fail("Authentication required", 401), statusCode: 401);
            }

            var tag = await db.Tag.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (tag is null)
            {
                return Results.Json(ApiResponse<object>.Fail("Tag not found", 404), statusCode: 404);
            }

            var noteLinks = await db.NoteTag.Where(nt => nt.TagId == id).ToListAsync(ct);
            var categoryLinks = await db.CategoryTag.Where(ctag => ctag.TagId == id).ToListAsync(ct);
            // 標籤庫與任務、常用連結共用，刪除標籤時也要移除其在任務/常用連結上的關聯（避免殘留 dangling 關聯）。
            var taskLinks = await db.TaskTag.Where(tt => tt.TagId == id).ToListAsync(ct);
            var quickLinkLinks = await db.QuickLinkTag.Where(qt => qt.TagId == id).ToListAsync(ct);
            db.NoteTag.RemoveRange(noteLinks);
            db.CategoryTag.RemoveRange(categoryLinks);
            db.TaskTag.RemoveRange(taskLinks);
            db.QuickLinkTag.RemoveRange(quickLinkLinks);
            tag.ValidFlag = false;
            tag.DeletedDateTime = DateTime.UtcNow; // 進垃圾桶需設刪除時間
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { Id = id.ToString() }));
        });
    }
}
