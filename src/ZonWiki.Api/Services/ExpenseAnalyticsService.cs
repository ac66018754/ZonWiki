using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Endpoints;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 記帳分析頁（其他功能群 Phase 2）的彙總服務：一次算出五大區塊所需資料
/// （本月總額＋與上月比、近 N 月趨勢、分類佔比、日彙總、商家 Top N）。
///
/// 設計要點：
/// - **多租戶＋軟刪除鎖**：每句彙總查詢皆 <c>IgnoreQueryFilters()</c> ＋ 明確 <c>UserId</c> ＋ <c>ValidFlag</c>
///   （與 Phase 1 <c>StatsHandler</c> 完全一致），不倚賴全域過濾器。
/// - **DB 端彙總**：以 SQL <c>GROUP BY</c>／<c>SUM</c> 在資料庫加總（金額 decimal），不拉原始列回記憶體。
/// - **月界一律 UTC 半開區間 <c>[from, to)</c>**（見 <see cref="ExpenseMonthRange"/>）。
/// - **與上月比獨立取樣**：上月總額用專屬區間 <c>[PrevStart, Start)</c> 單獨 SUM，與趨勢窗解耦，
///   故 N=1（趨勢窗只含選定月）時仍能正確算出與上月比。
/// - **空資料**：回空陣列／零，不丟例外、不回 500；趨勢仍回完整 N 筆（含補零）讓趨勢圖有完整軸。
/// </summary>
public sealed class ExpenseAnalyticsService
{
    private readonly ZonWikiDbContext _db;
    private readonly IConfiguration _configuration;

    // ── 設定鍵與 clamp 範圍（具名常數，避免魔術數字）─────────────────────────────
    /// <summary>月趨勢回溯月數 N（含選定月）的設定鍵。</summary>
    private const string TrendMonthsConfigKey = "Expense:AnalyticsTrendMonths";

    /// <summary>月趨勢回溯月數 N 的預設值。</summary>
    private const int DefaultTrendMonths = 6;

    /// <summary>月趨勢回溯月數 N 的下限。</summary>
    private const int MinTrendMonths = 1;

    /// <summary>月趨勢回溯月數 N 的上限。</summary>
    private const int MaxTrendMonths = 24;

    /// <summary>商家 Top N 的 N 的設定鍵。</summary>
    private const string MerchantTopNConfigKey = "Expense:AnalyticsMerchantTopN";

    /// <summary>商家 Top N 的 N 的預設值。</summary>
    private const int DefaultMerchantTopN = 10;

    /// <summary>商家 Top N 的 N 的下限。</summary>
    private const int MinMerchantTopN = 1;

    /// <summary>商家 Top N 的 N 的上限。</summary>
    private const int MaxMerchantTopN = 50;

    /// <summary>
    /// 建立記帳分析服務。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="configuration">設定來源（讀趨勢月數／商家 Top N）。</param>
    public ExpenseAnalyticsService(ZonWikiDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    /// <summary>
    /// 計算指定月份的分析彙總。
    /// </summary>
    /// <param name="userId">使用者識別碼（多租戶鎖）。</param>
    /// <param name="month">月份字串（YYYY-MM；空／null＝本月，UTC 月界）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>
    /// 月份格式合法時回 <c>(true, dto)</c>；格式錯誤時回 <c>(false, null)</c>（由端點轉 400）。
    /// </returns>
    public async Task<ExpenseAnalyticsResult> GetAnalyticsAsync(
        Guid userId,
        string? month,
        CancellationToken cancellationToken)
    {
        var trendMonths = ResolveTrendMonths();
        var merchantTopN = ResolveMerchantTopN();

        if (!ExpenseMonthRange.TryResolveAnalyticsRange(month, trendMonths, out var range))
        {
            return new ExpenseAnalyticsResult(false, null);
        }

        // 分類佔比（Q1）：選定月按 CategoryId 分組彙總；monthTotal／monthCount 由此推導（同一查詢、內部一致）。
        var categoryBreakdown = await BuildCategoryBreakdownAsync(userId, range, cancellationToken);
        var monthTotal = categoryBreakdown.Sum(item => item.Total);
        var monthCount = categoryBreakdown.Sum(item => item.Count);

        // 與上月比（Q5）：上月專屬區間單獨 SUM（與趨勢窗解耦，N=1 仍正確）。
        var prevMonthTotal = await SumAmountAsync(userId, range.PrevStartUtc, range.StartUtc, cancellationToken);
        var deltaPct = ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal, prevMonthTotal);

        // 近 N 月趨勢（Q2）：趨勢窗按年月分組彙總 → 記憶體補零成連續 N 筆升冪。
        var monthlyTrend = await BuildMonthlyTrendAsync(userId, range, trendMonths, cancellationToken);

        // 日彙總（Q3）：選定月按 UTC 年月日分組。
        var dailyTotals = await BuildDailyTotalsAsync(userId, range, cancellationToken);

        // 商家 Top N（Q4）：選定月按商家分組、排除 null／空白、降冪取前 N。
        var merchantTopList = await BuildMerchantTopNAsync(userId, range, merchantTopN, cancellationToken);

        var dto = new ExpenseAnalyticsDto(
            range.MonthLabel,
            monthTotal,
            monthCount,
            prevMonthTotal,
            deltaPct,
            monthlyTrend,
            categoryBreakdown,
            dailyTotals,
            merchantTopList);

        return new ExpenseAnalyticsResult(true, dto);
    }

