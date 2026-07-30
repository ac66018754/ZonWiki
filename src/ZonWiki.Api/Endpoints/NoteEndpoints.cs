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

        // 依 slug 解析單篇筆記（slug 連動標題 + 舊 slug 別名 + 消歧異）。
        //
        // 回應形狀改為統一的 NoteResolutionDto（見其 summary）：
        //   { kind:"note", matchedByAlias, note }  或  { kind:"ambiguous", requestedSlug, candidates }
        // 解析順序（見 docs/DECISIONS.md「筆記 URL 改版」）：
        //   0. slug 可解析為 GUID → 以 Id 查本人活筆記（永不歧義的錨點）；未命中照常往下（最終 404）；
        //   1. 「活 slug 命中的筆記」∪「別名命中的筆記」，以 NoteId 去重（活優先）：
        //      恰 1 → kind=note（matchedByAlias＝命中來源是別名而非活 slug）；≥2 → kind=ambiguous；0 → 404。
        // 使用者隔離、軟刪連動：全域查詢過濾已把 Note / NoteSlugAlias 都鎖在「本使用者的有效列」，
        // 且別名 join 活筆記會自動排除「所屬筆記已軟刪」的別名（斷了的別名不produce候選）。
        app.MapGet("/api/notes/{*slug}", async (
            ZonWikiDbContext db,
            string slug,
            CancellationToken ct) =>
        {
            // 0. GUID 直達錨點：slug 可被解析為 GUID → 以 Id 查本人活筆記；未命中就照常往下走。
            if (Guid.TryParse(slug, out var directId))
            {
                var direct = await LoadNoteDetailByIdAsync(db, directId, ct);
                if (direct is not null)
                {
                    return Results.Ok(ApiResponse<NoteResolutionDto>.Ok(
                        new NoteResolutionDto("note", false, direct, null, null)));
                }
            }

            // 1a. 活 slug 命中：目前正用這個 slug 的筆記（至多一篇——(UserId,Slug) 活筆記唯一索引）。
            var activeHolder = await db.Note
                .Where(n => n.ValidFlag && n.Slug == slug)
                .Select(n => new { n.Id, n.Title, n.Slug, n.UpdatedDateTime })
                .FirstOrDefaultAsync(ct);

            // 1b. 別名命中：曾讓出這個 slug 的別名，join 到「仍活著」的筆記（軟刪筆記的別名自動被排除）。
            var aliasHits = await db.NoteSlugAlias
                .Where(a => a.ValidFlag && a.Slug == slug)
                .Join(
                    db.Note.Where(n => n.ValidFlag),
                    a => a.NoteId,
                    n => n.Id,
                    (a, n) => new { n.Id, n.Title, n.Slug, n.UpdatedDateTime, a.OriginalTitle })
                .ToListAsync(ct);

            // 以 NoteId 去重（活優先）組出候選。
            var candidates = new List<SlugCandidateDto>();
            var seen = new HashSet<Guid>();
            if (activeHolder is not null)
            {
                candidates.Add(new SlugCandidateDto(
                    activeHolder.Id,
                    activeHolder.Title,
                    activeHolder.Slug,
                    IsCurrentHolder: true,
                    OriginalTitle: null,
                    activeHolder.UpdatedDateTime));
                seen.Add(activeHolder.Id);
            }
            foreach (var hit in aliasHits)
            {
                // 同一篇既是活 slug 又有自我別名（理論上已被自我收斂消掉，這裡再保險去重）→ 活優先。
                if (!seen.Add(hit.Id))
                {
                    continue;
                }
                candidates.Add(new SlugCandidateDto(
                    hit.Id,
                    hit.Title,
                    hit.Slug,
                    IsCurrentHolder: false,
                    hit.OriginalTitle,
                    hit.UpdatedDateTime));
            }

            // 2. 依候選數決定回應。
            if (candidates.Count == 0)
            {
                return Results.NotFound(ApiResponse<NoteResolutionDto>.Fail("Note not found", 404));
            }

            if (candidates.Count == 1)
            {
                var only = candidates[0];
                var detail = await LoadNoteDetailByIdAsync(db, only.Id, ct);
                if (detail is null)
                {
                    // 極窄競態：候選確認後、載入前該筆記剛被軟刪 → 視同不存在。
                    return Results.NotFound(ApiResponse<NoteResolutionDto>.Fail("Note not found", 404));
                }
                // matchedByAlias＝命中來源不是「目前活著的 slug」（即經舊 slug 別名命中）。
                return Results.Ok(ApiResponse<NoteResolutionDto>.Ok(
                    new NoteResolutionDto("note", !only.IsCurrentHolder, detail, null, null)));
            }

            // ≥2 → 消歧異：現用者優先、再依 UpdatedAt 新→舊（記憶體排序，無 SQL 轉譯風險）。
            var ordered = candidates
                .OrderByDescending(c => c.IsCurrentHolder)
                .ThenByDescending(c => c.UpdatedAt)
                .ToList();
            return Results.Ok(ApiResponse<NoteResolutionDto>.Ok(
                new NoteResolutionDto("ambiguous", null, null, slug, ordered)));
        });
    }

    /// <summary>
    /// 依 NoteId 載入單篇筆記的完整 <see cref="NoteDetailDto"/>（含分類/標籤/留言數/樂觀鎖版本）。
    /// slug 解析的三條路徑（GUID 直達 / 活 slug / 別名）共用同一份投影，避免欄位遺漏或前後漂移。
    /// 全域查詢過濾已把範圍鎖在「本使用者的有效筆記」，故僅以 Id 比對即安全（跨使用者/軟刪列不會命中）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="noteId">筆記識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>筆記詳情；查無（不存在/非本人/已軟刪）時為 null。</returns>
    private static async Task<NoteDetailDto?> LoadNoteDetailByIdAsync(
        ZonWikiDbContext db,
        Guid noteId,
        CancellationToken ct)
    {
        // 樂觀鎖版本（#4/#34）：xmin 為 PostgreSQL xid 系統欄。直接 (long)EF.Property<uint>(...) 會被下推成
        // SQL CAST(xid AS bigint)（PostgreSQL 丟 42846），故原生 xid→uint 讀出、材質化後於記憶體放大為 long。
        var row = await db.Note
            .Where(n => n.ValidFlag && n.Id == noteId)
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

        return row is null ? null : row.Dto with { Version = (long)row.Version };
    }
}
