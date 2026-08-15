using System.Net;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 記帳分析頁彙總端點（GET /api/expenses/analytics）的「真 HTTP ＋ 真 Postgres」整合測試：
/// 空月、分類佔比降冪、與上月比、近 N 月趨勢補零、UTC 日界、商家 Top N 截斷、
/// 未分類桶、空商家、多租戶隔離、軟刪除排除、指定月、400／401，以及 N=1 邊界。
///
/// 跨月／邊界資料以 <see cref="IntegrationTestHelpers.CreateDbScope"/> 直接種 <see cref="Expense"/>
/// （可精準給 UTC 時間、商家、分類、軟刪列）；驗證走真實 PAT Bearer。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseAnalyticsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public ExpenseAnalyticsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(Guid UserId, HttpClient Client)> NewUserClientAsync()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"analytics-{Guid.NewGuid():N}@example.com");
        return (userId, _factory.CreateClientWithToken(token));
    }

    /// <summary>直接種一筆消費（UTC 時間、可指定商家／分類／軟刪）。</summary>
    private async Task SeedExpenseAsync(
        Guid userId,
        DateTime occurredUtc,
        decimal amount,
        string? merchant = null,
        Guid? categoryId = null,
        bool validFlag = true)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.Expense.Add(new Expense
            {
                UserId = userId,
                OccurredDateTime = occurredUtc,
                Amount = amount,
                Currency = "TWD",
                CategoryId = categoryId,
                Merchant = merchant,
                RawText = merchant ?? $"種子 {amount}",
                Source = "manual",
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = validFlag,
                DeletedDateTime = validFlag ? null : DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }

    /// <summary>取使用者的分類名稱→Id 對照（GET categories 會惰性種子 8 預設）。</summary>
    private static async Task<Dictionary<string, Guid>> GetCategoryIdsAsync(HttpClient client)
    {
        var json = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        return json["data"]!.AsArray().ToDictionary(
            n => n!["name"]!.GetValue<string>(),
            n => Guid.Parse(n!["id"]!.GetValue<string>()));
    }

    /// <summary>打分析端點並回傳 data 節點（斷言 200）。</summary>
    private static async Task<JsonNode> GetAnalyticsDataAsync(HttpClient client, string month)
    {
        var response = await client.GetAsync($"/api/expenses/analytics?month={month}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        return json["data"]!;
    }

    private static DateTime Utc(int year, int month, int day, int hour = 12, int minute = 0)
        => new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    // ── I1 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I1_空月_回零與空陣列不報錯()
    {
        var (_, client) = await NewUserClientAsync();

        var data = await GetAnalyticsDataAsync(client, "2099-01");

        data["month"]!.GetValue<string>().Should().Be("2099-01");
        data["monthTotal"]!.GetValue<decimal>().Should().Be(0m);
        data["monthCount"]!.GetValue<int>().Should().Be(0);
        data["prevMonthTotal"]!.GetValue<decimal>().Should().Be(0m);
        data["deltaPct"].Should().BeNull("上月為 0 → deltaPct 為 null");
        data["categoryBreakdown"]!.AsArray().Should().BeEmpty();
        data["dailyTotals"]!.AsArray().Should().BeEmpty();
        data["merchantTopN"]!.AsArray().Should().BeEmpty();

        var trend = data["monthlyTrend"]!.AsArray();
        trend.Should().HaveCount(6, "空月趨勢仍回 N=6 筆補零，讓趨勢圖有完整軸");
        trend.Should().OnlyContain(n => n!["total"]!.GetValue<decimal>() == 0m);
        trend[^1]!["month"]!.GetValue<string>().Should().Be("2099-01");
    }

    // ── I2 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I2_本月多分類_分類佔比正確且降冪()
    {
        var (userId, client) = await NewUserClientAsync();
        var cats = await GetCategoryIdsAsync(client);

        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 100m, "餐廳A", cats["餐飲"]);
        await SeedExpenseAsync(userId, Utc(2026, 5, 12), 150m, "餐廳B", cats["餐飲"]);
        await SeedExpenseAsync(userId, Utc(2026, 5, 14), 80m, "捷運", cats["交通"]);
        await SeedExpenseAsync(userId, Utc(2026, 5, 16), 60m, "書店", cats["購物"]);

        var data = await GetAnalyticsDataAsync(client, "2026-05");

        data["monthTotal"]!.GetValue<decimal>().Should().Be(390m);
        data["monthCount"]!.GetValue<int>().Should().Be(4);

        var breakdown = data["categoryBreakdown"]!.AsArray();
        breakdown.Should().HaveCount(3);
        // 按 total 降冪：餐飲(250) → 交通(80) → 購物(60)。
        breakdown[0]!["name"]!.GetValue<string>().Should().Be("餐飲");
        breakdown[0]!["total"]!.GetValue<decimal>().Should().Be(250m);
        breakdown[0]!["count"]!.GetValue<int>().Should().Be(2);
        breakdown[0]!["icon"]!.GetValue<string>().Should().Be("🍽️");
        breakdown[1]!["name"]!.GetValue<string>().Should().Be("交通");
        breakdown[1]!["total"]!.GetValue<decimal>().Should().Be(80m);
        breakdown[2]!["name"]!.GetValue<string>().Should().Be("購物");
        breakdown[2]!["total"]!.GetValue<decimal>().Should().Be(60m);
    }

    // ── I3 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I3_與上月比_deltaPct正確()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 4, 10), 200m); // 上月
        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 300m); // 本月

        var data = await GetAnalyticsDataAsync(client, "2026-05");

        data["prevMonthTotal"]!.GetValue<decimal>().Should().Be(200m);
        data["monthTotal"]!.GetValue<decimal>().Should().Be(300m);
        data["deltaPct"]!.GetValue<decimal>().Should().Be(50.0m);
    }

    // ── I4 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I4_上月為零_deltaPct為null()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 300m);

        var data = await GetAnalyticsDataAsync(client, "2026-05");

        data["prevMonthTotal"]!.GetValue<decimal>().Should().Be(0m);
        data["deltaPct"].Should().BeNull();
    }

    // ── I5 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I5_近N月趨勢_補零且時序_末筆等於本月()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 1, 10), 30m);
        await SeedExpenseAsync(userId, Utc(2026, 3, 10), 40m);
        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 70m);

        var data = await GetAnalyticsDataAsync(client, "2026-05");

        var trend = data["monthlyTrend"]!.AsArray();
        // 選定月 2026-05、N=6 → 趨勢窗 2025-12..2026-05。
        trend.Select(n => n!["month"]!.GetValue<string>()).Should().ContainInOrder(
            "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05");
        trend.Select(n => n!["total"]!.GetValue<decimal>()).Should().ContainInOrder(
            0m, 30m, 0m, 40m, 0m, 70m);

        // 末筆＝選定月，其 total == monthTotal。
        var last = trend[^1]!;
        last["month"]!.GetValue<string>().Should().Be("2026-05");
        last["total"]!.GetValue<decimal>().Should().Be(data["monthTotal"]!.GetValue<decimal>());
    }

    // ── I6 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I6_日彙總_UTC日界正確()
    {
        var (userId, client) = await NewUserClientAsync();

        // 同屬 7/1 與 7/2 的 UTC 日界；不因本地時區位移到別日。
        await SeedExpenseAsync(userId, new DateTime(2026, 7, 1, 23, 30, 0, DateTimeKind.Utc), 100m);
        await SeedExpenseAsync(userId, new DateTime(2026, 7, 2, 0, 30, 0, DateTimeKind.Utc), 200m);

        var data = await GetAnalyticsDataAsync(client, "2026-07");

        var daily = data["dailyTotals"]!.AsArray();
        daily.Should().HaveCount(2);
        daily[0]!["date"]!.GetValue<string>().Should().Be("2026-07-01");
        daily[0]!["total"]!.GetValue<decimal>().Should().Be(100m);
        daily[1]!["date"]!.GetValue<string>().Should().Be("2026-07-02");
        daily[1]!["total"]!.GetValue<decimal>().Should().Be(200m);
    }

    // ── I7 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I7_商家TopN_降冪與截斷()
    {
        var (userId, client) = await NewUserClientAsync();

        // 12 個不同商家，金額遞增（商家12 最高）。
        for (var i = 1; i <= 12; i++)
        {
            await SeedExpenseAsync(userId, Utc(2026, 6, i), i * 10m, $"商家{i:D2}");
        }

        var data = await GetAnalyticsDataAsync(client, "2026-06");

        var merchants = data["merchantTopN"]!.AsArray();
        merchants.Should().HaveCount(10, "預設 Top N=10");
        merchants[0]!["merchant"]!.GetValue<string>().Should().Be("商家12");
        merchants[0]!["total"]!.GetValue<decimal>().Should().Be(120m);
        merchants[0]!["count"]!.GetValue<int>().Should().Be(1);

        var names = merchants.Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        names.Should().NotContain("商家01", "第 12 名（最低）不在前 10");
        names.Should().NotContain("商家02", "第 11 名不在前 10");
    }

    // ── I8 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I8_商家為空_不進TopN但計入總額與分類()
    {
        var (userId, client) = await NewUserClientAsync();
        var cats = await GetCategoryIdsAsync(client);

        await SeedExpenseAsync(userId, Utc(2026, 6, 10), 90m, merchant: null, categoryId: cats["餐飲"]);

        var data = await GetAnalyticsDataAsync(client, "2026-06");

        data["merchantTopN"]!.AsArray().Should().BeEmpty("商家為 null 不進 Top N");
        data["monthTotal"]!.GetValue<decimal>().Should().Be(90m, "但仍計入總額");

        var breakdown = data["categoryBreakdown"]!.AsArray();
        breakdown.Should().ContainSingle();
        breakdown[0]!["name"]!.GetValue<string>().Should().Be("餐飲");
        breakdown[0]!["total"]!.GetValue<decimal>().Should().Be(90m);
        breakdown[0]!["count"]!.GetValue<int>().Should().Be(1);
    }

    // ── I9 ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I9_未分類桶_null分類正確彙總()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 8, 10), 120m, merchant: "無分類店", categoryId: null);

        var data = await GetAnalyticsDataAsync(client, "2026-08");

        var breakdown = data["categoryBreakdown"]!.AsArray();
        breakdown.Should().ContainSingle();
        breakdown[0]!["categoryId"].Should().BeNull();
        breakdown[0]!["name"].Should().BeNull("未分類 name 為 null（前端顯示「未分類」）");
        breakdown[0]!["total"]!.GetValue<decimal>().Should().Be(120m);
        breakdown[0]!["count"]!.GetValue<int>().Should().Be(1);

        data["monthTotal"]!.GetValue<decimal>().Should().Be(120m);
        data["monthCount"]!.GetValue<int>().Should().Be(1);
    }

    // ── I10 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I10_多租戶隔離_他人消費全部不計入()
    {
        var (userA, clientA) = await NewUserClientAsync();
        var (userB, _) = await NewUserClientAsync();

        await SeedExpenseAsync(userA, Utc(2026, 5, 10), 100m, "A店");
        await SeedExpenseAsync(userA, Utc(2026, 4, 10), 50m); // A 上月
        // B 同月大量資料，皆不應洩漏進 A 的彙總。
        await SeedExpenseAsync(userB, Utc(2026, 5, 11), 9999m, "B店");
        await SeedExpenseAsync(userB, Utc(2026, 4, 11), 8888m); // B 上月

        var data = await GetAnalyticsDataAsync(clientA, "2026-05");

        data["monthTotal"]!.GetValue<decimal>().Should().Be(100m);
        data["prevMonthTotal"]!.GetValue<decimal>().Should().Be(50m);
        data["monthCount"]!.GetValue<int>().Should().Be(1);

        var merchants = data["merchantTopN"]!.AsArray().Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        merchants.Should().Contain("A店").And.NotContain("B店");

        // 趨勢窗（含上月）也不得含 B 的金額。
        var trendTotals = data["monthlyTrend"]!.AsArray().Select(n => n!["total"]!.GetValue<decimal>());
        trendTotals.Should().NotContain(9999m).And.NotContain(8888m);
    }

    // ── I11 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I11_軟刪除_排除於所有彙總()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 9, 10), 100m, "存活店");
        await SeedExpenseAsync(userId, Utc(2026, 9, 12), 999m, "已刪店", validFlag: false);

        var data = await GetAnalyticsDataAsync(client, "2026-09");

        data["monthTotal"]!.GetValue<decimal>().Should().Be(100m, "軟刪列不計入");
        data["monthCount"]!.GetValue<int>().Should().Be(1);
        var merchants = data["merchantTopN"]!.AsArray().Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        merchants.Should().ContainSingle().Which.Should().Be("存活店");
    }

    // ── I12 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I12_指定month_只彙總該月()
    {
        var (userId, client) = await NewUserClientAsync();

        await SeedExpenseAsync(userId, Utc(2026, 2, 10), 50m, "二月店");
        await SeedExpenseAsync(userId, Utc(2026, 3, 10), 70m, "三月店");
        await SeedExpenseAsync(userId, Utc(2026, 4, 10), 90m, "四月店");

        var data = await GetAnalyticsDataAsync(client, "2026-03");

        // 月範圍彙總只含 3 月。
        data["monthTotal"]!.GetValue<decimal>().Should().Be(70m);
        var merchants = data["merchantTopN"]!.AsArray().Select(n => n!["merchant"]!.GetValue<string>()).ToList();
        merchants.Should().ContainSingle().Which.Should().Be("三月店");

        // 但趨勢窗仍含前幾月（2 月）。
        var trend = data["monthlyTrend"]!.AsArray()
            .ToDictionary(n => n!["month"]!.GetValue<string>(), n => n!["total"]!.GetValue<decimal>());
        trend["2026-02"].Should().Be(50m);
        trend["2026-03"].Should().Be(70m);
    }

    // ── I13 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I13_month格式錯誤_回400()
    {
        var (_, client) = await NewUserClientAsync();

        var response = await client.GetAsync("/api/expenses/analytics?month=2026-13");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── I14 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I14_未帶Token_回401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/expenses/analytics?month=2026-05");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── I15 ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task I15_單一請求回全部區塊()
    {
        var (userId, client) = await NewUserClientAsync();
        var cats = await GetCategoryIdsAsync(client);

        await SeedExpenseAsync(userId, Utc(2026, 4, 10), 100m, "上月店"); // 上月（撐 deltaPct）
        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 300m, "本月店", cats["餐飲"]);

        var data = await GetAnalyticsDataAsync(client, "2026-05");

        // 五大區塊都在同一回應（守「避免 N 請求」）。
        data["monthTotal"]!.GetValue<decimal>().Should().Be(300m);
        data["deltaPct"]!.GetValue<decimal>().Should().Be(200.0m); // (300-100)/100*100
        data["monthlyTrend"]!.AsArray().Should().HaveCount(6);
        data["categoryBreakdown"]!.AsArray().Should().ContainSingle();
        data["dailyTotals"]!.AsArray().Should().ContainSingle();
        data["merchantTopN"]!.AsArray().Should().ContainSingle();
    }

    // ── N=1 邊界（審查修正：與上月比 prevMonthTotal 獨立於趨勢窗）─────────────────
    [Fact]
    public async Task N為1_上月有資料_prevMonthTotal與deltaPct仍正確()
    {
        // 直接以 N=1 設定建服務打真 DB（趨勢窗只含選定月），驗證上月比不受 N 影響。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"analytics-n1-{Guid.NewGuid():N}@example.com");
        _ = token;

        await SeedExpenseAsync(userId, Utc(2026, 4, 10), 200m); // 上月
        await SeedExpenseAsync(userId, Utc(2026, 5, 10), 300m); // 本月

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Expense:AnalyticsTrendMonths"] = "1",
                })
                .Build();
            var service = new ExpenseAnalyticsService(db, config);

            var result = await service.GetAnalyticsAsync(userId, "2026-05", CancellationToken.None);

            result.MonthValid.Should().BeTrue();
            var dto = result.Analytics!;
            dto.MonthlyTrend.Should().HaveCount(1, "N=1 → 趨勢窗只含選定月");
            dto.MonthlyTrend[0].Month.Should().Be("2026-05");
            dto.MonthTotal.Should().Be(300m);
            dto.PrevMonthTotal.Should().Be(200m, "上月比用獨立區間，不受 N=1 影響");
            dto.DeltaPct.Should().Be(50.0m);
        }
    }
}
