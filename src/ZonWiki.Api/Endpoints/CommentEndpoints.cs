using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

public static class CommentEndpoints
{
    public static void MapCommentEndpoints(this IEndpointRouteBuilder app, bool authConfigured)
    {
        app.MapGet("/api/articles/{articleId:guid}/comments", async (
            ZonWikiDbContext db,
            Guid articleId,
            CancellationToken ct) =>
        {
            var comments = await db.Comment
                .Where(c => c.ValidFlag && c.ArticleId == articleId)
                .OrderBy(c => c.CreatedDateTime)
                .Select(c => new CommentDto(
                    c.Id,
                    c.ArticleId,
                    c.UserId,
                    c.User!.DisplayName,
                    c.User.AvatarUrl,
                    c.Content,
                    c.CreatedDateTime))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<CommentDto>>.Ok(comments));
        });

        var post = app.MapPost("/api/articles/{articleId:guid}/comments", async (
            HttpContext http,
            ZonWikiDbContext db,
            Guid articleId,
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

            var articleExists = await db.Article
                .AnyAsync(a => a.Id == articleId && a.ValidFlag, ct);
            if (!articleExists)
            {
                return Results.NotFound(ApiResponse<CommentDto>.Fail("Article not found", 404));
            }

            var comment = new Comment
            {
                ArticleId = articleId,
                UserId = userId,
                Content = request.Content.Trim(),
                AnchorType = "full",
            };
            db.Comment.Add(comment);
            await db.SaveChangesAsync(ct);

            var user = await db.User.FirstAsync(u => u.Id == userId, ct);
            var dto = new CommentDto(
                comment.Id,
                comment.ArticleId,
                comment.UserId,
                user.DisplayName,
                user.AvatarUrl,
                comment.Content,
                comment.CreatedDateTime);

            return Results.Created(
                $"/api/articles/{articleId}/comments/{comment.Id}",
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
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<object>.Ok(new { id = commentId }));
        });

        if (authConfigured)
        {
            delete.RequireAuthorization();
        }
    }
}
