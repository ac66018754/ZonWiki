using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Services;

/// <summary>
/// 記帳分析頁的純函式（不碰 DB）：與上月比百分比、月趨勢補零列舉。
/// 抽成 static 供單元測試直打（不需 Testcontainers），把「數學」與「查詢」分離。
/// </summary>
public static class ExpenseAnalyticsMath
{
    /// <summary>百分比基數（總額比值 → 百分比）。</summary>
    private const decimal PercentScale = 100m;

    /// <summary>與上月比四捨五入的小數位數。</summary>
    private const int DeltaPctDecimals = 1;

    /// <summary>
    /// 計算「與上月比」百分比變化：<c>(monthTotal - prevMonthTotal) / prevMonthTotal * 100</c>，
    /// 四捨五入 1 位小數（<see cref="MidpointRounding.AwayFromZero"/>，.5 邊界一律遠離零進位，避免非決定性）。
    /// </summary>
    /// <param name="monthTotal">本月總額。</param>
    /// <param name="prevMonthTotal">上月總額。</param>
    /// <returns>
    /// 百分比變化（例：本月 150／上月 100 → <c>50.0</c>）；
    /// 當 <paramref name="prevMonthTotal"/> 為 0 時回 <c>null</c>（避免除以零；前端顯示「—／新增」）。
    /// </returns>
    public static decimal? ComputeDeltaPct(decimal monthTotal, decimal prevMonthTotal)
    {
        if (prevMonthTotal == 0m)
        {
            return null;
        }

        var delta = (monthTotal - prevMonthTotal) / prevMonthTotal * PercentScale;
        return Math.Round(delta, DeltaPctDecimals, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// 依趨勢窗把「稀疏的年月→(總額,筆數) map」補零成連續 N 筆、時序升冪的趨勢資料點。
    /// 缺月補 <c>total=0、count=0</c>；末筆＝選定月。
    /// </summary>
    /// <param name="totalsByMonth">稀疏彙總（鍵＝(西元年, 月份)；值＝(總額, 筆數)）。</param>
    /// <param name="trendStartUtc">趨勢窗左界（UTC 月首；由 <c>ExpenseMonthRange</c> 算出）。</param>
    /// <param name="trendMonths">趨勢月數 N（含選定月，共 N 筆）。</param>
    /// <returns>連續 N 筆、升冪的月趨勢資料點。</returns>
    public static IReadOnlyList<MonthlyTrendPointDto> BuildMonthlyTrend(
        IReadOnlyDictionary<(int Year, int Month), (decimal Total, int Count)> totalsByMonth,
        DateTime trendStartUtc,
        int trendMonths)
    {
        var points = new List<MonthlyTrendPointDto>(Math.Max(trendMonths, 0));

        // 以趨勢窗左界為起點，逐月 +1，共 N 筆——升冪、含補零。
        for (var offset = 0; offset < trendMonths; offset++)
        {
            var cursor = trendStartUtc.AddMonths(offset);
            var key = (cursor.Year, cursor.Month);
            var (total, count) = totalsByMonth.TryGetValue(key, out var found)
                ? found
                : (0m, 0);

            points.Add(new MonthlyTrendPointDto(
                ExpenseMonthRangeLabel(cursor.Year, cursor.Month),
                total,
                count));
        }

        return points;
    }

    /// <summary>把年月格式化為 YYYY-MM（與 <c>ExpenseMonthRange.FormatMonthLabel</c> 一致）。</summary>
    private static string ExpenseMonthRangeLabel(int year, int monthNumber)
        => Endpoints.ExpenseMonthRange.FormatMonthLabel(year, monthNumber);
}
