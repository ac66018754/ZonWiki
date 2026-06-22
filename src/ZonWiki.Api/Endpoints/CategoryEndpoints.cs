using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記分類端點：清單（含階層、筆記數、分類標籤）與新增 / 重新命名 / 變更上層 / 刪除 / 指派標籤。
/// 使用者隔離透過全域查詢過濾器（IUserOwned）達成；寫入時以 ICurrentUser 設定擁有者並擋未登入。
/// </summary>
public static class CategoryEndpoints
{
    /// <summary>
    /// 註冊筆記分類相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出所有分類（含上層、有效筆記數、貼在分類上的標籤）。
        app.MapGet("/api/categories", async (ZonWikiDbContext db, CancellationToken ct) =>
        {
            var categories = await db.Category
                // 先依手動排序序號，再以名稱作為次要排序鍵（同序號時的穩定排序）。
                .OrderBy(c => c.SortOrder)
                .ThenBy(c => c.Name)
                .Select(c => new CategoryDto(
                    c.Id,
                    c.ParentId,
                    c.Name,
                    c.FolderPath,
                    c.NoteCategories.Count(nc => nc.ValidFlag && nc.Note!.ValidFlag),
                    c.CategoryTags
                        .Where(ctag => ctag.ValidFlag && ctag.Tag!.ValidFlag)
                        .Select(ctag => new TagRefDto(ctag.Tag!.Id, ctag.Tag.Name))
                        .ToList()))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<CategoryDto>>.Ok(categories));
        });

        // 建立新分類。
        app.MapPost("/api/categories", async (
            CreateNoteCategoryRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<CategoryDto>.Fail("Authentication required", 401), statusCode: 401);
            }
            if (string.IsNullOrWhiteSpace(req.Name))
            {
                return Results.Json(ApiResponse<CategoryDto>.Fail("Name is required"), statusCode: 400);
            }

            // 若指定上層，須確認上層存在且屬於本人（全域過濾器已限定本人 + 有效）。
            if (req.ParentId is Guid parentId)
            {
                var parentExists = await db.Category.AnyAsync(c => c.Id == parentId, ct);
                if (!parentExists)
                {
                    return Results.Json(ApiResponse<CategoryDto>.Fail("Parent category not found", 404), statusCode: 404);
                }
            }

            var category = new Category
            {
                Id = Guid.NewGuid(),
                UserId = currentUser.UserId,
                Name = req.Name.Trim(),
                ParentId = req.ParentId,
                FolderPath = string.Empty,
            };
            db.Category.Add(category);
            await db.SaveChangesAsync(ct);

            var dto = new CategoryDto(category.Id, category.ParentId, category.Name, category.FolderPath, 0, new List<TagRefDto>());
            return Results.Json(ApiResponse<CategoryDto>.Ok(dto), statusCode: 201);
        });

        // 重新排序分類：依傳入的識別碼順序，把每個分類的 SortOrder 設為其索引（0、1、2…）。
        // 通常由前端傳入「同一層級」內兄弟分類的新順序；清單未涵蓋者維持原序號。
        // 路由為固定字串 "reorder"，與 "{id:guid}" 不衝突（reorder 非 GUID）。
        app.MapPut("/api/categories/reorder", async (
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
                // 全域過濾器已限定本人 + 有效；只載入清單中存在的分類。
                var categories = await db.Category
                    .Where(c => orderedIds.Contains(c.Id))
                    .ToListAsync(ct);

                // 依清單順序設定 SortOrder（索引）。
                for (var index = 0; index < orderedIds.Count; index++)
                {
                    var category = categories.FirstOrDefault(c => c.Id == orderedIds[index]);
                    if (category is not null)
                    {
                        category.SortOrder = index;
                    }
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ApiResponse<object>.Ok(new { Count = categories.Count }));
            }
            catch (Exception ex)
            {
                logger.LogError(
                    ex,
                    "Failed to reorder categories (userId={UserId}, count={Count})",
                    currentUser.UserId,
                    orderedIds.Count);
                return Results.StatusCode(500);
            }
        });

        // 重新命名 + 變更上層分類（含環狀檢查：不可把自己掛到自己的子孫底下）。
        app.MapPut("/api/categories/{id:guid}", async (
            Guid id,
            UpdateNoteCategoryRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<CategoryDto>.Fail("Authentication required", 401), statusCode: 401);
            }
            if (string.IsNullOrWhiteSpace(req.Name))
            {
                return Results.Json(ApiResponse<CategoryDto>.Fail("Name is required"), statusCode: 400);
            }

            var category = await db.Category.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (category is null)
            {
                return Results.Json(ApiResponse<CategoryDto>.Fail("Category not found", 404), statusCode: 404);
            }

            if (req.ParentId is Guid newParentId)
            {
                if (newParentId == id)
                {
                    return Results.Json(ApiResponse<CategoryDto>.Fail("分類不可設自己為上層"), statusCode: 400);
                }

                var parentExists = await db.Category.AnyAsync(c => c.Id == newParentId, ct);
                if (!parentExists)
                {
                    return Results.Json(ApiResponse<CategoryDto>.Fail("Parent category not found", 404), statusCode: 404);
                }

                // 環狀檢查：載入本人所有分類的 (Id, ParentId)，從新上層往上走，若遇到自己則為環狀。
                var pairs = await db.Category
                    .Select(c => new { c.Id, c.ParentId })
                    .ToListAsync(ct);
                var parentOf = pairs.ToDictionary(p => p.Id, p => p.ParentId);
                var cursor = (Guid?)newParentId;
                while (cursor is Guid current)
                {
                    if (current == id)
                    {
                        return Results.Json(ApiResponse<CategoryDto>.Fail("不可把分類移到自己的子分類底下"), statusCode: 400);
                    }
                    cursor = parentOf.TryGetValue(current, out var next) ? next : null;
                }
            }

            category.Name = req.Name.Trim();
            category.ParentId = req.ParentId;
            await db.SaveChangesAsync(ct);

            var dto = new CategoryDto(category.Id, category.ParentId, category.Name, category.FolderPath, 0, new List<TagRefDto>());
            return Results.Ok(ApiResponse<CategoryDto>.Ok(dto));
        });

        // 刪除分類：若仍有子分類或筆記，禁止刪除（請使用者先清空）。
        app.MapDelete("/api/categories/{id:guid}", async (
            Guid id,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<object>.Fail("Authentication required", 401), statusCode: 401);
            }

            var category = await db.Category.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (category is null)
            {
                return Results.Json(ApiResponse<object>.Fail("Category not found", 404), statusCode: 404);
            }

            var hasChildren = await db.Category.AnyAsync(c => c.ParentId == id, ct);
            if (hasChildren)
            {
                return Results.Json(ApiResponse<object>.Fail("此分類底下還有子分類，請先移除或搬移子分類", 409), statusCode: 409);
            }

            var hasNotes = await db.NoteCategory.AnyAsync(nc => nc.CategoryId == id && nc.ValidFlag, ct);
            if (hasNotes)
            {
                return Results.Json(ApiResponse<object>.Fail("此分類底下還有筆記，請先移除分類關聯", 409), statusCode: 409);
            }

            // 硬刪除分類↔標籤關聯，軟刪除分類本體。
            var tagLinks = await db.CategoryTag.Where(ctag => ctag.CategoryId == id).ToListAsync(ct);
            db.CategoryTag.RemoveRange(tagLinks);
            category.ValidFlag = false;
            category.DeletedDateTime = DateTime.UtcNow; // 進垃圾桶需設刪除時間
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { Id = id.ToString() }));
        });

        // 設定某分類貼上哪些標籤（整組取代）。
        app.MapPut("/api/categories/{id:guid}/tags", async (
            Guid id,
            SetCategoryTagsRequest req,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(ApiResponse<object>.Fail("Authentication required", 401), statusCode: 401);
            }

            var category = await db.Category.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (category is null)
            {
                return Results.Json(ApiResponse<object>.Fail("Category not found", 404), statusCode: 404);
            }

            var requestedTagIds = (req.TagIds ?? new List<Guid>()).Distinct().ToList();
            // 僅接受屬於本人且有效的標籤。
            var validTagIds = await db.Tag
                .Where(t => requestedTagIds.Contains(t.Id))
                .Select(t => t.Id)
                .ToListAsync(ct);

            var existing = await db.CategoryTag.Where(ctag => ctag.CategoryId == id).ToListAsync(ct);
            db.CategoryTag.RemoveRange(existing);
            foreach (var tagId in validTagIds)
            {
                db.CategoryTag.Add(new CategoryTag
                {
                    Id = Guid.NewGuid(),
                    UserId = currentUser.UserId,
                    CategoryId = id,
                    TagId = tagId,
                });
            }
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { Id = id.ToString() }));
        });
    }
}
