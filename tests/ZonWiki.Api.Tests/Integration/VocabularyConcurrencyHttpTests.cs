using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫並發 upsert 整合測試（審查 MEDIUM）：對同一 (UserId, Word) 並發送出多個 POST，
/// 斷言 DB 只有一列、所有回應皆非 500（唯一索引 23505 攔截改查既有列，比照 Expense 手法）。
/// 涵蓋手動 POST /api/vocabulary 與 AI POST /api/ai/vocabulary 兩條 upsert 路徑。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyConcurrencyHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyConcurrencyHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<int> CountAsync(Guid userId, string word)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.VocabularyWord.IgnoreQueryFilters().CountAsync(v => v.UserId == userId && v.Word == word);
        }
    }

    [Fact]
    public async Task PostVocabulary_同字並發_只建一列且皆非500()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vocab-race-{Guid.NewGuid():N}@example.com");
        const string word = "concurrent";

        // 多個獨立用戶端（各自 scoped DbContext）並發送出同字。
        var clients = Enumerable.Range(0, 4).Select(_ => _factory.CreateClientWithToken(token)).ToArray();
        var tasks = clients.Select(c => c.PostAsJsonAsync("/api/vocabulary", new { word })).ToArray();
        var responses = await Task.WhenAll(tasks);

        foreach (var response in responses)
        {
            response.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.OK);
            ((int)response.StatusCode).Should().NotBe(500, "並發 upsert 不得回 500");
        }

        (await CountAsync(userId, word)).Should().Be(1, "並發：仍只建一列");
    }

    [Fact]
    public async Task PostAiVocabulary_同字並發_只建一列且皆非500()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vocab-ai-race-{Guid.NewGuid():N}@example.com");
        const string word = "airace";

        var clients = Enumerable.Range(0, 3).Select(_ => _factory.CreateClientWithToken(token)).ToArray();
        var tasks = clients.Select(c => c.PostAsJsonAsync("/api/ai/vocabulary", new { word })).ToArray();
        var responses = await Task.WhenAll(tasks);

        foreach (var response in responses)
        {
            // AI 端點有組合限流，少量並發不致觸發；核心是「不得 500」。
            ((int)response.StatusCode).Should().NotBe(500, "並發 AI upsert 不得回 500");
            response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.TooManyRequests);
        }

        (await CountAsync(userId, word)).Should().Be(1, "並發：仍只建一列");
    }
}
