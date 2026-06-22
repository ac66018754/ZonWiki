using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記查詢端點（清單 / 依 slug 取單篇）。可編輯的 CRUD 端點於 P2 補上。
/// </summary>
public static class NoteEndpoints
{
    /// <summary>
    /// 註冊筆記相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapNoteEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出筆記；可用 categoryId / tagId 篩選（透過多對多 NoteCategory / NoteTag）。
        app.MapGet("/api/notes", async (
            ZonWikiDbContext db,
            Guid? categoryId,
            Guid? tagId,
            CancellationToken ct) =>
        {
            var query = db.Note.Where(n => n.ValidFlag);

            if (categoryId.HasValue)
            {
                query = query.Where(n => db.NoteCategory.Any(nc =>
                    nc.ValidFlag && nc.NoteId == n.Id && nc.CategoryId == categoryId.Value));
            }

            if (tagId.HasValue)
            {
                query = query.Where(n => db.NoteTag.Any(nt =>
                    nt.ValidFlag && nt.NoteId == n.Id && nt.TagId == tagId.Value));
            }

            var items = await query
                .OrderByDescending(n => n.UpdatedDateTime)
                .Select(n => new NoteSummaryDto(
                    n.Id,
                    n.Title,
                    n.Slug,
                    n.Kind,
                    n.IsDraft,
                    n.UpdatedDateTime,
                    // 清單批次操作用：此筆記目前的分類與標籤（軟刪除者排除）。
                    n.NoteCategories
                        .Where(nc => nc.ValidFlag && nc.Category != null && nc.Category.ValidFlag)
                        .Select(nc => new TagRefDto(nc.Category!.Id, nc.Category.Name))
                        .ToList(),
                    n.NoteTags
                        .Where(nt => nt.ValidFlag && nt.Tag != null && nt.Tag.ValidFlag)
                        .Select(nt => new TagRefDto(nt.Tag!.Id, nt.Tag.Name))
                        .ToList()))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteSummaryDto>>.Ok(items));
        });

        // 依 slug 取單篇筆記詳情。
        app.MapGet("/api/notes/{*slug}", async (
            ZonWikiDbContext db,
            string slug,
            CancellationToken ct) =>
        {
            var note = await db.Note
                .Where(n => n.ValidFlag && n.Slug == slug)
                .Select(n => new NoteDetailDto(
                    n.Id,
                    n.Title,
                    n.Slug,
                    n.ContentHtml,
                    n.ContentRaw,
                    n.Kind,
                    n.IsDraft,
                    n.CreatedDateTime,
                    n.UpdatedDateTime,
                    n.Comments.Count(c => c.ValidFlag),
                    // 編輯時用以預選：此筆記目前的分類與標籤（分類/標籤被軟刪除時排除）。
                    n.NoteCategories
                        .Where(nc => nc.ValidFlag && nc.Category != null && nc.Category.ValidFlag)
                        .Select(nc => new TagRefDto(nc.Category!.Id, nc.Category.Name))
                        .ToList(),
                    n.NoteTags
                        .Where(nt => nt.ValidFlag && nt.Tag != null && nt.Tag.ValidFlag)
                        .Select(nt => new TagRefDto(nt.Tag!.Id, nt.Tag.Name))
                        .ToList()))
                .FirstOrDefaultAsync(ct);

            if (note is null)
            {
                return Results.NotFound(ApiResponse<NoteDetailDto>.Fail("Note not found", 404));
            }

            return Results.Ok(ApiResponse<NoteDetailDto>.Ok(note));
        });
    }
}
