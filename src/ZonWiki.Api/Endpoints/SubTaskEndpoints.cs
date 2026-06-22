using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 子任務端點（#8 重構後）：子任務＝「有父任務的任務」（子 TaskCard）。
/// 為了相容前端既有呼叫，路由與回傳形狀（SubTaskDto）維持不變，但底層全部改操作「子 TaskCard」：
/// 列出某卡片的子任務、在卡片下新增、更新（改標題 / 打勾完成 / 排序）、刪除、整批重新排序。
/// SubTaskDto.Id 即「子任務的任務 Id」，故前端可用它直接開啟完整任務編輯器。
/// 一律以登入使用者隔離（IUserOwned 全域過濾 + 端點內明確比對 UserId）。
/// </summary>
public static class SubTaskEndpoints
{
    /// <summary>把子 TaskCard 投影成相容前端的 SubTaskDto。</summary>
    private static SubTaskDto ToDto(TaskCard child) =>
        new(child.Id, child.ParentId ?? Guid.Empty, child.Title, child.Status == "done",
            child.SortOrder, child.CreatedDateTime, child.CompletedDateTime);

    /// <summary>
    /// 註冊子任務相關的 HTTP 端點。
    /// </summary>
    public static void MapSubTaskEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出某張卡片底下的子任務（＝ParentId 指向它的子 TaskCard，依排序）。
        app.MapGet("/api/tasks/{taskId:guid}/subtasks", async (
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(httpContext, out var userGuid, out _))
            {
                return Results.Unauthorized();
            }

            var children = await db.TaskCard
                .Where(c => c.ParentId == taskId && c.UserId == userGuid && c.ValidFlag)
                .OrderBy(c => c.SortOrder)
                .ThenBy(c => c.CreatedDateTime)
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<SubTaskDto>>.Ok(children.Select(ToDto).ToList()));
        });

        // 在某張卡片底下新增子任務（建立一張 ParentId 指向它的子 TaskCard）。
        app.MapPost("/api/tasks/{taskId:guid}/subtasks", async (
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateSubTaskRequest request,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(httpContext, out var userGuid, out var userId))
            {
                return Results.Unauthorized();
            }
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.BadRequest(ApiResponse<object>.Fail("子任務標題不可為空"));
            }

            // 確認父卡片存在且屬於本人。
            var parentExists = await db.TaskCard
                .AnyAsync(t => t.Id == taskId && t.UserId == userGuid && t.ValidFlag, ct);
            if (!parentExists)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            try
            {
                var maxSortOrder = await db.TaskCard
                    .Where(c => c.ParentId == taskId && c.UserId == userGuid && c.ValidFlag)
                    .Select(c => (int?)c.SortOrder)
                    .MaxAsync(ct) ?? -1;

                var child = new TaskCard
                {
                    Id = Guid.NewGuid(),
                    UserId = userGuid,
                    ParentId = taskId,
                    Title = request.Title.Trim(),
                    Content = string.Empty,
                    Status = "todo",
                    Priority = 0,
                    SortOrder = maxSortOrder + 1,
                    CreatedDateTime = DateTime.UtcNow,
                    UpdatedDateTime = DateTime.UtcNow,
                    CreatedUser = userId,
                    UpdatedUser = userId,
                    ValidFlag = true,
                };

                db.TaskCard.Add(child);
                await db.SaveChangesAsync(ct);

                return Results.Created($"/api/tasks/{child.Id}", ApiResponse<SubTaskDto>.Ok(ToDto(child)));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to create subtask (userId={UserId}, taskId={TaskId})", userGuid, taskId);
                return Results.StatusCode(500);
            }
        });

        // 更新子任務（標題 / 完成狀態 / 排序，皆選擇性）；對應更新子 TaskCard。
        app.MapPut("/api/subtasks/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            UpdateSubTaskRequest request,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(httpContext, out var userGuid, out var userId))
            {
                return Results.Unauthorized();
            }

            // 子任務＝子 TaskCard（必須有 ParentId，避免把頂層任務當子任務改）。
            var child = await db.TaskCard
                .FirstOrDefaultAsync(c => c.Id == id && c.UserId == userGuid && c.ValidFlag && c.ParentId != null, ct);
            if (child == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("子任務不存在或已刪除"));
            }

            if (!string.IsNullOrWhiteSpace(request.Title))
                child.Title = request.Title.Trim();
            if (request.IsDone.HasValue)
            {
                child.Status = request.IsDone.Value ? "done" : "todo";
                child.CompletedDateTime = request.IsDone.Value ? DateTime.UtcNow : null;
            }
            if (request.SortOrder.HasValue)
                child.SortOrder = request.SortOrder.Value;

            child.UpdatedDateTime = DateTime.UtcNow;
            child.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<SubTaskDto>.Ok(ToDto(child)));
        });

        // 刪除子任務（軟刪除子 TaskCard）。
        app.MapDelete("/api/subtasks/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(httpContext, out var userGuid, out var userId))
            {
                return Results.Unauthorized();
            }

            var child = await db.TaskCard
                .FirstOrDefaultAsync(c => c.Id == id && c.UserId == userGuid && c.ValidFlag && c.ParentId != null, ct);
            if (child == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("子任務不存在或已刪除"));
            }

            child.ValidFlag = false;
            child.DeletedDateTime = DateTime.UtcNow;
            child.UpdatedDateTime = DateTime.UtcNow;
            child.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "子任務已刪除" }));
        });

        // 整批重新排序某卡片底下的子任務（依傳入順序設定 SortOrder = 索引）。
        app.MapPut("/api/tasks/{taskId:guid}/subtasks/reorder", async (
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            ReorderSubTasksRequest request,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(httpContext, out var userGuid, out _))
            {
                return Results.Unauthorized();
            }

            var orderedIds = request.OrderedIds ?? new List<Guid>();
            if (orderedIds.Count == 0)
            {
                return Results.Ok(ApiResponse<object>.Ok(new { Count = 0 }));
            }

            try
            {
                var children = await db.TaskCard
                    .Where(c => c.ParentId == taskId && c.UserId == userGuid && c.ValidFlag
                                && orderedIds.Contains(c.Id))
                    .ToListAsync(ct);

                for (var index = 0; index < orderedIds.Count; index++)
                {
                    var child = children.FirstOrDefault(c => c.Id == orderedIds[index]);
                    if (child is not null)
                    {
                        child.SortOrder = index;
                    }
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ApiResponse<object>.Ok(new { Count = children.Count }));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to reorder subtasks (userId={UserId}, taskId={TaskId})", userGuid, taskId);
                return Results.StatusCode(500);
            }
        });
    }

    /// <summary>
    /// 從 HttpContext 取出登入使用者 Id（GUID 與原字串）。
    /// </summary>
    private static bool TryGetUserId(HttpContext httpContext, out Guid userGuid, out string userId)
    {
        userGuid = Guid.Empty;
        userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value ?? string.Empty;
        return !string.IsNullOrEmpty(userId) && Guid.TryParse(userId, out userGuid);
    }
}
