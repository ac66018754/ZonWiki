using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// TtsAudio 白名單「不」登記活動流回歸（準則 §2.3：快取品不進活動流）：
/// synthesize＋serve 全程不得為該使用者產生任何 ActivityLog（TtsAudio 未登記 ActivityLogInterceptor.MapEntity）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsActivityLogHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsActivityLogHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task synthesize與serve_不產生ActivityLog()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-act-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var noteId = await _factory.SeedNoteAsync(userId, "活動流測試內容。");

        var synth = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var id = Guid.Parse((await synth.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(id)).Should().Be("ready");
        (await client.GetAsync($"/api/tts/audio/{id}")).EnsureSuccessStatusCode();

        // 該使用者不應有任何活動流（TtsAudio 未登記、note 由測試種子 CurrentUserId=Empty 也不記）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var activityCount = await db.ActivityLog.IgnoreQueryFilters()
                .CountAsync(a => a.UserId == userId);
            activityCount.Should().Be(0, "TtsAudio 是快取品，synthesize/serve 不應灌活動流");
        }
    }
}
