using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫活動流整合測試（審查 MEDIUM：避免高頻複習灌爆活動流）：
/// - 複習評分（純 SRS 欄位更新）不寫活動流。
/// - CRUD 編輯（改釋義）仍正常寫 'updated' 活動流。
/// - 新建仍寫 'created'。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyActivityLogHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyActivityLogHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<int> CountActivitiesAsync(Guid userId, Guid entityId, string actionType)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.ActivityLog.IgnoreQueryFilters()
                .CountAsync(a => a.UserId == userId
                    && a.EntityType == "vocabulary"
                    && a.EntityId == entityId
                    && a.ActionType == actionType);
        }
    }

    [Fact]
    public async Task 複習不灌活動流_但新建與編輯釋義有記錄()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"vocab-act-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var createResponse = await client.PostAsJsonAsync("/api/vocabulary", new { word = "activity" });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = Guid.Parse((await createResponse.ReadJsonAsync())["data"]!["id"]!.GetValue<string>());

        // 新建應記 'created'。
        (await CountActivitiesAsync(userId, id, "created")).Should().BeGreaterThanOrEqualTo(1, "新建應記活動流");

        // 連續複習數次（純 SRS 更新）→ 不應產生任何 'updated' 活動流。
        for (var i = 0; i < 5; i++)
        {
            (await client.PostAsJsonAsync($"/api/vocabulary/{id}/review", new { rating = "good" }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await CountActivitiesAsync(userId, id, "updated"))
            .Should().Be(0, "純複習（SRS 欄位更新）不應灌活動流");

        // 編輯釋義（CRUD）→ 應記 'updated'。
        (await client.PutAsJsonAsync($"/api/vocabulary/{id}", new { definitionZh = "活動" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        (await CountActivitiesAsync(userId, id, "updated"))
            .Should().Be(1, "編輯釋義應記一筆 'updated' 活動流");
    }
}
