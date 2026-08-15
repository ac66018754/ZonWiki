using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Tests.Expenses;

/// <summary>
/// 記帳分析回應 DTO 的「序列化契約鎖」：以 <see cref="JsonSerializerDefaults.Web"/>（camelCase，等同端點行為）
/// 序列化後斷言每一個 JSON 欄名，杜絕與前端工作包（WP-B）靜默分歧（審查 HIGH：前後端契約欄名不一致）。
///
/// 權威欄名（前端 normalizeAnalytics 應以此為準）：
/// month／monthTotal／monthCount／prevMonthTotal／deltaPct／monthlyTrend／categoryBreakdown／dailyTotals／merchantTopN，
/// 子物件：monthlyTrend[].{month,total,count}、categoryBreakdown[].{categoryId,name,icon,total,count}、
/// dailyTotals[].{date,total,count}、merchantTopN[].{merchant,total,count}。
/// </summary>
public sealed class ExpenseAnalyticsContractSerializationTests
{
    /// <summary>端點序列化選項（與 ASP.NET Core Minimal API 一致：Web 預設＝camelCase）。</summary>
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    private static ExpenseAnalyticsDto SampleDto() => new(
        Month: "2026-07",
        MonthTotal: 300m,
        MonthCount: 2,
        PrevMonthTotal: 200m,
        DeltaPct: 50.0m,
        MonthlyTrend: new[] { new MonthlyTrendPointDto("2026-07", 300m, 2) },
        CategoryBreakdown: new[] { new CategoryBreakdownItemDto(Guid.NewGuid(), "餐飲", "🍽️", 300m, 2) },
        DailyTotals: new[] { new DailyTotalDto("2026-07-01", 300m, 2) },
        MerchantTopN: new[] { new MerchantTotalDto("統一超商", 300m, 2) });

    [Fact]
    public void 頂層欄名_為契約指定的camelCase()
    {
        var node = JsonSerializer.SerializeToNode(SampleDto(), WebOptions)!.AsObject();

        node.Should().ContainKeys(
            "month", "monthTotal", "monthCount", "prevMonthTotal", "deltaPct",
            "monthlyTrend", "categoryBreakdown", "dailyTotals", "merchantTopN");

        node["month"]!.GetValue<string>().Should().Be("2026-07");
        node["monthTotal"]!.GetValue<decimal>().Should().Be(300m);
        node["monthCount"]!.GetValue<int>().Should().Be(2);
        node["prevMonthTotal"]!.GetValue<decimal>().Should().Be(200m);
        node["deltaPct"]!.GetValue<decimal>().Should().Be(50.0m);
    }

    [Fact]
    public void deltaPct_為null時_序列化為JSON_null()
    {
        var dto = SampleDto() with { DeltaPct = null };

        var node = JsonSerializer.SerializeToNode(dto, WebOptions)!.AsObject();

        node.Should().ContainKey("deltaPct");
        node["deltaPct"].Should().BeNull("prevMonthTotal 為 0 時 deltaPct 應為 JSON null");
    }

    [Fact]
    public void 月趨勢點_欄名為month_total_count()
    {
        var node = JsonSerializer.SerializeToNode(SampleDto(), WebOptions)!.AsObject();
        var point = node["monthlyTrend"]!.AsArray()[0]!.AsObject();

        point.Should().ContainKeys("month", "total", "count");
        point["month"]!.GetValue<string>().Should().Be("2026-07");
        point["total"]!.GetValue<decimal>().Should().Be(300m);
        point["count"]!.GetValue<int>().Should().Be(2);
    }

    [Fact]
    public void 分類佔比項_欄名為categoryId_name_icon_total_count()
    {
        var node = JsonSerializer.SerializeToNode(SampleDto(), WebOptions)!.AsObject();
        var item = node["categoryBreakdown"]!.AsArray()[0]!.AsObject();

        item.Should().ContainKeys("categoryId", "name", "icon", "total", "count");
        item["name"]!.GetValue<string>().Should().Be("餐飲");
        item["icon"]!.GetValue<string>().Should().Be("🍽️");
    }

    [Fact]
    public void 未分類桶_categoryId與name與icon皆序列化為null()
    {
        var dto = SampleDto() with
        {
            CategoryBreakdown = new[] { new CategoryBreakdownItemDto(null, null, null, 120m, 1) },
        };

        var node = JsonSerializer.SerializeToNode(dto, WebOptions)!.AsObject();
        var item = node["categoryBreakdown"]!.AsArray()[0]!.AsObject();

        item.Should().ContainKeys("categoryId", "name", "icon");
        item["categoryId"].Should().BeNull();
        item["name"].Should().BeNull();
        item["icon"].Should().BeNull();
        item["total"]!.GetValue<decimal>().Should().Be(120m);
    }

    [Fact]
    public void 日彙總點_欄名為date_total_count()
    {
        var node = JsonSerializer.SerializeToNode(SampleDto(), WebOptions)!.AsObject();
        var item = node["dailyTotals"]!.AsArray()[0]!.AsObject();

        item.Should().ContainKeys("date", "total", "count");
        item["date"]!.GetValue<string>().Should().Be("2026-07-01");
    }

    [Fact]
    public void 商家項_欄名為merchant_total_count()
    {
        var node = JsonSerializer.SerializeToNode(SampleDto(), WebOptions)!.AsObject();
        var item = node["merchantTopN"]!.AsArray()[0]!.AsObject();

        item.Should().ContainKeys("merchant", "total", "count");
        item["merchant"]!.GetValue<string>().Should().Be("統一超商");
    }
}
