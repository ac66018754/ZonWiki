using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// TTS 狀態輪詢、聲音清單、TTS 偏好設定端點整合測試。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsStatusAndSettingsHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsStatusAndSettingsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task I12_狀態_processing列回processing_完成後回ready含時長()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-st-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // 直接種一列 processing → status 回 processing。
        Guid processingId;
        {
            var (scope, db) = _factory.CreateDbScope();
            using (scope)
            {
                var now = DateTime.UtcNow;
                var row = new TtsAudio
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    ContentHash = "hash-" + Guid.NewGuid().ToString("N"),
                    ScriptJson = string.Empty,
                    Status = "processing",
                    VoiceName = "Kore",
                    ModelKey = "gemini-2.5-flash-tts",
                    FilePath = string.Empty,
                    ContentType = "audio/mpeg",
                    CreatedDateTime = now,
                    UpdatedDateTime = now,
                    CreatedUser = userId.ToString(),
                    UpdatedUser = userId.ToString(),
                    ValidFlag = true,
                };
                db.TtsAudio.Add(row);
                await db.SaveChangesAsync();
                processingId = row.Id;
            }
        }

        var processingJson = await (await client.GetAsync($"/api/tts/audio/{processingId}/status")).ReadJsonAsync();
        processingJson["data"]!["status"]!.GetValue<string>().Should().Be("processing");
        processingJson["data"]!["ttsAudioId"]!.GetValue<string>().Should().Be(processingId.ToString());

        // 真正合成一段 → 完成後 status 回 ready。
        var noteId = await _factory.SeedNoteAsync(userId, "狀態轉移測試內容。");
        var synth = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var readyId = Guid.Parse((await synth.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(readyId)).Should().Be("ready");

        var readyJson = await (await client.GetAsync($"/api/tts/audio/{readyId}/status")).ReadJsonAsync();
        readyJson["data"]!["status"]!.GetValue<string>().Should().Be("ready");
    }

    [Fact]
    public async Task I13_狀態_他人id_404()
    {
        var (userIdA, tokenA) = await _factory.SeedUserWithTokenAsync($"tts-st-a-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"tts-st-b-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);
        var noteId = await _factory.SeedNoteAsync(userIdA, "A 內容。");
        var synth = await clientA.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var id = Guid.Parse((await synth.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());

        (await clientB.GetAsync($"/api/tts/audio/{id}/status")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task I14_voices_回30聲含欄位且性別分佈14女16男()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"tts-voices-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var json = await (await client.GetAsync("/api/tts/voices")).ReadJsonAsync();
        var voices = json["data"]!.AsArray();

        voices.Should().HaveCount(30);
        voices.Should().OnlyContain(v =>
            v!["name"] != null && v["gender"] != null && v["label"] != null && v["language"] != null);
        voices.Count(v => v!["gender"]!.GetValue<string>() == "female").Should().Be(14);
        voices.Count(v => v!["gender"]!.GetValue<string>() == "male").Should().Be(16);
    }

    [Fact]
    public async Task I15_ttsSettings未設_回系統預設()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"tts-set0-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var json = await (await client.GetAsync("/api/me/tts-settings")).ReadJsonAsync();

        json["data"]!["voice"]!.GetValue<string>().Should().Be("Kore");
        json["data"]!["language"]!.GetValue<string>().Should().Be("cmn-TW");
        json["data"]!["format"]!.GetValue<string>().Should().Be("MP3");
    }

    [Fact]
    public async Task I16_ttsSettings_PUT合法_落庫且GET一致()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-setP-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var put = await client.PutAsJsonAsync("/api/me/tts-settings", new { voice = "Puck", format = "OGG_OPUS" });
        put.StatusCode.Should().Be(HttpStatusCode.OK);
        var putJson = await put.ReadJsonAsync();
        putJson["data"]!["voice"]!.GetValue<string>().Should().Be("Puck");
        putJson["data"]!["format"]!.GetValue<string>().Should().Be("OGG_OPUS");

        // 落庫（User_TtsSettingsJson 非空）。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var settingsJson = await db.User.Where(u => u.Id == userId)
                .Select(u => u.TtsSettingsJson).FirstAsync();
            settingsJson.Should().NotBeNullOrEmpty();
        }

        // GET 讀回一致。
        var getJson = await (await client.GetAsync("/api/me/tts-settings")).ReadJsonAsync();
        getJson["data"]!["voice"]!.GetValue<string>().Should().Be("Puck");
        getJson["data"]!["format"]!.GetValue<string>().Should().Be("OGG_OPUS");
    }

    [Fact]
    public async Task I17_ttsSettings_PUT非法voice或format_400()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"tts-setBad-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        (await client.PutAsJsonAsync("/api/me/tts-settings", new { voice = "NotAVoice" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.PutAsJsonAsync("/api/me/tts-settings", new { format = "WAV" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task I17b_ttsSettings_PUT非白名單language_400_白名單language_200()
    {
        // 審查修正 #4：UpdateSettingsHandler 一併驗 language 白名單。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"tts-setLang-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // 非白名單語言 → 400。
        (await client.PutAsJsonAsync("/api/me/tts-settings", new { language = "fr-FR" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 白名單退路語言（cmn-CN）→ 200 且落回。
        var ok = await client.PutAsJsonAsync("/api/me/tts-settings", new { language = "cmn-CN" });
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ok.ReadJsonAsync())["data"]!["language"]!.GetValue<string>().Should().Be("cmn-CN");
    }

    [Fact]
    public async Task I18_ttsSettings_跨使用者隔離()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"tts-isoA-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"tts-isoB-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);

        (await clientA.PutAsJsonAsync("/api/me/tts-settings", new { voice = "Puck" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // B 未設 → 仍回系統預設 Kore（不受 A 影響）。
        var bJson = await (await clientB.GetAsync("/api/me/tts-settings")).ReadJsonAsync();
        bJson["data"]!["voice"]!.GetValue<string>().Should().Be("Kore");
    }
}
