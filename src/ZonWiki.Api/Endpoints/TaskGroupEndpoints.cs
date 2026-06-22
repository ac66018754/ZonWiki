using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 任務群組（TaskGroup）相關的 API 端點：
/// GET/POST /api/task-groups（查詢/建立）、GET/PUT/DELETE /api/task-groups/{id}（詳細/更新/刪除）。
/// </summary>
public static class TaskGroupEndpoints
{
    public static void MapTaskGroupEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 查詢當前使用者的所有任務群組（按排序序號）。
        /// GET /api/task-groups
        /// </summary>
        app.MapGet("/api/task-groups", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var groups = await db.TaskGroup
                .Where(g => g.UserId == userGuid && g.ValidFlag)
                .OrderBy(g => g.SortOrder)
                .Select(g => new TaskGroupDto(g.Id, g.Name, g.Color, g.SortOrder))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<TaskGroupDto>>.Ok(groups));
        });

        /// <summary>
        /// 建立新任務群組。
        /// POST /api/task-groups
        /// Body: { name, color?, sortOrder? }
        /// </summary>
        app.MapPost("/api/task-groups", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateTaskGroupRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var group = new TaskGroup
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Name = request.Name,
                Color = request.Color,
                SortOrder = request.SortOrder,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.TaskGroup.Add(group);
            await db.SaveChangesAsync(ct);

            var dto = new TaskGroupDto(group.Id, group.Name, group.Color, group.SortOrder);
            return Results.Created($"/api/task-groups/{group.Id}", ApiResponse<TaskGroupDto>.Ok(dto));
        });

        /// <summary>
        /// 取得單一任務群組詳細資訊。
        /// GET /api/task-groups/{id}
        /// </summary>
        app.MapGet("/api/task-groups/{id:guid}", async (
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

            var group = await db.TaskGroup
                .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userGuid && g.ValidFlag, ct);

            if (group == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("群組不存在或已刪除"));
            }

            var dto = new TaskGroupDto(group.Id, group.Name, group.Color, group.SortOrder);
            return Results.Ok(ApiResponse<TaskGroupDto>.Ok(dto));
        });

        /// <summary>
        /// 更新任務群組。
        /// PUT /api/task-groups/{id}
        /// Body: { name?, color?, sortOrder? }
        /// </summary>
        app.MapPut("/api/task-groups/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            UpdateTaskGroupRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var group = await db.TaskGroup
                .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userGuid && g.ValidFlag, ct);

            if (group == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("群組不存在或已刪除"));
            }

            // 選擇性更新欄位
            if (!string.IsNullOrEmpty(request.Name))
                group.Name = request.Name;
            if (request.Color != null)
                group.Color = request.Color;
            if (request.SortOrder.HasValue)
                group.SortOrder = request.SortOrder.Value;

            group.UpdatedDateTime = DateTime.UtcNow;
            group.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            var dto = new TaskGroupDto(group.Id, group.Name, group.Color, group.SortOrder);
            return Results.Ok(ApiResponse<TaskGroupDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除任務群組（軟刪除；群組內卡片會變成未分組）。
        /// DELETE /api/task-groups/{id}
        /// </summary>
        app.MapDelete("/api/task-groups/{id:guid}", async (
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

            var group = await db.TaskGroup
                .FirstOrDefaultAsync(g => g.Id == id && g.UserId == userGuid && g.ValidFlag, ct);

            if (group == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("群組不存在或已刪除"));
            }

            // 軟刪除
            group.ValidFlag = false;
            group.DeletedDateTime = DateTime.UtcNow;
            group.UpdatedDateTime = DateTime.UtcNow;
            group.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "群組已刪除" }));
        });
    }
}
