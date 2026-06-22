using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 快速捕捉項目（Inbox 收件匣）相關的 API 端點：
/// GET /api/captures（列出）、POST /api/captures（建立）、
/// GET /api/captures/{id}（詳情）、DELETE /api/captures/{id}（刪除）、
/// PUT /api/captures/{id}/file（歸檔：轉換成筆記或任務卡片）。
/// 屬當前登入使用者的資源，首頁與筆記頁共用此收件匣。
/// </summary>
public static class CaptureItemEndpoints
{
    /// <summary>
    /// 註冊快速捕捉項目相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapCaptureItemEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 列出當前登入使用者的所有捕捉項目（可依狀態篩選，預設列出待分流的）。
        /// GET /api/captures?status=inbox|filed|all
        /// </summary>
        app.MapGet("/api/captures", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            string status = "inbox",
            CancellationToken ct = default) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var query = db.CaptureItem
                .Where(ci => ci.UserId == userGuid && ci.ValidFlag);

            // 依狀態篩選
            if (status != "all")
            {
                query = query.Where(ci => ci.Status == status);
            }

            var items = await query
                .OrderByDescending(ci => ci.CreatedDateTime)
                .Select(ci => new CaptureItemDto(
                    ci.Id,
                    ci.Source,
                    ci.RawContent,
                    ci.AudioPath,
                    ci.Status,
                    ci.FiledTargetType,
                    ci.FiledTargetId,
                    ci.CreatedDateTime))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<CaptureItemDto>>.Ok(items));
        });

        /// <summary>
        /// 建立新快速捕捉項目（優先用 source 辨識：web/voice/text）。
        /// POST /api/captures
        /// Body: { source, rawContent, audioPath? }
        /// </summary>
        app.MapPost("/api/captures", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateCaptureItemRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var capture = new CaptureItem
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Source = request.Source,
                RawContent = request.RawContent,
                AudioPath = request.AudioPath,
                Status = "inbox",
                FiledTargetType = null,
                FiledTargetId = null,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true
            };

            db.CaptureItem.Add(capture);
            await db.SaveChangesAsync(ct);

            var dto = new CaptureItemDto(
                capture.Id,
                capture.Source,
                capture.RawContent,
                capture.AudioPath,
                capture.Status,
                capture.FiledTargetType,
                capture.FiledTargetId,
                capture.CreatedDateTime);

            return Results.Created($"/api/captures/{capture.Id}", ApiResponse<CaptureItemDto>.Ok(dto));
        });

        /// <summary>
        /// 取得單一捕捉項目詳情。
        /// GET /api/captures/{id}
        /// </summary>
        app.MapGet("/api/captures/{id:guid}", async (
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

            var capture = await db.CaptureItem
                .Where(ci => ci.Id == id && ci.UserId == userGuid && ci.ValidFlag)
                .Select(ci => new CaptureItemDto(
                    ci.Id,
                    ci.Source,
                    ci.RawContent,
                    ci.AudioPath,
                    ci.Status,
                    ci.FiledTargetType,
                    ci.FiledTargetId,
                    ci.CreatedDateTime))
                .FirstOrDefaultAsync(ct);

            if (capture is null)
            {
                return Results.NotFound(ApiResponse<CaptureItemDto>.Fail("Capture item not found", 404));
            }

            return Results.Ok(ApiResponse<CaptureItemDto>.Ok(capture));
        });

        /// <summary>
        /// 歸檔捕捉項目：將捕捉轉換成筆記（Note）或任務卡片（TaskCard），標記狀態為 filed。
        /// PUT /api/captures/{id}/file
        /// Body: { filedTargetType, filedTargetId }
        /// 其中 filedTargetType 為 "note" 或 "taskcard"，filedTargetId 為對應實體的識別碼。
        /// </summary>
        app.MapPut("/api/captures/{id:guid}/file", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            ArchiveCaptureItemRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var capture = await db.CaptureItem
                .Where(ci => ci.Id == id && ci.UserId == userGuid && ci.ValidFlag)
                .FirstOrDefaultAsync(ct);

            if (capture is null)
            {
                return Results.NotFound(ApiResponse<CaptureItemDto>.Fail("Capture item not found", 404));
            }

            // 驗證目標型別與 ID
            if (request.FiledTargetType != "note" && request.FiledTargetType != "taskcard")
            {
                return Results.BadRequest(ApiResponse<object>.Fail(
                    "Invalid filedTargetType: must be 'note' or 'taskcard'", 400));
            }

            // 驗證目標實體是否存在（簡單檢查：確保目標 ID 對應的實體屬於當前使用者）
            if (request.FiledTargetType == "note")
            {
                var noteExists = await db.Note
                    .AnyAsync(n => n.Id == request.FiledTargetId && n.UserId == userGuid && n.ValidFlag, ct);
                if (!noteExists)
                {
                    return Results.BadRequest(ApiResponse<object>.Fail(
                        "Target note not found or does not belong to current user", 400));
                }
            }
            else if (request.FiledTargetType == "taskcard")
            {
                var taskExists = await db.TaskCard
                    .AnyAsync(t => t.Id == request.FiledTargetId && t.UserId == userGuid && t.ValidFlag, ct);
                if (!taskExists)
                {
                    return Results.BadRequest(ApiResponse<object>.Fail(
                        "Target task card not found or does not belong to current user", 400));
                }
            }

            capture.Status = "filed";
            capture.FiledTargetType = request.FiledTargetType;
            capture.FiledTargetId = request.FiledTargetId;
            capture.UpdatedDateTime = DateTime.UtcNow;
            capture.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            var dto = new CaptureItemDto(
                capture.Id,
                capture.Source,
                capture.RawContent,
                capture.AudioPath,
                capture.Status,
                capture.FiledTargetType,
                capture.FiledTargetId,
                capture.CreatedDateTime);

            return Results.Ok(ApiResponse<CaptureItemDto>.Ok(dto));
        });

        /// <summary>
        /// 刪除捕捉項目（軟刪除：ValidFlag = false）。
        /// DELETE /api/captures/{id}
        /// </summary>
        app.MapDelete("/api/captures/{id:guid}", async (
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

            var capture = await db.CaptureItem
                .Where(ci => ci.Id == id && ci.UserId == userGuid && ci.ValidFlag)
                .FirstOrDefaultAsync(ct);

            if (capture is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Capture item not found", 404));
            }

            capture.ValidFlag = false;
            capture.DeletedDateTime = DateTime.UtcNow; // 進垃圾桶需設刪除時間
            capture.UpdatedDateTime = DateTime.UtcNow;
            capture.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        });

        /// <summary>
        /// 列出某捕捉項目衍生的筆記 / 任務（依建立時間；含已刪除標記）。
        /// GET /api/captures/{id}/links
        /// </summary>
        app.MapGet("/api/captures/{id:guid}/links", async (
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

            var links = await db.CaptureLink
                .Where(cl => cl.CaptureItemId == id && cl.UserId == userGuid && cl.ValidFlag)
                .OrderBy(cl => cl.CreatedDateTime)
                .ToListAsync(ct);

            var noteIds = links.Where(l => l.TargetType == "note").Select(l => l.TargetId).ToList();
            var taskIds = links.Where(l => l.TargetType == "taskcard").Select(l => l.TargetId).ToList();

            var notes = await db.Note
                .Where(n => noteIds.Contains(n.Id) && n.UserId == userGuid && n.ValidFlag)
                .Select(n => new { n.Id, n.Title, n.Slug })
                .ToListAsync(ct);
            var tasks = await db.TaskCard
                .Where(t => taskIds.Contains(t.Id) && t.UserId == userGuid && t.ValidFlag)
                .Select(t => new { t.Id, t.Title })
                .ToListAsync(ct);

            var dtos = links.Select(l =>
            {
                if (l.TargetType == "note")
                {
                    var n = notes.FirstOrDefault(x => x.Id == l.TargetId);
                    return new CaptureLinkDto(l.Id, "note", l.TargetId,
                        n?.Title ?? "(已刪除的筆記)", n?.Slug, n is null);
                }
                var tk = tasks.FirstOrDefault(x => x.Id == l.TargetId);
                return new CaptureLinkDto(l.Id, "taskcard", l.TargetId,
                    string.IsNullOrWhiteSpace(tk?.Title) ? (tk is null ? "(已刪除的任務)" : "(無標題任務)") : tk!.Title,
                    null, tk is null);
            }).ToList();

            return Results.Ok(ApiResponse<List<CaptureLinkDto>>.Ok(dtos));
        });

        /// <summary>
        /// 為捕捉項目新增一筆「衍生關聯」（筆記/任務由前端先以既有端點建立後回填），並把捕捉標為已歸檔。
        /// POST /api/captures/{id}/links  Body: { targetType, targetId }
        /// </summary>
        app.MapPost("/api/captures/{id:guid}/links", async (
            Guid id,
            CreateCaptureLinkRequest request,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var targetType = (request.TargetType ?? string.Empty).Trim().ToLowerInvariant();
            if (targetType != "note" && targetType != "taskcard")
            {
                return Results.BadRequest(ApiResponse<object>.Fail("targetType 必須為 note 或 taskcard", 400));
            }

            var capture = await db.CaptureItem
                .FirstOrDefaultAsync(ci => ci.Id == id && ci.UserId == userGuid && ci.ValidFlag, ct);
            if (capture is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Capture item not found", 404));
            }

            // 驗證衍生目標屬於本人且有效
            var targetOk = targetType == "note"
                ? await db.Note.AnyAsync(n => n.Id == request.TargetId && n.UserId == userGuid && n.ValidFlag, ct)
                : await db.TaskCard.AnyAsync(t => t.Id == request.TargetId && t.UserId == userGuid && t.ValidFlag, ct);
            if (!targetOk)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("目標不存在或不屬於你", 400));
            }

            db.CaptureLink.Add(new CaptureLink
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                CaptureItemId = id,
                TargetType = targetType,
                TargetId = request.TargetId,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true,
            });

            // 捕捉標為已歸檔（仍保留在最近記錄中，可再衍生更多）
            capture.Status = "filed";
            capture.UpdatedDateTime = DateTime.UtcNow;
            capture.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id }));
        });
    }
}
