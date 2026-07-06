using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 全站搜尋端點：同時搜尋筆記、任務卡片、畫布、節點、標籤、分類與快速捕捉。
/// 支援大小寫不敏感的子字串搜尋（走 pg_trgm GIN 索引）；
/// 結果依「相關性（trigram similarity）」排序，並帶類型標記供前端分類/篩選。
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
        /// 搜尋範圍（每筆結果都帶 Type 類型標記，供前端分類與篩選）：
        /// - note（筆記：標題、原始內容）
        /// - task（任務卡片：標題、內容）
        /// - canvas（畫布：名稱）
        /// - node（開問啦節點：標題、內容）
        /// - tag（標籤：名稱）
        /// - category（分類：名稱）
        /// - capture（快速捕捉／Inbox：原始內容）
        ///
        /// 相關性排序：
        /// - 以 pg_trgm 的 similarity() 計算查詢字串與各欄位的相似度，做為相關性分數；
        ///   標題／名稱命中權重高於內文命中（見 <see cref="ContentSimilarityWeight"/>）。
        /// - 多欄位類型（note/task/node）：撈回所有 ILIKE 命中列，先算完「標題＋內文」合併相關性分數，
        ///   再依該分數排序並取 limit 筆；不可在合併前以單一欄位（標題）截斷，否則僅內文命中的相關列會漏掉。
        /// - 單欄位類型（canvas/tag/category/capture）：該欄位相似度即相關性，於 SQL 端排序取 limit 筆即可。
        /// - 最後跨類型再依相關性分數合併排序、取 limit 筆。
        ///
        /// 隔離策略（重要）：
        /// - Note / TaskCard / Canvas / Tag / Category / CaptureItem 皆實作 IUserOwned，
        ///   靠 EF Core 全域查詢過濾自動限定「本人」；此處仍明確加上 ValidFlag 過濾（軟刪除）。
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
        /// 統合搜尋結果清單，含結果類型、ID、標題、內容片段、導航 URL；已依相關性排序。
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

            // 各類型查詢：以 ILIKE 過濾（走 GIN 索引），以 trigram similarity 排序取相關性最高者。
            // 為避免 EF 把 ExtractSnippet 等 C# 方法誤帶入 SQL 轉譯，一律「先把可轉譯的欄位＋相似度撈回記憶體，
            // 再於記憶體端組 DTO（含片段擷取與相關性分數合併）」。

            // 1. 筆記（標題＋原始內容）
            // 重要：不可在 SQL 端「先依標題相似度排序再 Take(limit)」，否則只靠內文命中、標題不相關的列
            // 會在合併相關性分數之前就被整批截掉，永遠進不了候選池（finding #W8-1）。
            // 正確作法：撈回所有 ILIKE 命中列與標題／內文兩個相似度，於記憶體端算完合併相關性分數後才截斷。
            var noteRows = await db.Note
                .Where(n => n.ValidFlag &&
                    (EF.Functions.ILike(n.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(n.ContentRaw, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(n => new
                {
                    n.Id,
                    n.Title,
                    n.ContentRaw,
                    n.Slug,
                    TitleSimilarity = EF.Functions.TrigramsSimilarity(n.Title, term),
                    ContentSimilarity = EF.Functions.TrigramsSimilarity(n.ContentRaw, term),
                })
                .ToListAsync(ct);

            var noteScored = noteRows
                .Select(row => new ScoredSearchResult(
                    new SearchResultDto(
                        TypeNote,
                        row.Id.ToString(),
                        row.Title,
                        ExtractSnippet(row.ContentRaw, keywordLower, SnippetMaxLength),
                        $"/notes/{row.Slug}"),
                    CombineRelevance(row.TitleSimilarity, row.ContentSimilarity),
                    TypeRankNote))
                // 合併相關性分數算完之後才截斷，確保內文命中列有公平機會進入候選池。
                .OrderByDescending(scored => scored.Relevance)
                .Take(limit);

            // 2. 任務卡片（標題＋內容）
            // 同筆記：不可在合併相關性分數前依標題相似度截斷（finding #W8-1）。
            var taskRows = await db.TaskCard
                .Where(t => t.ValidFlag &&
                    (EF.Functions.ILike(t.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(t.Content, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(t => new
                {
                    t.Id,
                    t.Title,
                    t.Content,
                    TitleSimilarity = EF.Functions.TrigramsSimilarity(t.Title, term),
                    ContentSimilarity = EF.Functions.TrigramsSimilarity(t.Content, term),
                })
                .ToListAsync(ct);

            var taskScored = taskRows
                .Select(row => new ScoredSearchResult(
                    new SearchResultDto(
                        TypeTask,
                        row.Id.ToString(),
                        row.Title,
                        ExtractSnippet(row.Content, keywordLower, SnippetMaxLength),
                        "/tasks"),
                    CombineRelevance(row.TitleSimilarity, row.ContentSimilarity),
                    TypeRankTask))
                // 合併相關性分數算完之後才截斷。
                .OrderByDescending(scored => scored.Relevance)
                .Take(limit);

            // 3. 畫布（名稱）
            var canvasRows = await db.Canvas
                .Where(c => c.ValidFlag &&
                    EF.Functions.ILike(c.Title, pattern, LikeEscapeChar))
                .OrderByDescending(c => EF.Functions.TrigramsSimilarity(c.Title, term))
                .Take(limit)
                .AsNoTracking()
                .Select(c => new
                {
                    c.Id,
                    c.Title,
                    TitleSimilarity = EF.Functions.TrigramsSimilarity(c.Title, term),
                })
                .ToListAsync(ct);

            var canvasScored = canvasRows.Select(row => new ScoredSearchResult(
                new SearchResultDto(
                    TypeCanvas,
                    row.Id.ToString(),
                    row.Title,
                    null,
                    $"/canvas?canvasId={row.Id}"),
                row.TitleSimilarity,
                TypeRankCanvas));

            // 4. 開問啦節點（標題＋內容）
            // 節點的 URL 格式為 /canvas?canvasId={CanvasId}&nodeId={NodeId}
            // 跨帳號隔離：Node 非 IUserOwned、無全域過濾，必須明確以「所屬 Canvas 屬於目前使用者」過濾，
            // 否則會撈到所有使用者的節點（跨帳號外洩）。此處以 Canvas.UserId 比對目前登入者。
            // 同筆記：不可在合併相關性分數前依標題相似度截斷（finding #W8-1）。
            var nodeRows = await db.Node
                .Where(n => n.ValidFlag &&
                    n.Canvas != null &&
                    n.Canvas.UserId == currentUser.UserId &&
                    n.Canvas.ValidFlag &&
                    (EF.Functions.ILike(n.Title, pattern, LikeEscapeChar) ||
                     EF.Functions.ILike(n.Content, pattern, LikeEscapeChar)))
                .AsNoTracking()
                .Select(n => new
                {
                    n.Id,
                    n.Title,
                    n.Content,
                    n.CanvasId,
                    TitleSimilarity = EF.Functions.TrigramsSimilarity(n.Title, term),
                    ContentSimilarity = EF.Functions.TrigramsSimilarity(n.Content, term),
                })
                .ToListAsync(ct);

            var nodeScored = nodeRows
                .Select(row => new ScoredSearchResult(
                    new SearchResultDto(
                        TypeNode,
                        row.Id.ToString(),
                        string.IsNullOrEmpty(row.Title) ? "（無標題）" : row.Title,
                        ExtractSnippet(row.Content, keywordLower, SnippetMaxLength),
                        $"/canvas?canvasId={row.CanvasId}&nodeId={row.Id}"),
                    CombineRelevance(row.TitleSimilarity, row.ContentSimilarity),
                    TypeRankNode))
                // 合併相關性分數算完之後才截斷。
                .OrderByDescending(scored => scored.Relevance)
                .Take(limit);

            // 5. 標籤（名稱）
            // Tag 為 IUserOwned，靠全域過濾限定本人；點按導向以此標籤篩選的筆記清單。
            var tagRows = await db.Tag
                .Where(t => t.ValidFlag &&
                    EF.Functions.ILike(t.Name, pattern, LikeEscapeChar))
                .OrderByDescending(t => EF.Functions.TrigramsSimilarity(t.Name, term))
                .Take(limit)
                .AsNoTracking()
                .Select(t => new
                {
                    t.Id,
                    t.Name,
                    NameSimilarity = EF.Functions.TrigramsSimilarity(t.Name, term),
                })
                .ToListAsync(ct);

            var tagScored = tagRows.Select(row => new ScoredSearchResult(
                new SearchResultDto(
                    TypeTag,
                    row.Id.ToString(),
                    row.Name,
                    null,
                    $"/notes?tagId={row.Id}"),
                row.NameSimilarity,
                TypeRankTag));

            // 6. 分類（名稱）
            // Category 為 IUserOwned；點按導向以此分類篩選的筆記清單。
            var categoryRows = await db.Category
                .Where(c => c.ValidFlag &&
                    EF.Functions.ILike(c.Name, pattern, LikeEscapeChar))
                .OrderByDescending(c => EF.Functions.TrigramsSimilarity(c.Name, term))
                .Take(limit)
                .AsNoTracking()
                .Select(c => new
                {
                    c.Id,
                    c.Name,
                    NameSimilarity = EF.Functions.TrigramsSimilarity(c.Name, term),
                })
                .ToListAsync(ct);

            var categoryScored = categoryRows.Select(row => new ScoredSearchResult(
                new SearchResultDto(
                    TypeCategory,
                    row.Id.ToString(),
                    row.Name,
                    null,
                    $"/notes?categoryId={row.Id}"),
                row.NameSimilarity,
                TypeRankCategory));

            // 7. 快速捕捉（Inbox 收件匣：原始內容）
            // CaptureItem 為 IUserOwned；沒有標題，故以內容前段作為顯示標題、關鍵字周邊作為片段。
            // 收件匣位於首頁儀表板，點按導向首頁。
            var captureRows = await db.CaptureItem
                .Where(c => c.ValidFlag &&
                    EF.Functions.ILike(c.RawContent, pattern, LikeEscapeChar))
                .OrderByDescending(c => EF.Functions.TrigramsSimilarity(c.RawContent, term))
                .Take(limit)
                .AsNoTracking()
                .Select(c => new
                {
                    c.Id,
                    c.RawContent,
                    ContentSimilarity = EF.Functions.TrigramsSimilarity(c.RawContent, term),
                })
                .ToListAsync(ct);

            var captureScored = captureRows.Select(row => new ScoredSearchResult(
                new SearchResultDto(
                    TypeCapture,
                    row.Id.ToString(),
                    BuildCaptureTitle(row.RawContent),
                    ExtractSnippet(row.RawContent, keywordLower, SnippetMaxLength),
                    "/"),
                // 快速捕捉只有內容一個文字欄位，相關性直接採內容相似度（不再打折）。
                row.ContentSimilarity,
                TypeRankCapture));

            // 8. 跨類型合併：依相關性分數由高到低排序；分數相同時以類型優先序（TypeRank）穩定收斂。
            var finalResults = noteScored
                .Concat(taskScored)
                .Concat(canvasScored)
                .Concat(nodeScored)
                .Concat(tagScored)
                .Concat(categoryScored)
                .Concat(captureScored)
                .OrderByDescending(scored => scored.Relevance)
                .ThenBy(scored => scored.TypeRank)
                .Take(limit)
                .Select(scored => scored.Result)
                .ToList();

            return Results.Ok(ApiResponse<List<SearchResultDto>>.Ok(finalResults));
        });
    }

    /// <summary>
    /// 結果類型標記字串常數（與前端 SearchResult.type 聯集一致）。
    /// </summary>
    private const string TypeNote = "note";
    private const string TypeTask = "task";
    private const string TypeCanvas = "canvas";
    private const string TypeNode = "node";
    private const string TypeTag = "tag";
    private const string TypeCategory = "category";
    private const string TypeCapture = "capture";

    /// <summary>
    /// 類型優先序：相關性分數相同時的穩定次序（數字越小越前面）。
    /// </summary>
    private const int TypeRankNote = 0;
    private const int TypeRankTask = 1;
    private const int TypeRankCanvas = 2;
    private const int TypeRankNode = 3;
    private const int TypeRankTag = 4;
    private const int TypeRankCategory = 5;
    private const int TypeRankCapture = 6;

    /// <summary>
    /// 內文命中的相關性權重（相對於標題／名稱命中）。
    /// 標題命中權重為 1.0；內文命中乘以此係數，讓「標題命中」排在「僅內文命中」之前。
    /// </summary>
    private const double ContentSimilarityWeight = 0.5;

    /// <summary>
    /// 內容片段（Snippet）的最大字元長度。
    /// </summary>
    private const int SnippetMaxLength = 100;

    /// <summary>
    /// 快速捕捉顯示標題的最大字元長度（快速捕捉本身沒有標題，取內容前段當標題）。
    /// </summary>
    private const int CaptureTitleMaxLength = 40;

    /// <summary>
    /// 合併「標題／名稱相似度」與「內文相似度」為單一相關性分數。
    /// 取兩者較大者，並對內文相似度套用 <see cref="ContentSimilarityWeight"/> 折扣，
    /// 使標題命中優先於僅內文命中。
    /// </summary>
    /// <param name="titleSimilarity">查詢字串與標題／名稱的 trigram 相似度。</param>
    /// <param name="contentSimilarity">查詢字串與內文的 trigram 相似度。</param>
    /// <returns>合併後的相關性分數（越大越相關）。</returns>
    private static double CombineRelevance(
        double titleSimilarity,
        double contentSimilarity) =>
        Math.Max(titleSimilarity, contentSimilarity * ContentSimilarityWeight);

    /// <summary>
    /// 為快速捕捉項目建立顯示標題：正規化空白後取內容前段；若內容為空則回退為固定文案。
    /// </summary>
    /// <param name="rawContent">快速捕捉的原始內容。</param>
    /// <returns>可讀的短標題。</returns>
    private static string BuildCaptureTitle(string rawContent)
    {
        if (string.IsNullOrWhiteSpace(rawContent))
            return "（空白捕捉）";

        // 將連續換行／空白壓成單一空白，避免標題出現大量斷行。
        var normalized = System.Text.RegularExpressions.Regex.Replace(
            rawContent,
            @"\s+",
            " ").Trim();

        if (normalized.Length <= CaptureTitleMaxLength)
            return normalized;

        return normalized.Substring(0, CaptureTitleMaxLength) + "…";
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

    /// <summary>
    /// 內部使用的「帶相關性分數」搜尋結果，供跨類型合併排序後再投影成對外 DTO。
    /// </summary>
    /// <param name="Result">對外的搜尋結果 DTO。</param>
    /// <param name="Relevance">相關性分數（trigram 相似度合併值，越大越相關）。</param>
    /// <param name="TypeRank">類型優先序（分數相同時的穩定次序）。</param>
    private sealed record ScoredSearchResult(
        SearchResultDto Result,
        double Relevance,
        int TypeRank);
}
