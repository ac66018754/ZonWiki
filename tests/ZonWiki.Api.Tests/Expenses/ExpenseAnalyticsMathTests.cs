using FluentAssertions;
using Xunit;
using ZonWiki.Api.Endpoints;
using ZonWiki.Api.Services;

namespace ZonWiki.Api.Tests.Expenses;

/// <summary>
/// 記帳分析頁純函式（不需 DB）的單元測試：與上月比 deltaPct、月趨勢補零列舉、月界解析。
/// 鎖定 plan-analytics-backend.md §3.1 的測試向量與 §0 契約語意。
/// </summary>
public sealed class ExpenseAnalyticsMathTests
{
    // ── ComputeDeltaPct ────────────────────────────────────────────────────

    [Fact]
    public void DeltaPct_上月為零_回null()
    {
        // 上月為 0 → 避免除以零，回 null（前端顯示「—／新增」）。
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 500m, prevMonthTotal: 0m)
            .Should().BeNull();
    }

    [Fact]
    public void DeltaPct_成長_回正且四捨五入1位()
    {
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 150m, prevMonthTotal: 100m)
            .Should().Be(50.0m);
    }

    [Fact]
    public void DeltaPct_衰退_回負()
    {
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 50m, prevMonthTotal: 200m)
            .Should().Be(-75.0m);
    }

    [Fact]
    public void DeltaPct_持平_回零()
    {
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 100m, prevMonthTotal: 100m)
            .Should().Be(0.0m);
    }

    [Fact]
    public void DeltaPct_非整除_四捨五入到1位()
    {
        // (4-3)/3*100 = 33.333... → 33.3。
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 4m, prevMonthTotal: 3m)
            .Should().Be(33.3m);
    }

    [Fact]
    public void DeltaPct_半邊界_正_遠離零進位()
    {
        // (2669-2000)/2000*100 = 33.45 → AwayFromZero → 33.5（banker's 會給 33.4，故此向量鎖死進位方向）。
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 2669m, prevMonthTotal: 2000m)
            .Should().Be(33.5m);
    }

    [Fact]
    public void DeltaPct_半邊界_負_遠離零進位()
    {
        // (1331-2000)/2000*100 = -33.45 → AwayFromZero → -33.5。
        ExpenseAnalyticsMath.ComputeDeltaPct(monthTotal: 1331m, prevMonthTotal: 2000m)
            .Should().Be(-33.5m);
    }

    // ── BuildMonthlyTrend ──────────────────────────────────────────────────

    [Fact]
    public void FillTrend_稀疏補零且升冪()
    {
        // 選定月 2026-07、N=6；map 只含 {2026-05:(50,2), 2026-07:(70,3)}。
        ExpenseMonthRange.TryResolveAnalyticsRange("2026-07", trendMonths: 6, out var range).Should().BeTrue();
        var map = new Dictionary<(int Year, int Month), (decimal Total, int Count)>
        {
            [(2026, 5)] = (50m, 2),
            [(2026, 7)] = (70m, 3),
        };

        var trend = ExpenseAnalyticsMath.BuildMonthlyTrend(map, range.TrendStartUtc, trendMonths: 6);

        trend.Select(p => p.Month).Should().ContainInOrder(
            "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07");
        trend.Select(p => p.Total).Should().ContainInOrder(0m, 0m, 0m, 50m, 0m, 70m);
        trend.Select(p => p.Count).Should().ContainInOrder(0, 0, 0, 2, 0, 3);
        // 末筆＝選定月。
        trend[^1].Month.Should().Be("2026-07");
    }

    [Fact]
    public void FillTrend_跨年界()
    {
        // 選定月 2026-01、N=3 → 趨勢窗回溯到 2025-11。
        ExpenseMonthRange.TryResolveAnalyticsRange("2026-01", trendMonths: 3, out var range).Should().BeTrue();
        var map = new Dictionary<(int Year, int Month), (decimal Total, int Count)>();

        var trend = ExpenseAnalyticsMath.BuildMonthlyTrend(map, range.TrendStartUtc, trendMonths: 3);

        trend.Select(p => p.Month).Should().ContainInOrder("2025-11", "2025-12", "2026-01");
        trend.Should().OnlyContain(p => p.Total == 0m && p.Count == 0);
    }

    // ── ExpenseMonthRange ──────────────────────────────────────────────────

    [Fact]
    public void ResolveAnalyticsRange_有效_三段區間正確()
    {
        ExpenseMonthRange.TryResolveAnalyticsRange("2026-07", trendMonths: 6, out var range).Should().BeTrue();

        range.MonthLabel.Should().Be("2026-07");
        range.StartUtc.Should().Be(new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));
        range.EndUtc.Should().Be(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));
        range.PrevStartUtc.Should().Be(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc));
        range.TrendStartUtc.Should().Be(new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc));
        // 全部應為 UTC Kind（Npgsql timestamptz 參數要求）。
        range.StartUtc.Kind.Should().Be(DateTimeKind.Utc);
        range.PrevStartUtc.Kind.Should().Be(DateTimeKind.Utc);
        range.TrendStartUtc.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public void ResolveAnalyticsRange_N為1_上月區間仍獨立涵蓋上月()
    {
        // 審查修正（N=1 邊界）：趨勢窗只含選定月，但上月區間 [PrevStart, Start) 仍必定涵蓋上月。
        ExpenseMonthRange.TryResolveAnalyticsRange("2026-07", trendMonths: 1, out var range).Should().BeTrue();

        range.TrendStartUtc.Should().Be(range.StartUtc, "N=1 時趨勢窗左界＝選定月月首");
        range.PrevStartUtc.Should().Be(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc));
        range.EndUtc.Should().Be(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void ResolveMonthRange_空字串_取本月UTC()
    {
        ExpenseMonthRange.TryResolveMonthRange(null, out var label, out var start, out var end).Should().BeTrue();

        var now = DateTime.UtcNow;
        label.Should().Be(ExpenseMonthRange.FormatMonthLabel(now.Year, now.Month));
        start.Should().Be(new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc));
        end.Should().Be(start.AddMonths(1));
    }

    [Fact]
    public void ResolveMonthRange_單位數月不補零仍接受_正規化為兩位()
    {
        // 照現行 TryParseMonth 實作核對（不臆測）：int.TryParse("7") 合法 → "2026-7" 被接受並正規化為 "2026-07"。
        ExpenseMonthRange.TryResolveMonthRange("2026-7", out var label, out var start, out _).Should().BeTrue();

        label.Should().Be("2026-07");
        start.Should().Be(new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc));
    }

    [Theory]
    [InlineData("2026/07")]
    [InlineData("2026-13")]
    [InlineData("2026-00")]
    [InlineData("abc")]
    [InlineData("2026")]
    [InlineData("2026-")]
    [InlineData("2026-07-01")]
    public void ResolveAnalyticsRange_格式錯誤_回false(string invalidMonth)
    {
        ExpenseMonthRange.TryResolveAnalyticsRange(invalidMonth, trendMonths: 6, out _).Should().BeFalse();
    }
}
