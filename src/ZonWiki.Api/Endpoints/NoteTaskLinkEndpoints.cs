using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記與任務卡片關聯（NoteTaskLink）相關的 API 端點：
/// 支援兩條路徑：
/// - /api/notes/{noteId}/tasks（筆記視角）
/// - /api/tasks/{taskId}/notes（卡片視角）
/// 均支援 GET（查詢）、POST（新增連結）、DELETE（移除連結）。
/// </summary>
public static class NoteTaskLinkEndpoints
{
    public static void MapNoteTaskLinkEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 查詢指定筆記關聯的所有任務卡片。
        /// GET /api/notes/{noteId}/tasks
        /// </summary>
        app.MapGet("/api/notes/{noteId:guid}/tasks", async (
            Guid noteId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 驗證筆記存在且屬於該使用者
            var note = await db.Note
                .FirstOrDefaultAsync(n => n.Id == noteId && n.UserId == userGuid && n.ValidFlag, ct);

            if (note == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("筆記不存在或已刪除"));
            }

            // 取得此筆記關聯的所有卡片
            var links = await db.NoteTaskLink
                .Where(l => l.NoteId == noteId && l.ValidFlag)
                .Include(l => l.TaskCard)
                .Select(l => new NoteTaskLinkDto(l.Id, l.NoteId, l.TaskCardId))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteTaskLinkDto>>.Ok(links));
        });

        /// <summary>
        /// 查詢指定任務卡片關聯的所有筆記。
        /// GET /api/tasks/{taskId}/notes
        /// </summary>
        app.MapGet("/api/tasks/{taskId:guid}/notes", async (
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 驗證卡片存在且屬於該使用者
            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == taskId && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            // 取得此卡片關聯的所有筆記
            var links = await db.NoteTaskLink
                .Where(l => l.TaskCardId == taskId && l.ValidFlag)
                .Include(l => l.Note)
                .Select(l => new NoteTaskLinkDto(l.Id, l.NoteId, l.TaskCardId))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteTaskLinkDto>>.Ok(links));
        });

        /// <summary>
        /// 建立筆記與卡片的關聯。
        /// POST /api/notes/{noteId}/tasks
        /// Body: { taskCardId }
        /// </summary>
        app.MapPost("/api/notes/{noteId:guid}/tasks", async (
            Guid noteId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateNoteTaskLinkRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 驗證筆記存在且屬於該使用者
            var note = await db.Note
                .FirstOrDefaultAsync(n => n.Id == noteId && n.UserId == userGuid && n.ValidFlag, ct);

            if (note == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("筆記不存在或已刪除"));
            }

            // 驗證卡片存在且屬於該使用者
            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == request.TaskCardId && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            // 檢查連結是否已存在（去重）
            var existingLink = await db.NoteTaskLink
                .FirstOrDefaultAsync(l =>
                    l.NoteId == noteId &&
                    l.TaskCardId == request.TaskCardId &&
                    l.ValidFlag,
                    ct);

            if (existingLink != null)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("此筆記與卡片的連結已存在"));
            }

            var link = new NoteTaskLink
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                NoteId = noteId,
                TaskCardId = request.TaskCardId,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.NoteTaskLink.Add(link);
            await db.SaveChangesAsync(ct);

            var dto = new NoteTaskLinkDto(link.Id, link.NoteId, link.TaskCardId);
            return Results.Created($"/api/notes/{noteId}/tasks/{request.TaskCardId}",
                ApiResponse<NoteTaskLinkDto>.Ok(dto));
        });

        /// <summary>
        /// 建立任務卡片與筆記的關聯（反向端點，等同上面）。
        /// POST /api/tasks/{taskId}/notes
        /// Body: { noteId }
        /// </summary>
        app.MapPost("/api/tasks/{taskId:guid}/notes", async (
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateNoteTaskLinkRequest body,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 驗證卡片存在且屬於該使用者
            var card = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == taskId && t.UserId == userGuid && t.ValidFlag, ct);

            if (card == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("卡片不存在或已刪除"));
            }

            // 驗證筆記存在且屬於該使用者
            var note = await db.Note
                .FirstOrDefaultAsync(n => n.Id == body.NoteId && n.UserId == userGuid && n.ValidFlag, ct);

            if (note == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("筆記不存在或已刪除"));
            }

            // 檢查連結是否已存在（去重）
            var existingLink = await db.NoteTaskLink
                .FirstOrDefaultAsync(l =>
                    l.NoteId == body.NoteId &&
                    l.TaskCardId == taskId &&
                    l.ValidFlag,
                    ct);

            if (existingLink != null)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("此筆記與卡片的連結已存在"));
            }

            var link = new NoteTaskLink
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                NoteId = body.NoteId,
                TaskCardId = taskId,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.NoteTaskLink.Add(link);
            await db.SaveChangesAsync(ct);

            var dto = new NoteTaskLinkDto(link.Id, link.NoteId, link.TaskCardId);
            return Results.Created($"/api/tasks/{taskId}/notes/{body.NoteId}",
                ApiResponse<NoteTaskLinkDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除筆記與卡片的關聯。
        /// DELETE /api/notes/{noteId}/tasks/{taskId}
        /// </summary>
        app.MapDelete("/api/notes/{noteId:guid}/tasks/{taskId:guid}", async (
            Guid noteId,
            Guid taskId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var link = await db.NoteTaskLink
                .FirstOrDefaultAsync(l =>
                    l.NoteId == noteId &&
                    l.TaskCardId == taskId &&
                    l.UserId == userGuid &&
                    l.ValidFlag,
                    ct);

            if (link == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("連結不存在或已刪除"));
            }

            // 軟刪除
            link.ValidFlag = false;
            link.DeletedDateTime = DateTime.UtcNow;
            link.UpdatedDateTime = DateTime.UtcNow;
            link.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "連結已刪除" }));
        });

        /// <summary>
        /// 刪除任務卡片與筆記的關聯（反向端點）。
        /// DELETE /api/tasks/{taskId}/notes/{noteId}
        /// </summary>
        app.MapDelete("/api/tasks/{taskId:guid}/notes/{noteId:guid}", async (
            Guid taskId,
            Guid noteId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var link = await db.NoteTaskLink
                .FirstOrDefaultAsync(l =>
                    l.NoteId == noteId &&
                    l.TaskCardId == taskId &&
                    l.UserId == userGuid &&
                    l.ValidFlag,
                    ct);

            if (link == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("連結不存在或已刪除"));
            }

            // 軟刪除
            link.ValidFlag = false;
            link.DeletedDateTime = DateTime.UtcNow;
            link.UpdatedDateTime = DateTime.UtcNow;
            link.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "連結已刪除" }));
        });
    }
}
