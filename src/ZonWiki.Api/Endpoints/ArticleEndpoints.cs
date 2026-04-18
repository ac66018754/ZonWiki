using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

public static class ArticleEndpoints
{
    public static void MapArticleEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/articles", async (
            ZonWikiDbContext db,
            Guid? categoryId,
            CancellationToken ct) =>
        {
            var query = db.Article.Where(a => a.ValidFlag);
            if (categoryId.HasValue)
            {
                query = query.Where(a => a.CategoryId == categoryId.Value);
            }

            var items = await query
                .OrderByDescending(a => a.UpdatedDateTime)
                .Select(a => new ArticleSummaryDto(
                    a.Id,
                    a.CategoryId,
                    a.Title,
                    a.Slug,
                    a.FilePath,
                    a.UpdatedDateTime))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<ArticleSummaryDto>>.Ok(items));
        });

        app.MapGet("/api/articles/{*slug}", async (
            ZonWikiDbContext db,
            string slug,
            CancellationToken ct) =>
        {
            var article = await db.Article
                .Include(a => a.Category)
                .Where(a => a.ValidFlag && a.Slug == slug)
                .Select(a => new ArticleDetailDto(
                    a.Id,
                    a.CategoryId,
                    a.Category!.Name,
                    a.Title,
                    a.Slug,
                    a.FilePath,
                    a.ContentHtml,
                    a.CreatedDateTime,
                    a.UpdatedDateTime,
                    a.Comments.Count(c => c.ValidFlag)))
                .FirstOrDefaultAsync(ct);

            if (article is null)
            {
                return Results.NotFound(ApiResponse<ArticleDetailDto>.Fail("Article not found", 404));
            }

            return Results.Ok(ApiResponse<ArticleDetailDto>.Ok(article));
        });
    }
}
