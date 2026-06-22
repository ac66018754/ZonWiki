using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 任務卡片關聯（TaskRelation）相關的 API 端點：
/// GET/POST /api/task-relations（查詢/建立）、DELETE /api/task-relations/{id}（刪除）。
/// 支援同一對卡片去重（同一對卡片的同一種關聯只記一筆）。
/// </summary>
public static class TaskRelationEndpoints
{
    public static void MapTaskRelationEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 查詢當前使用者的所有任務卡片關聯。
        /// GET /api/task-relations
        /// </summary>
        app.MapGet("/api/task-relations", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var relations = await db.TaskRelation
                .Where(r => r.UserId == userGuid && r.ValidFlag)
                .OrderBy(r => r.CreatedDateTime)
                .Select(r => new TaskRelationDto(
                    r.Id,
                    r.SourceTaskCardId,
                    r.TargetTaskCardId,
                    r.Kind))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<TaskRelationDto>>.Ok(relations));
        });

        /// <summary>
        /// 查詢特定卡片的所有關聯（包括作為來源與作為目標）。
        /// GET /api/task-relations/by-card/{cardId}
        /// </summary>
        app.MapGet("/api/task-relations/by-card/{cardId:guid}", async (
            Guid cardId,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var relations = await db.TaskRelation
                .Where(r => r.UserId == userGuid && r.ValidFlag &&
                            (r.SourceTaskCardId == cardId || r.TargetTaskCardId == cardId))
                .OrderBy(r => r.CreatedDateTime)
                .Select(r => new TaskRelationDto(
                    r.Id,
                    r.SourceTaskCardId,
                    r.TargetTaskCardId,
                    r.Kind))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<TaskRelationDto>>.Ok(relations));
        });

        /// <summary>
        /// 建立任務卡片關聯（同一對卡片的同一種關聯去重，確保不重複）。
        /// POST /api/task-relations
        /// Body: { sourceTaskCardId, targetTaskCardId, kind? }
        /// </summary>
        app.MapPost("/api/task-relations", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateTaskRelationRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 驗證兩張卡片都存在且屬於該使用者
            var sourceCard = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == request.SourceTaskCardId && t.UserId == userGuid && t.ValidFlag, ct);

            if (sourceCard == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("來源卡片不存在或已刪除"));
            }

            var targetCard = await db.TaskCard
                .FirstOrDefaultAsync(t => t.Id == request.TargetTaskCardId && t.UserId == userGuid && t.ValidFlag, ct);

            if (targetCard == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("目標卡片不存在或已刪除"));
            }

            // 防止自我關聯
            if (request.SourceTaskCardId == request.TargetTaskCardId)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("卡片不能關聯到自己"));
            }

            // 檢查去重：同一對卡片的同一種關聯（無方向）是否已存在
            // 由於是對等關聯，需要檢查 (A->B, kind) 和 (B->A, kind) 都視為重複
            var kind = request.Kind;
            var existingRelation = await db.TaskRelation
                .FirstOrDefaultAsync(r =>
                    r.UserId == userGuid &&
                    r.ValidFlag &&
                    r.Kind == kind &&
                    ((r.SourceTaskCardId == request.SourceTaskCardId && r.TargetTaskCardId == request.TargetTaskCardId) ||
                     (r.SourceTaskCardId == request.TargetTaskCardId && r.TargetTaskCardId == request.SourceTaskCardId)),
                    ct);

            if (existingRelation != null)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("此卡片對已存在相同關聯"));
            }

            var relation = new TaskRelation
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                SourceTaskCardId = request.SourceTaskCardId,
                TargetTaskCardId = request.TargetTaskCardId,
                Kind = kind,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.TaskRelation.Add(relation);
            await db.SaveChangesAsync(ct);

            var dto = new TaskRelationDto(
                relation.Id,
                relation.SourceTaskCardId,
                relation.TargetTaskCardId,
                relation.Kind);

            return Results.Created($"/api/task-relations/{relation.Id}", ApiResponse<TaskRelationDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除任務卡片關聯。
        /// DELETE /api/task-relations/{id}
        /// </summary>
        app.MapDelete("/api/task-relations/{id:guid}", async (
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

            var relation = await db.TaskRelation
                .FirstOrDefaultAsync(r => r.Id == id && r.UserId == userGuid && r.ValidFlag, ct);

            if (relation == null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("關聯不存在或已刪除"));
            }

            // 軟刪除
            relation.ValidFlag = false;
            relation.DeletedDateTime = DateTime.UtcNow;
            relation.UpdatedDateTime = DateTime.UtcNow;
            relation.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { message = "關聯已刪除" }));
        });
    }
}
