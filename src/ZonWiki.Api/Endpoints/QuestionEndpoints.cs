using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Notes;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 問題清單端點：集中檢視「被標記為問題」的浮層元件（便利貼 / T 文字框）。
/// 供分類問題清單頁使用——可看某分類（含所有子孫分類）的問題，或不帶分類看使用者全部問題。
/// </summary>
public static class QuestionEndpoints
{
    /// <summary>
    /// 便利貼型別字串（僅便利貼 / 文字框可被標記為問題）。
    /// </summary>
    private const string StickyKind = "sticky";

    /// <summary>
    /// T 文字框型別字串。
    /// </summary>
    private const string TextKind = "text";

    /// <summary>
    /// 註冊問題清單端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapQuestionEndpoints(this IEndpointRouteBuilder app)
    {
        // GET /api/questions?categoryId= - 列出問題（不帶 categoryId＝全部；帶了＝該分類與其所有子孫分類）
        app.MapGet("/api/questions", async (
            Guid? categoryId,
            HttpContext http,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 帶了 categoryId：先驗證分類屬於本人（非本人／不存在 → 404），
            // 再算出「自己＋所有子孫分類」對應的筆記 id 集合作為篩選範圍。
            // 註：所有查詢除了 EF 全域過濾外，一律「明確」再加 UserId 與 ValidFlag 條件——
            // 縱深防禦，與 SearchEndpoints / NoteOverlayEndpoints 的雙保險慣例一致
            //（過去 Node 實體曾因單靠一道過濾出過跨帳號外洩事故）。
            HashSet<Guid>? scopeNoteIds = null;
            if (categoryId.HasValue)
            {
                var ownsCategory = await db.Category.AnyAsync(
                    c => c.Id == categoryId.Value && c.UserId == userGuid && c.ValidFlag, ct);
                if (!ownsCategory)
                {
                    return Results.NotFound(ApiResponse<List<NoteQuestionListItemDto>>.Fail("Category not found", 404));
                }

                var scopeCategoryIds = await ComputeCategoryScopeAsync(db, userGuid, categoryId.Value, ct);
                var noteIdList = await db.NoteCategory
                    .Where(nc => nc.UserId == userGuid && nc.ValidFlag && scopeCategoryIds.Contains(nc.CategoryId))
                    .Select(nc => nc.NoteId)
                    .Distinct()
                    .ToListAsync(ct);
                scopeNoteIds = noteIdList.ToHashSet();
            }

            // 問題項目查詢：只取被標記為問題、且型別為 sticky / text 者（明確 UserId＋ValidFlag 雙保險）。
            // join Note 讓「所屬筆記被軟刪」的項目一併被過濾掉（DeleteNoteHandler 不會級聯軟刪 overlay）。
            var baseQuery = db.NoteOverlayItem
                .Where(o => o.UserId == userGuid
                    && o.ValidFlag
                    && o.IsQuestion
                    && (o.Kind == StickyKind || o.Kind == TextKind));
            if (scopeNoteIds is not null)
            {
                // 以區域變數捕捉，供 EF 轉譯成 IN 查詢。
                var restrictIds = scopeNoteIds;
                baseQuery = baseQuery.Where(o => restrictIds.Contains(o.NoteId));
            }

            var rows = await (
                from o in baseQuery
                join n in db.Note on o.NoteId equals n.Id
                where n.UserId == userGuid && n.ValidFlag
                orderby o.CreatedDateTime descending
                select new
                {
                    o.Id,
                    o.NoteId,
                    o.Kind,
                    o.Text,
                    o.DataJson,
                    o.QuestionAnswer,
                    o.CreatedDateTime,
                    NoteTitle = n.Title,
                    NoteSlug = n.Slug,
                }).ToListAsync(ct);

            // 一次撈出這些筆記的所有分類關聯（供前端做分類篩選）；不 join 進主查詢以免「一題多分類」造成重複列。
            var resultNoteIds = rows.Select(r => r.NoteId).Distinct().ToList();
            var categoryLinks = await db.NoteCategory
                .Where(nc => nc.UserId == userGuid && nc.ValidFlag && resultNoteIds.Contains(nc.NoteId))
                .Select(nc => new { nc.NoteId, nc.CategoryId })
                .ToListAsync(ct);
            var categoryIdsByNote = categoryLinks
                .GroupBy(x => x.NoteId)
                .ToDictionary(
                    g => g.Key,
                    g => (IReadOnlyList<Guid>)g.Select(x => x.CategoryId).ToList());

            var result = rows
                .Select(r => new NoteQuestionListItemDto(
                    ItemId: r.Id,
                    NoteId: r.NoteId,
                    NoteTitle: r.NoteTitle,
                    NoteSlug: r.NoteSlug,
                    Kind: r.Kind,
                    QuestionTitle: NoteQuestionHelpers.DeriveQuestionTitle(r.Kind, r.Text, r.DataJson),
                    QuestionText: r.Text ?? string.Empty,
                    QuestionAnswer: r.QuestionAnswer,
                    HasAnswer: !string.IsNullOrEmpty(r.QuestionAnswer),
                    CategoryIds: categoryIdsByNote.TryGetValue(r.NoteId, out var cids)
                        ? cids
                        : Array.Empty<Guid>(),
                    CreatedDateTime: r.CreatedDateTime))
                .ToList();

            return Results.Ok(ApiResponse<List<NoteQuestionListItemDto>>.Ok(result));
        }).RequireAuthorization();
    }

    /// <summary>
    /// 計算「指定分類 + 其所有子孫分類」的 id 集合（在記憶體端遞迴，分類量小）。
    /// 以 visited set 防止環狀 ParentId 造成無限遞迴（雖建立端已擋環，仍照多層防線風格防禦）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userGuid">目前使用者識別碼（除全域過濾外，明確過濾雙保險）。</param>
    /// <param name="rootCategoryId">起始分類識別碼。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>包含起始分類與所有子孫分類的 id 集合。</returns>
    private static async Task<HashSet<Guid>> ComputeCategoryScopeAsync(
        ZonWikiDbContext db,
        Guid userGuid,
        Guid rootCategoryId,
        CancellationToken ct)
    {
        // 載入本人所有「有效」分類的 (Id, ParentId)，建「父 → 子清單」對照表（明確 UserId＋ValidFlag 雙保險）。
        var pairs = await db.Category
            .Where(c => c.UserId == userGuid && c.ValidFlag)
            .Select(c => new { c.Id, c.ParentId })
            .ToListAsync(ct);
        var childrenByParent = pairs
            .Where(p => p.ParentId.HasValue)
            .GroupBy(p => p.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Id).ToList());

        var scope = new HashSet<Guid> { rootCategoryId };
        var queue = new Queue<Guid>();
        queue.Enqueue(rootCategoryId);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!childrenByParent.TryGetValue(current, out var children))
            {
                continue;
            }

            foreach (var child in children)
            {
                // Add 回傳 false＝已在集合內（環狀）→ 不再重複入列，避免卡死。
                if (scope.Add(child))
                {
                    queue.Enqueue(child);
                }
            }
        }

        return scope;
    }

    /// <summary>從 claim 取出登入使用者 Id。</summary>
    /// <param name="http">HTTP 內容。</param>
    /// <param name="userGuid">解析出的使用者 Id。</param>
    /// <returns>是否成功取得使用者身分。</returns>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var id = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(id, out userGuid);
    }
}
