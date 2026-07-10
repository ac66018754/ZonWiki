using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
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
        // 分頁（審查 #24）：limit / offset 皆為可選。兩者都不給時維持既有行為（回全部），
        // 確保現有前端呼叫完全相容；提供時才套用 Skip/Take 以支援長清單分頁載入。
        app.MapGet("/api/notes", async (
            ZonWikiDbContext db,
            Guid? categoryId,
            Guid? tagId,
            int? limit,
            int? offset,
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

            // 先固定排序（分頁的前提），再套用可選的位移與筆數上限。
            var orderedQuery = query.OrderByDescending(n => n.UpdatedDateTime);

            // 位移（offset）：負值視為 0，避免非法查詢。
            IQueryable<ZonWiki.Domain.Entities.Note> pagedQuery = orderedQuery;
            if (offset.HasValue && offset.Value > 0)
            {
                pagedQuery = pagedQuery.Skip(offset.Value);
            }

            // 筆數上限（limit）：夾在 1~2000 之間，避免單頁抓取過量拖垮伺服器。
            if (limit.HasValue)
            {
                var cappedLimit = Math.Clamp(limit.Value, 1, 2000);
                pagedQuery = pagedQuery.Take(cappedLimit);
            }

            var items = await pagedQuery
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
                        .ToList(),
                    n.CreatedDateTime,
                    n.LastOpenedDateTime))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<NoteSummaryDto>>.Ok(items));
        });

        // 標記筆記「最後打開時間」：前端開啟筆記詳情時呼叫。輕量、不動 UpdatedDateTime。
        //
        // 併發權杖（xmin）注意（#4/#34；2026-07-10 修「開啟即假衝突」）：本端點直接 UPDATE 筆記那一列的
        // Note_LastOpenedDateTime。PostgreSQL 的 xmin 是「整列」的系統欄——只要該列被 UPDATE，xmin 必然
        // 改變，無法只更新某欄而不動它。若不回傳新版本，前端手上「載入時記下的 Version」會在標記打開後
        // 立刻過期；使用者接著存檔（帶過期 baseVersion）便撲空、收到假的 409「此筆記已被其他來源修改」，
        // 即使全程只有本人也沒真的改過別處。故此處於更新後回讀最新 xmin 一併回傳，讓前端把 baseVersion
        // 同步成最新，消除「開啟即假衝突」。
        app.MapPost("/api/notes/{id:guid}/opened", async (
            ZonWikiDbContext db,
            HttpContext http,
            Guid id,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userGuid))
            {
                return Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);
            }

            // 直接 UPDATE，不載入實體（避免觸發版本/稽核流程）；ExecuteUpdate 不改 UpdatedDateTime。
            var affected = await db.Note
                .Where(n => n.Id == id && n.UserId == userGuid && n.ValidFlag)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.LastOpenedDateTime, DateTime.UtcNow), ct);

            if (affected == 0)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
            }

            // 回讀更新後的最新 xmin（原生 xid→uint 讀出、不下推 SQL CAST，避免「42846: cannot cast type
            // xid to bigint」；材質化後再於記憶體放大為 long），供前端把 baseVersion 同步成最新。
            // 用 FirstOrDefaultAsync（非 FirstAsync）並帶 ValidFlag：極窄競態下——UPDATE 成功提交後、
            // 回讀 SELECT 前，該列剛被別處（同帳號另一請求，如垃圾桶軟刪）軟刪除——回讀會撈不到列，
            // FirstAsync 會對空序列丟未處理例外變成 500；改回 null → 視同筆記已不存在回 404（前端
            // markNoteOpened 對非 200 靜默回 null、不影響閱讀）。投影成匿名型別以便用 null 判斷「無列」。
            var row = await db.Note
                .Where(n => n.Id == id && n.UserId == userGuid && n.ValidFlag)
                .Select(n => new { Xmin = EF.Property<uint>(n, "xmin") })
                .FirstOrDefaultAsync(ct);

            if (row is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("Note not found", 404));
            }

            return Results.Ok(ApiResponse<object>.Ok(new { id, version = (long)row.Xmin }));
        }).RequireAuthorization();

        // 依 slug 取單篇筆記詳情。
        app.MapGet("/api/notes/{*slug}", async (
            ZonWikiDbContext db,
            string slug,
            CancellationToken ct) =>
        {
            // 樂觀鎖版本（#4/#34）：xmin 是 PostgreSQL 的 xid 系統欄。若在投影裡直接寫
            // (long)EF.Property<uint>(n, "xmin")，EF 會把 (long) 轉型下推成 SQL 的
            // CAST(xmin AS bigint)——但 PostgreSQL 不允許 xid→bigint 轉型，執行期會丟
            // 「42846: cannot cast type xid to bigint」，導致筆記載入 500。
            // 因此改以「原生 xid→uint 讀出（不加任何轉型）」，材質化後再於記憶體放大為 long 回填。
            var noteRow = await db.Note
                .Where(n => n.ValidFlag && n.Slug == slug)
                .Select(n => new
                {
                    Dto = new NoteDetailDto(
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
                            .ToList(),
                        // 版本先以 0 佔位，材質化後再回填（見上方註解）。
                        0L),
                    Version = EF.Property<uint>(n, "xmin"),
                })
                .FirstOrDefaultAsync(ct);

            if (noteRow is null)
            {
                return Results.NotFound(ApiResponse<NoteDetailDto>.Fail("Note not found", 404));
            }

            var note = noteRow.Dto with { Version = (long)noteRow.Version };

            return Results.Ok(ApiResponse<NoteDetailDto>.Ok(note));
        });
    }
}
