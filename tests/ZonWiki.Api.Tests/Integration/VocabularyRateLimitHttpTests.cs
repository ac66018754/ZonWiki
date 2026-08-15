using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫 AI 端點限流整合測試：
/// - /api/ai/vocabulary 組合限流（TokenBucket 15/補8＋SlidingWindow 30）短時間超量 → 429。
/// - 未達限連續數次 → 皆 200（不誤擋）。
/// 分區以 UserId 切分：每個測試用新使用者（新權杖）→ 新分區、滿桶，彼此不干擾。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyRateLimitHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyRateLimitHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    // L1
    [Fact]
    public async Task PostAiVocabulary_短時間超量_回429()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-vocab-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 30; i++)
        {
            var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = $"stress{i}" });
            statuses.Add(response.StatusCode);
        }

        statuses.Should().Contain(HttpStatusCode.TooManyRequests, "短時間超量應觸發組合限流回 429");
    }

    // L2
    [Fact]
    public async Task PostAiVocabulary_未達限_連續數次仍200()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"rl-vocab-ok-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        for (var i = 0; i < 3; i++)
        {
            var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = $"normal{i}" });
            response.StatusCode.Should().Be(HttpStatusCode.OK, "未達限的少量請求不應被誤擋");
        }
    }
}
