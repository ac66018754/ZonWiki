using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 全站搜尋端點：同時搜尋筆記、任務卡片、畫布、節點。
/// 支援大小寫不敏感的全文搜尋；結果含搜尋片段與導航 URL。
/// </summary>
public static class SearchEndpoints
{
    /// <summary>
    /// 註冊全站搜尋 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapSearchEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 執行全站搜尋。
        /// GET /api/search?q={query}
        ///
        /// 搜尋範圍：
        /// - Note（標題、原始內容）
        /// - TaskCard（標題、內容）
        /// - Canvas（名稱）
        /// - Node（標題、內容）
        ///
        /// 隔離策略（重要）：
        /// - Note / TaskCard / Canvas 皆實作 IUserOwned，靠 EF Core 全域查詢過濾自動限定「本人 + 有效」。
        /// - Node（開問啦節點）**不是** IUserOwned、**沒有**任何全域過濾；它的擁有權來自所屬 Canvas。
        ///   因此節點搜尋**必須**明確 Join/過濾 `Node.Canvas.UserId == 目前使用者`，否則會把所有人的節點都撈出來
        ///   （曾發生的跨帳號外洩漏洞：以 "." 搜尋會看到別的帳號的節點內容）。
        /// </summary>
        /// <param name="currentUser">目前登入使用者（用於對非 IUserOwned 的節點做擁有權過濾）。</param>
        /// <param name="db">資料庫 DbContext。</param>
        /// <param name="q">搜尋關鍵字（大小寫不敏感）。</param>
        /// <param name="limit">結果數量限制（預設 50）。</param>
        /// <param name="ct">取消令牌。</param>
        /// <returns>
        /// 統合搜尋結果清單，含結果類型、ID、標題、內容片段、導航 URL。
        /// </returns>
        app.MapGet("/api/search", async (
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            string q,
            int limit = 50,
            CancellationToken ct = default) =>
        {
            // 必須為已登入使用者：未登入則回 401（雖然全域 FallbackPolicy 已要求認證，此處再明確守門一次，
            // 同時確保下方節點擁有權過濾拿得到有效的 UserId，不會以 Guid.Empty 誤放行）。
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(
                    ApiResponse<List<SearchResultDto>>.Fail("Authentication required", 401),
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            // 若查詢字串為空，直接回傳空結果
            if (string.IsNullOrWhiteSpace(q))
            {
                return Results.Ok(
                    ApiResponse<List<SearchResultDto>>.Ok(
                        new List<SearchResultDto>()));
            }

            // 子字串、大小寫不敏感搜尋：改用 PostgreSQL 的 ILIKE（搭配 pg_trgm GIN 索引）。
            // 原本的 n.Title.ToLower().Contains(...) 會翻成 lower() LIKE，無法用索引、且每列都要轉小寫；
            // ILIKE '%關鍵字%' 則能命中 IX_*_Trgm 索引。
            // 使用者輸入中的 LIKE 萬用字元（% _ \）必須轉義，否則會被當成萬用字元而比對到非預期結果。
            var term = q.Trim();
            var pattern = $"%{EscapeLikePattern(term)}%";
            // 片段擷取仍以小寫關鍵字在內容中定位（純顯示用，與查詢條件無關）。
            var keywordLower = term.ToLowerInvariant();

            // 1. 搜尋筆記（標題與內容）
            var noteResults = await db.Note
                .Where(n => n.ValidFlag &&
                    (EF.Functions.ILike(n.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(n.ContentRaw, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(n => new SearchResultDto(
                    "note",
                    n.Id.ToString(),
                    n.Title,
                    ExtractSnippet(n.ContentRaw, keywordLower, 100),
                    $"/notes/{n.Slug}"))
                .Take(limit)
                .ToListAsync(ct);

            // 2. 搜尋任務卡片（標題與內容）
            var taskResults = await db.TaskCard
                .Where(t => t.ValidFlag &&
                    (EF.Functions.ILike(t.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(t.Content, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(t => new SearchResultDto(
                    "task",
                    t.Id.ToString(),
                    t.Title,
                    ExtractSnippet(t.Content, keywordLower, 100),
                    "/tasks"))
                .Take(limit)
                .ToListAsync(ct);

            // 3. 搜尋畫布（標題）
            var canvasResults = await db.Canvas
                .Where(c => c.ValidFlag &&
                    EF.Functions.ILike(c.Title, pattern, LikeEscapeChar))
                .AsNoTracking()
                .Select(c => new SearchResultDto(
                    "canvas",
                    c.Id.ToString(),
                    c.Title,
                    null,
                    $"/canvas?canvasId={c.Id}"))
                .Take(limit)
                .ToListAsync(ct);

            // 4. 搜尋節點（標題與內容）
            // 節點的 URL 格式為 /canvas?canvasId={CanvasId}&nodeId={NodeId}
            // 跨帳號隔離：Node 非 IUserOwned、無全域過濾，必須明確以「所屬 Canvas 屬於目前使用者」過濾，
            // 否則會撈到所有使用者的節點（跨帳號外洩）。此處以 Canvas.UserId 比對目前登入者。
            var nodeResults = await db.Node
                .Where(n => n.ValidFlag &&
                    n.Canvas != null &&
                    n.Canvas.UserId == currentUser.UserId &&
                    n.Canvas.ValidFlag &&
                    (EF.Functions.ILike(n.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(n.Content, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(n => new SearchResultDto(
                    "node",
                    n.Id.ToString(),
                    string.IsNullOrEmpty(n.Title) ? "（無標題）" : n.Title,
                    ExtractSnippet(n.Content, keywordLower, 100),
                    $"/canvas?canvasId={n.CanvasId}&nodeId={n.Id}"))
                .Take(limit)
                .ToListAsync(ct);

            // 5. 合併所有結果
            // 簡單合併策略：依類型順序（筆記 > 任務 > 畫布 > 節點），截斷至 limit
            var allResults = new List<SearchResultDto>();
            allResults.AddRange(noteResults);
            allResults.AddRange(taskResults);
            allResults.AddRange(canvasResults);
            allResults.AddRange(nodeResults);

            var finalResults = allResults.Take(limit).ToList();

            return Results.Ok(ApiResponse<List<SearchResultDto>>.Ok(finalResults));
        });
    }

    /// <summary>
    /// LIKE/ILIKE 的轉義字元（反斜線）。搭配 <see cref="EscapeLikePattern"/> 使用，
    /// 讓使用者輸入中的萬用字元一律以字面值比對。
    /// </summary>
    private const string LikeEscapeChar = "\\";

    /// <summary>
    /// 轉義 LIKE/ILIKE 模式中的特殊字元（反斜線、百分比、底線），
    /// 讓使用者輸入一律以「字面值」比對；查詢時須一併指定 ESCAPE 為 <see cref="LikeEscapeChar"/>。
    /// 反斜線必須最先轉義，否則會把後續補上的轉義反斜線又重複轉義。
    /// </summary>
    /// <param name="input">使用者輸入的搜尋字串。</param>
    /// <returns>已轉義、可安全嵌入 '%...%' 的字串。</returns>
    private static string EscapeLikePattern(string input) =>
        input
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_");

    /// <summary>
    /// 從內容文字擷取包含搜尋關鍵字的片段。
    /// 若找到關鍵字，回傳該關鍵字周邊的文字；若找不到或內容太短，回傳開頭。
    /// </summary>
    /// <param name="content">原始內容文字。</param>
    /// <param name="keyword">搜尋關鍵字（已轉小寫）。</param>
    /// <param name="maxLength">片段最大長度（字元數）。</param>
    /// <returns>擷取的片段文字（若內容為空則回傳 null）。</returns>
    private static string? ExtractSnippet(
        string content,
        string keyword,
        int maxLength = 100)
    {
        if (string.IsNullOrWhiteSpace(content))
            return null;

        // 移除過度的換行符與空白，便於閱讀
        var normalized = System.Text.RegularExpressions.Regex.Replace(
            content,
            @"\s+",
            " ");

        var contentLower = normalized.ToLower();
        var keywordIndex = contentLower.IndexOf(keyword);

        if (keywordIndex >= 0)
        {
            // 找到關鍵字，擷取周邊文字
            var start = Math.Max(0, keywordIndex - 30);
            var length = Math.Min(maxLength, normalized.Length - start);
            var snippet = normalized.Substring(start, length).Trim();

            // 去除開頭/結尾的斷句（避免 "...some text" 的情況）
            if (!snippet.StartsWith(keyword, StringComparison.OrdinalIgnoreCase) && start > 0)
                snippet = "…" + snippet;
            if (start + length < normalized.Length)
                snippet += "…";

            return snippet;
        }

        // 找不到關鍵字，回傳開頭
        if (normalized.Length > maxLength)
            return normalized.Substring(0, maxLength).Trim() + "…";

        return normalized;
    }
}
