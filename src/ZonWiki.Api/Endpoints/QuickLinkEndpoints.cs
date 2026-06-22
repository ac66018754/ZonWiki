using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 常用連結卡相關的 API 端點：
/// GET /api/quick-links（列出）、POST /api/quick-links（建立）、
/// GET /api/quick-links/{id}（詳情）、PUT /api/quick-links/{id}（更新）、DELETE /api/quick-links/{id}（刪除）。
/// 屬當前登入使用者的資源，每人獨立管理自己的常用連結。
/// </summary>
public static class QuickLinkEndpoints
{
    /// <summary>
    /// 註冊常用連結卡相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapQuickLinkEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 列出當前登入使用者的所有常用連結卡（依排序序號）。
        /// GET /api/quick-links
        /// </summary>
        app.MapGet("/api/quick-links", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 先載入實體（含標籤關聯），再於記憶體投影 DTO——巢狀標籤投影直接寫在 EF 查詢內
            // 無法被翻譯（與 TaskEndpoints 同樣採「materialize 後再 map」）。
            var entities = await db.QuickLink
                .Where(ql => ql.UserId == userGuid && ql.ValidFlag)
                .Include(ql => ql.QuickLinkTags)
                    .ThenInclude(qt => qt.Tag)
                .OrderBy(ql => ql.SortOrder)
                .ToListAsync(ct);

            var items = entities.Select(MapQuickLink).ToList();

            return Results.Ok(ApiResponse<List<QuickLinkDto>>.Ok(items));
        });

        /// <summary>
        /// 建立新常用連結卡。
        /// POST /api/quick-links
        /// Body: { title, url, iconKey?, sortOrder? }
        /// </summary>
        app.MapPost("/api/quick-links", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateQuickLinkRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var quickLink = new QuickLink
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Title = request.Title,
                Url = request.Url,
                IconKey = request.IconKey,
                // 空字串視為未分類（存 null）。
                Category = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category.Trim(),
                SortOrder = request.SortOrder,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.QuickLink.Add(quickLink);
            await db.SaveChangesAsync(ct);

            var dto = new QuickLinkDto(
                quickLink.Id,
                quickLink.Title,
                quickLink.Url,
                quickLink.IconKey,
                quickLink.Category,
                quickLink.SortOrder,
                new List<TagRefDto>());

            return Results.Created($"/api/quick-links/{quickLink.Id}", ApiResponse<QuickLinkDto>.Ok(dto));
        });

        /// <summary>
        /// 取得單一常用連結卡詳情。
        /// GET /api/quick-links/{id}
        /// </summary>
        app.MapGet("/api/quick-links/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entity = await db.QuickLink
                .Where(ql => ql.Id == id && ql.UserId == userGuid && ql.ValidFlag)
                .Include(ql => ql.QuickLinkTags)
                    .ThenInclude(qt => qt.Tag)
                .FirstOrDefaultAsync(ct);

            if (entity is null)
            {
                return Results.NotFound(ApiResponse<QuickLinkDto>.Fail("Quick link not found", 404));
            }

            return Results.Ok(ApiResponse<QuickLinkDto>.Ok(MapQuickLink(entity)));
        });

        /// <summary>
        /// 更新常用連結卡（所有欄位皆選擇性）。
        /// PUT /api/quick-links/{id}
        /// Body: { title?, url?, iconKey?, sortOrder? }
        /// </summary>
        app.MapPut("/api/quick-links/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            UpdateQuickLinkRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var quickLink = await db.QuickLink
                .Where(ql => ql.Id == id && ql.UserId == userGuid && ql.ValidFlag)
                .FirstOrDefaultAsync(ct);

            if (quickLink is null)
            {
                return Results.NotFound(ApiResponse<QuickLinkDto>.Fail("Quick link not found", 404));
            }

            // 只更新有傳入的欄位
            if (!string.IsNullOrEmpty(request.Title))
            {
                quickLink.Title = request.Title;
            }

            if (!string.IsNullOrEmpty(request.Url))
            {
                quickLink.Url = request.Url;
            }

            if (request.IconKey != null)
            {
                quickLink.IconKey = request.IconKey;
            }

            // 分類：null = 不更新；空字串/空白 = 清為未分類；否則設定（去前後空白）。
            if (request.Category != null)
            {
                quickLink.Category = string.IsNullOrWhiteSpace(request.Category)
                    ? null
                    : request.Category.Trim();
            }

            if (request.SortOrder.HasValue)
            {
                quickLink.SortOrder = request.SortOrder.Value;
            }

            quickLink.UpdatedDateTime = DateTime.UtcNow;
            quickLink.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            // 重新載入（含標籤）並於記憶體投影回傳（與讀取端點一致，避免巢狀標籤投影翻譯失敗）。
            var updated = await db.QuickLink
                .Where(q => q.Id == id && q.UserId == userGuid && q.ValidFlag)
                .Include(q => q.QuickLinkTags)
                    .ThenInclude(qt => qt.Tag)
                .FirstOrDefaultAsync(ct);

            var dto = updated is not null
                ? MapQuickLink(updated)
                : new QuickLinkDto(
                    quickLink.Id,
                    quickLink.Title,
                    quickLink.Url,
                    quickLink.IconKey,
                    quickLink.Category,
                    quickLink.SortOrder,
                    new List<TagRefDto>());

            return Results.Ok(ApiResponse<QuickLinkDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除常用連結卡（軟刪除：ValidFlag = false）。
        /// DELETE /api/quick-links/{id}
        /// </summary>
        app.MapDelete("/api/quick-links/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var quickLink = await db.QuickLink
                .Where(ql => ql.Id == id && ql.UserId == userGuid && ql.ValidFlag)
                .FirstOrDefaultAsync(ct);

            if (quickLink is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Quick link not found", 404));
            }

            quickLink.ValidFlag = false;
            quickLink.DeletedDateTime = DateTime.UtcNow; // 進垃圾桶需設刪除時間
            quickLink.UpdatedDateTime = DateTime.UtcNow;
            quickLink.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        });

        /// <summary>
        /// 設定常用連結卡的標籤（整批取代；與筆記/任務共用同一套標籤庫）。
        /// PUT /api/quick-links/{id}/tags
        /// Body: JSON 陣列的標籤 ID（tagIds）。
        /// </summary>
        app.MapPut("/api/quick-links/{id:guid}/tags", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            List<Guid> tagIds,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var quickLink = await db.QuickLink
                .FirstOrDefaultAsync(ql => ql.Id == id && ql.UserId == userGuid && ql.ValidFlag, ct);
            if (quickLink is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Quick link not found", 404));
            }

            try
            {
                // 僅接受屬於本人且有效的標籤（明確比對 UserId，不倚賴全域過濾器作為唯一防線）。
                var requested = (tagIds ?? new List<Guid>()).Distinct().ToList();
                var validTagIds = await db.Tag
                    .Where(t => requested.Contains(t.Id) && t.UserId == userGuid && t.ValidFlag)
                    .Select(t => t.Id)
                    .ToListAsync(ct);

                // 載入所有既有關聯（含軟刪除，需 IgnoreQueryFilters）以便復活，避免違反 (QuickLinkId,TagId) 唯一索引。
                var existing = await db.QuickLinkTag
                    .IgnoreQueryFilters()
                    .Where(qt => qt.QuickLinkId == id && qt.UserId == userGuid)
                    .ToListAsync(ct);
                var existingTagIds = existing.Select(qt => qt.TagId).ToHashSet();

                // 既有關聯：在清單內→確保有效（復活）；不在→軟刪除。
                foreach (var link in existing)
                {
                    var shouldHave = validTagIds.Contains(link.TagId);
                    if (link.ValidFlag != shouldHave)
                    {
                        link.ValidFlag = shouldHave;
                        link.DeletedDateTime = shouldHave ? null : DateTime.UtcNow;
                        link.UpdatedDateTime = DateTime.UtcNow;
                        link.UpdatedUser = userId;
                    }
                }

                // 清單內但尚無關聯者：新增。
                foreach (var tagId in validTagIds.Where(t => !existingTagIds.Contains(t)))
                {
                    db.QuickLinkTag.Add(new QuickLinkTag
                    {
                        Id = Guid.NewGuid(),
                        UserId = userGuid,
                        QuickLinkId = id,
                        TagId = tagId,
                        CreatedDateTime = DateTime.UtcNow,
                        UpdatedDateTime = DateTime.UtcNow,
                        CreatedUser = userId,
                        UpdatedUser = userId,
                        ValidFlag = true,
                    });
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ApiResponse<object>.Ok(new { id }));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to assign quick-link tags (userId={UserId}, quickLinkId={QuickLinkId})", userGuid, id);
                return Results.StatusCode(500);
            }
        });
    }

    /// <summary>
    /// 將常用連結實體（需先 Include QuickLinkTags.Tag）於記憶體投影為 DTO，
    /// 含其有效標籤（依名稱排序）。全域過濾器已濾掉無效關聯/標籤；仍防呆 null 與 ValidFlag。
    /// </summary>
    /// <param name="ql">已載入標籤關聯的常用連結實體。</param>
    /// <returns>常用連結 DTO（含分類與標籤）。</returns>
    public static QuickLinkDto MapQuickLink(QuickLink ql) =>
        new(
            ql.Id,
            ql.Title,
            ql.Url,
            ql.IconKey,
            ql.Category,
            ql.SortOrder,
            (ql.QuickLinkTags ?? new List<QuickLinkTag>())
                .Where(qt => qt.ValidFlag && qt.Tag != null && qt.Tag.ValidFlag)
                .Select(qt => new TagRefDto(qt.Tag!.Id, qt.Tag.Name))
                .OrderBy(t => t.Name)
                .ToList());
}
