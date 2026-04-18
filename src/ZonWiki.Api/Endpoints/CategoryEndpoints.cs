using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

public static class CategoryEndpoints
{
    public static void MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/categories", async (ZonWikiDbContext db, CancellationToken ct) =>
        {
            var categories = await db.Category
                .Where(c => c.ValidFlag)
                .OrderBy(c => c.FolderPath)
                .Select(c => new CategoryDto(
                    c.Id,
                    c.ParentId,
                    c.Name,
                    c.FolderPath,
                    c.Articles.Count(a => a.ValidFlag)))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<CategoryDto>>.Ok(categories));
        });
    }
}
