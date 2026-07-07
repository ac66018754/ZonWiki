using System.Globalization;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 記帳月界共用工具（UTC 月界 <c>[start, end)</c> 半開區間）。
///
/// 由 Phase 1 的 <c>ExpenseEndpoints.StatsHandler</c> 與 Phase 2 的
/// <c>ExpenseAnalyticsService</c> 共用，避免月界數學重複實作（DRY）。
/// 沿用 Phase 1 慣例（見 docs/DECISIONS.md「金額 decimal、時間 UTC、月界 UTC」）：
/// 相對時間由 LLM 依裝置時區換算後存 UTC，這裡一律以 UTC 年月切界。
/// </summary>
public static class ExpenseMonthRange
{
    /// <summary>
    /// 解析 <paramref name="month"/>（YYYY-MM；空／null＝本月），輸出 UTC 月界 <c>[start, end)</c> 與回顯標籤。
    /// 行為與 Phase 1 原 <c>StatsHandler</c> 私有實作一致（既有 <c>GetStats_*</c> 測試為回歸鎖）。
    /// </summary>
    /// <param name="month">月份字串（YYYY-MM；空／null＝以 UtcNow 的年月為本月）。</param>
    /// <param name="monthLabel">回顯標籤（正規化為 YYYY-MM）；解析失敗為空字串。</param>
    /// <param name="startUtc">選定月月首（UTC，含）。</param>
    /// <param name="endUtc">次月月首（UTC，不含）。</param>
    /// <returns>解析成功回 true；格式錯誤回 false。</returns>
    public static bool TryResolveMonthRange(
        string? month,
        out string monthLabel,
        out DateTime startUtc,
        out DateTime endUtc)
    {
        if (!TryResolveYearMonth(month, out var year, out var monthNumber))
        {
            monthLabel = string.Empty;
            startUtc = default;
            endUtc = default;
            return false;
        }

        startUtc = new DateTime(year, monthNumber, 1, 0, 0, 0, DateTimeKind.Utc);
        endUtc = startUtc.AddMonths(1);
        monthLabel = FormatMonthLabel(year, monthNumber);
        return true;
    }

    /// <summary>
    /// 解析 <paramref name="month"/> 並輸出分析頁所需的三段 UTC 區間：
    /// 選定月 <c>[Start, End)</c>、上月 <c>[PrevStart, Start)</c>、趨勢窗 <c>[TrendStart, End)</c>。
    ///
    /// 上月區間**獨立於趨勢窗**（不由趨勢窗聚合推導），故無論 <paramref name="trendMonths"/> 為何（含 N=1），
    /// 「與上月比」都能正確取得上月總額（審查修正：N=1 邊界）。
    /// </summary>
    /// <param name="month">月份字串（YYYY-MM；空／null＝本月）。</param>
    /// <param name="trendMonths">趨勢回溯月數 N（含選定月，共 N 個月；呼叫端負責 clamp 到合法範圍）。</param>
    /// <param name="range">解析成功時輸出的三段區間與標籤。</param>
    /// <returns>解析成功回 true；格式錯誤回 false。</returns>
    public static bool TryResolveAnalyticsRange(
        string? month,
        int trendMonths,
        out AnalyticsMonthRange range)
    {
        if (!TryResolveYearMonth(month, out var year, out var monthNumber))
        {
            range = default!;
            return false;
        }

        var startUtc = new DateTime(year, monthNumber, 1, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = startUtc.AddMonths(1);
        var prevStartUtc = startUtc.AddMonths(-1);
        // 趨勢窗左界：往前回溯 (N-1) 個月，使窗含選定月共 N 個月。
        var trendStartUtc = startUtc.AddMonths(-(trendMonths - 1));

        range = new AnalyticsMonthRange(
            FormatMonthLabel(year, monthNumber),
            startUtc,
            endUtc,
            prevStartUtc,
            trendStartUtc);
        return true;
    }

    /// <summary>
    /// 把年月正規化成 YYYY-MM 標籤。
    /// </summary>
    /// <param name="year">西元年。</param>
    /// <param name="monthNumber">月份（1..12）。</param>
    /// <returns>YYYY-MM 字串。</returns>
    public static string FormatMonthLabel(int year, int monthNumber)
        => $"{year:D4}-{monthNumber:D2}";

    /// <summary>
    /// 解析 <paramref name="month"/> 成年月（空／null＝本月 UtcNow）；格式錯誤回 false。
    /// </summary>
    private static bool TryResolveYearMonth(string? month, out int year, out int monthNumber)
    {
        if (string.IsNullOrWhiteSpace(month))
        {
            var now = DateTime.UtcNow;
            year = now.Year;
            monthNumber = now.Month;
            return true;
        }

        return TryParseMonth(month, out year, out monthNumber);
    }

    /// <summary>
    /// 解析 "YYYY-MM" 字串（嚴格：恰兩段、純數字、月份 1..12、年份 1..9999）。
    /// 行為與 Phase 1 原 <c>TryParseMonth</c> 一致。
    /// </summary>
    /// <param name="month">月份字串。</param>
    /// <param name="year">解析出的西元年。</param>
    /// <param name="monthNumber">解析出的月份（1..12）。</param>
    /// <returns>格式合法回 true；否則 false。</returns>
    private static bool TryParseMonth(string month, out int year, out int monthNumber)
    {
        year = 0;
        monthNumber = 0;
        var parts = month.Split('-');
        if (parts.Length != 2)
        {
            return false;
        }

        if (!int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out year)
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out monthNumber))
        {
            return false;
        }

        return year is >= 1 and <= 9999 && monthNumber is >= 1 and <= 12;
    }
}

/// <summary>
/// 分析頁所需的三段 UTC 月界區間（皆為半開 <c>[from, to)</c>）與回顯標籤。
/// </summary>
/// <param name="MonthLabel">選定月回顯標籤（YYYY-MM）。</param>
/// <param name="StartUtc">選定月月首（UTC，含）。</param>
/// <param name="EndUtc">次月月首（UTC，不含）。</param>
/// <param name="PrevStartUtc">上月月首（UTC，含）；上月區間為 <c>[PrevStartUtc, StartUtc)</c>。</param>
/// <param name="TrendStartUtc">趨勢窗左界（UTC，含）；趨勢窗為 <c>[TrendStartUtc, EndUtc)</c>。</param>
public sealed record AnalyticsMonthRange(
    string MonthLabel,
    DateTime StartUtc,
    DateTime EndUtc,
    DateTime PrevStartUtc,
    DateTime TrendStartUtc);
