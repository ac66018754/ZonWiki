using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 限流整合測試：
/// - /api/ai/expenses 組合限流（TokenBucket＋SlidingWindow）短時間超量 → 429。
/// - /api/captures 補掛 PatPolicy 後超量 → 429。
/// - /api/ai/expenses 未達限連續數次 → 皆 200（不誤擋）。
///
/// 分區以 UserId 切分：每個測試用新使用者（新權杖）→ 新分區、滿桶，彼此不干擾。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseRateLimitHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public ExpenseRateLimitHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task PostAiExpenses_短時間超量_回429()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-ai-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 30; i++)
        {
            var response = await client.PostAsJsonAsync("/api/ai/expenses", new { text = "壓測一句話" });
            statuses.Add(response.StatusCode);
        }

        statuses.Should().Contain(HttpStatusCode.TooManyRequests, "短時間超量應觸發組合限流回 429");
    }

    [Fact]
    public async Task PostCaptures_補掛PatPolicy_超量回429()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-cap-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 45; i++)
        {
            var response = await client.PostAsJsonAsync("/api/captures",
                new { source = "text", rawContent = $"壓測 {i}" });
            statuses.Add(response.StatusCode);
        }

        statuses.Should().Contain(HttpStatusCode.TooManyRequests, "隨手記補掛 PatPolicy 後超量應回 429");
    }

    [Fact]
    public async Task PostAiExpenses_未達限_連續數次仍200()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-ok-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        for (var i = 0; i < 3; i++)
        {
            var response = await client.PostAsJsonAsync("/api/ai/expenses", new { text = "正常一句話" });
            response.StatusCode.Should().Be(HttpStatusCode.OK, "未達限的少量請求不應被誤擋");
        }
    }

    [Fact]
    public async Task PostExpensesParse_短時間超量_受組合限流回429()
    {
        // 修正 #2：解析端點補掛 PatAiRateLimitMarker 後，也受「組合限流（TokenBucket 15/補8＋SlidingWindow 30）」約束。
        // 送 18 次（少於端點 AiPolicy 的 SlidingWindow 20，故 AiPolicy 單獨不會擋）——若出現 429，
        // 必來自組合限流的 TokenBucket（桶容量 15），據此證明 chained 限流確實對 parse 端點生效（堵住 PAT 繞道）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-parse-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 18; i++)
        {
            var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "壓測解析一句話" });
            statuses.Add(response.StatusCode);
        }

        statuses.Should().Contain(
            HttpStatusCode.TooManyRequests,
            "18 次（<AiPolicy 的 20）仍出現 429，證明是組合限流 TokenBucket(15) 生效，parse 端點確受 chained 限流");
    }
}