    // ── 各區塊查詢 ───────────────────────────────────────────────────────────

    /// <summary>
    /// 分類佔比（Q1＋Q1b）：選定月按 <c>CategoryId</c> 分組彙總（含未分類 null 桶），
    /// 再以一句分類 metadata 查詢在記憶體補上 Name／Icon（避免對導覽欄分組的 EF 翻譯風險），按 total 降冪。
    /// </summary>
    private async Task<IReadOnlyList<CategoryBreakdownItemDto>> BuildCategoryBreakdownAsync(
        Guid userId,
        AnalyticsMonthRange range,
        CancellationToken cancellationToken)
    {
        // Q1：只按純量 CategoryId 分組（含 null 桶），必定可翻譯成 SQL GROUP BY。
        var groups = await InRange(userId, range.StartUtc, range.EndUtc)
            .GroupBy(e => e.CategoryId)
            .Select(g => new CategoryAggregateRow(
                g.Key,
                g.Sum(x => x.Amount),
                g.Count()))
            .ToListAsync(cancellationToken);

        if (groups.Count == 0)
        {
            return new List<CategoryBreakdownItemDto>();
        }

        // Q1b：撈本人分類 metadata（含軟刪列——IgnoreQueryFilters 不濾 ValidFlag，
        // 讓「已軟刪分類但仍有歷史消費」的名稱也能顯示），記憶體 join。
        var metadata = await _db.ExpenseCategory
            .IgnoreQueryFilters()
            .Where(c => c.UserId == userId)
            .Select(c => new { c.Id, c.Name, c.Icon })
            .ToListAsync(cancellationToken);
        var metadataById = metadata.ToDictionary(c => c.Id, c => (c.Name, c.Icon));

        return groups
            .Select(group =>
            {
                if (group.CategoryId is not Guid categoryId)
                {
                    // 未分類桶：Id／Name／Icon 皆 null。
                    return new CategoryBreakdownItemDto(null, null, null, group.Total, group.Count);
                }

                // 找不到 metadata（理論上不會，除非資料不一致）→ 名稱／圖示一起留 null，不丟例外。
                // 一次解構避免「name 走三元、icon 直讀 out-var 預設值」的不一致寫法（審查 LOW）。
                var (name, icon) = metadataById.TryGetValue(categoryId, out var meta)
                    ? (meta.Name, meta.Icon)
                    : ((string?)null, (string?)null);
                return new CategoryBreakdownItemDto(categoryId, name, icon, group.Total, group.Count);
            })
            .OrderByDescending(item => item.Total)
            .ThenByDescending(item => item.Count)
            .ThenBy(item => item.Name, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// 近 N 月趨勢（Q2）：趨勢窗 <c>[TrendStart, End)</c> 按 UTC 年月分組彙總，
    /// 再以 <see cref="ExpenseAnalyticsMath.BuildMonthlyTrend"/> 補零成連續 N 筆升冪。
    /// </summary>
    private async Task<IReadOnlyList<MonthlyTrendPointDto>> BuildMonthlyTrendAsync(
        Guid userId,
        AnalyticsMonthRange range,
        int trendMonths,
        CancellationToken cancellationToken)
    {
        var rows = await InRange(userId, range.TrendStartUtc, range.EndUtc)
            .GroupBy(e => new { e.OccurredDateTime.Year, e.OccurredDateTime.Month })
            .Select(g => new MonthAggregateRow(
                g.Key.Year,
                g.Key.Month,
                g.Sum(x => x.Amount),
                g.Count()))
            .ToListAsync(cancellationToken);

        var totalsByMonth = rows.ToDictionary(
            r => (r.Year, r.Month),
            r => (r.Total, r.Count));

        return ExpenseAnalyticsMath.BuildMonthlyTrend(totalsByMonth, range.TrendStartUtc, trendMonths);
    }

    /// <summary>
    /// 日彙總（Q3）：選定月按 UTC 年月日分組彙總，按日期升冪（只含有資料的日）。
    /// </summary>
    private async Task<IReadOnlyList<DailyTotalDto>> BuildDailyTotalsAsync(
        Guid userId,
        AnalyticsMonthRange range,
        CancellationToken cancellationToken)
    {
        var rows = await InRange(userId, range.StartUtc, range.EndUtc)
            .GroupBy(e => new { e.OccurredDateTime.Year, e.OccurredDateTime.Month, e.OccurredDateTime.Day })
            .Select(g => new DayAggregateRow(
                g.Key.Year,
                g.Key.Month,
                g.Key.Day,
                g.Sum(x => x.Amount),
                g.Count()))
            .ToListAsync(cancellationToken);

        return rows
            .OrderBy(r => r.Year).ThenBy(r => r.Month).ThenBy(r => r.Day)
            .Select(r => new DailyTotalDto(
                $"{r.Year:D4}-{r.Month:D2}-{r.Day:D2}",
                r.Total,
                r.Count))
            .ToList();
    }

    /// <summary>
    /// 商家 Top N（Q4）：選定月排除 null／空白商家後按商家分組彙總，
    /// 按 total 降冪（同額再按 count 降冪、再按商家名升冪），取前 N。
    /// </summary>
    private async Task<IReadOnlyList<MerchantTotalDto>> BuildMerchantTopNAsync(
        Guid userId,
        AnalyticsMonthRange range,
        int merchantTopN,
        CancellationToken cancellationToken)
    {
        // 注意：GroupBy→Select 投影到「具名型別」後再接 OrderBy／Take 會讓 EF Core 翻譯失敗；
        // 故中繼投影用「匿名型別」（可翻譯成 SQL GROUP BY＋ORDER BY＋LIMIT），材質化後再映射成 DTO。
        var rows = await InRange(userId, range.StartUtc, range.EndUtc)
            // 排除 null／純空白商家（EF 翻成 btrim，仍在 DB 端過濾）：手動記帳可能存入「   」，
            // 若只比 != "" 會漏放而在 Top N 冒出一根無名空白長條，與本方法宣稱契約不符（審查 LOW）。
            .Where(e => e.Merchant != null && e.Merchant!.Trim() != "")
            .GroupBy(e => e.Merchant!)
            .Select(g => new
            {
                Merchant = g.Key,
                Total = g.Sum(x => x.Amount),
                Count = g.Count(),
            })
            .OrderByDescending(r => r.Total)
            .ThenByDescending(r => r.Count)
            .ThenBy(r => r.Merchant)
            .Take(merchantTopN)
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new MerchantTotalDto(r.Merchant, r.Total, r.Count))
            .ToList();
    }

    /// <summary>
    /// 對 <c>[fromUtc, toUtc)</c> 區間的有效消費金額求和（空區間回 0；投影成可空 decimal 避免空集合例外）。
    /// </summary>
    private async Task<decimal> SumAmountAsync(
        Guid userId,
        DateTime fromUtc,
        DateTime toUtc,
        CancellationToken cancellationToken)
        => await InRange(userId, fromUtc, toUtc)
            .SumAsync(e => (decimal?)e.Amount, cancellationToken) ?? 0m;

    /// <summary>
    /// 共同查詢前綴：某使用者、有效（未軟刪）、且 <c>OccurredDateTime</c> 落在 UTC 半開區間 <c>[fromUtc, toUtc)</c>。
    /// <c>IgnoreQueryFilters()</c> ＋ 明確 <c>UserId</c> ＋ <c>ValidFlag</c>：多租戶＋軟刪除鎖，不倚賴全域過濾。
    /// </summary>
    private IQueryable<Expense> InRange(Guid userId, DateTime fromUtc, DateTime toUtc)
        => _db.Expense
            .IgnoreQueryFilters()
            .Where(e => e.UserId == userId
                && e.ValidFlag
                && e.OccurredDateTime >= fromUtc
                && e.OccurredDateTime < toUtc);

    // ── 設定解析 ─────────────────────────────────────────────────────────────

    /// <summary>解析月趨勢月數 N（設定＋clamp 到 <see cref="MinTrendMonths"/>..<see cref="MaxTrendMonths"/>）。</summary>
    private int ResolveTrendMonths()
    {
        var configured = _configuration.GetValue<int?>(TrendMonthsConfigKey) ?? DefaultTrendMonths;
        return Math.Clamp(configured, MinTrendMonths, MaxTrendMonths);
    }

    /// <summary>解析商家 Top N 的 N（設定＋clamp 到 <see cref="MinMerchantTopN"/>..<see cref="MaxMerchantTopN"/>）。</summary>
    private int ResolveMerchantTopN()
    {
        var configured = _configuration.GetValue<int?>(MerchantTopNConfigKey) ?? DefaultMerchantTopN;
        return Math.Clamp(configured, MinMerchantTopN, MaxMerchantTopN);
    }

    // ── 查詢中繼投影列（供 EF 投影後在記憶體組裝 DTO）─────────────────────────────

    /// <summary>分類分組的中繼投影列（Q1）。</summary>
    private sealed record CategoryAggregateRow(Guid? CategoryId, decimal Total, int Count);

    /// <summary>年月分組的中繼投影列（Q2）。</summary>
    private sealed record MonthAggregateRow(int Year, int Month, decimal Total, int Count);

    /// <summary>年月日分組的中繼投影列（Q3）。</summary>
    private sealed record DayAggregateRow(int Year, int Month, int Day, decimal Total, int Count);
}

/// <summary>
/// 分析彙總的結果封裝：月份格式是否合法，以及（合法時的）彙總 DTO。
/// </summary>
/// <param name="MonthValid">月份字串是否合法（false → 端點回 400）。</param>
/// <param name="Analytics">彙總結果（<paramref name="MonthValid"/> 為 true 時有值）。</param>
public sealed record ExpenseAnalyticsResult(
    bool MonthValid,
    ExpenseAnalyticsDto? Analytics);
