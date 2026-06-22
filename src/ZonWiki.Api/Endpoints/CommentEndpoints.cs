using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記留言端點（讀取、發表、刪除）。
/// </summary>
public static class CommentEndpoints
{
    /// <summary>
    /// 註冊留言相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    /// <param name="authConfigured">是否已設定驗證（未設定時略過授權要求）。</param>
    public static void MapCommentEndpoints(this IEndpointRouteBuilder app, bool authConfigured)
    {
        /// <summary>
        /// 取得筆記的所有留言。必須經過使用者認證，只能讀取自己認證範圍內的留言。
        /// （全域查詢過濾確保只見到自己 Workspace 內的留言；每筆留言的擁有者獨立）
        /// </summary>
        var getComments = app.MapGet("/api/notes/{noteId:guid}/comments", async (
            ZonWikiDbContext db,
            Guid noteId,
            CancellationToken ct) =>
        {
            var comments = await db.Comment
                .Where(c => c.ValidFlag && c.NoteId == noteId)
                .OrderBy(c => c.CreatedDateTime)
                .Select(c => new CommentDto(
                    c.Id,
                    c.NoteId,
                    c.UserId,
                    c.User!.DisplayName,
                    c.User.AvatarUrl,
                    c.Content,
                    c.CreatedDateTime))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<CommentDto>>.Ok(comments));
        });

        // 若已設定驗證，強制 GET 端點也要求授權（防止未認證使用者讀取任何留言）
        if (authConfigured)
        {
            getComments.RequireAuthorization();
        }

        var post = app.MapPost("/api/notes/{noteId:guid}/comments", async (
            HttpContext http,
            ZonWikiDbContext db,
            Guid noteId,
            CreateCommentRequest request,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Content))
            {
                return Results.BadRequest(ApiResponse<CommentDto>.Fail("Content is required", 400));
            }
            if (request.Content.Length > 5000)
            {
                return Results.BadRequest(ApiResponse<CommentDto>.Fail("Content too long (max 5000)", 400));
            }

            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (!Guid.TryParse(userIdClaim, out var userId))
            {
                return Results.Json(
                    ApiResponse<CommentDto>.Fail("Invalid user identity", 401),
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            var noteExists = await db.Note
                .AnyAsync(n => n.Id == noteId && n.ValidFlag, ct);
            if (!noteExists)
            {
                return Results.NotFound(ApiResponse<CommentDto>.Fail("Note not found", 404));
            }

            var comment = new Comment
            {
                NoteId = noteId,
                UserId = userId,
                Content = request.Content.Trim(),
                AnchorType = "full",
            };
            db.Comment.Add(comment);
            await db.SaveChangesAsync(ct);

            var user = await db.User.FirstAsync(u => u.Id == userId, ct);
            var dto = new CommentDto(
                comment.Id,
                comment.NoteId,
                comment.UserId,
                user.DisplayName,
                user.AvatarUrl,
                comment.Content,
                comment.CreatedDateTime);

            return Results.Created(
                $"/api/notes/{noteId}/comments/{comment.Id}",
                ApiResponse<CommentDto>.Ok(dto));
        });

        if (authConfigured)
        {
            post.RequireAuthorization();
        }

        var delete = app.MapDelete("/api/comments/{commentId:guid}", async (
            HttpContext http,
            ZonWikiDbContext db,
            Guid commentId,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (!Guid.TryParse(userIdClaim, out var userId))
            {
                return Results.Json(
                    ApiResponse<object>.Fail("Invalid user identity", 401),
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            var comment = await db.Comment
                .FirstOrDefaultAsync(c => c.Id == commentId && c.ValidFlag, ct);

            if (comment is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Comment not found", 404));
            }

            if (comment.UserId != userId)
            {
                return Results.Json(
                    ApiResponse<object>.Fail("Forbidden", 403),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            comment.ValidFlag = false;
            comment.DeletedDateTime = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = commentId }));
        });

        if (authConfigured)
        {
            delete.RequireAuthorization();
        }
    }
}
