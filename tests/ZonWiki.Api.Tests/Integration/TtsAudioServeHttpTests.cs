using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// TTS 授權供檔端點整合測試：完整供檔（200＋Accept-Ranges）、HTTP Range（206＋Content-Range）、
/// 他人／processing／不存在一律 404（不洩漏他人存在，僅供本人 ready 音檔）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsAudioServeHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsAudioServeHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>合成一段音檔並等到 ready，回其 ttsAudioId。</summary>
    private async Task<Guid> SynthesizeReadyAsync(HttpClient client, Guid userId, string content)
    {
        var noteId = await _factory.SeedNoteAsync(userId, content);
        var response = await client.PostAsJsonAsync($"/api/tts/notes/{noteId}/synthesize", new { voice = "Kore" });
        var id = Guid.Parse((await response.ReadJsonAsync())["data"]!["ttsAudioId"]!.GetValue<string>());
        (await client.PollStatusUntilTerminalAsync(id)).Should().Be("ready");
        return id;
    }

    [Fact]
    public async Task I7_ready音檔_200完整bytes含AcceptRanges與正確ContentType()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-serve-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var id = await SynthesizeReadyAsync(client, userId, "供檔測試內容。");

        var response = await client.GetAsync($"/api/tts/audio/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("audio/mpeg");
        response.Headers.AcceptRanges.Should().Contain("bytes");
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes.Length.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task I8_帶Range_回206與部分內容()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-range-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var id = await SynthesizeReadyAsync(client, userId, "Range 測試內容。");

        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/tts/audio/{id}");
        request.Headers.Range = new RangeHeaderValue(0, 9);
        var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.PartialContent);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes.Length.Should().Be(10);
        response.Content.Headers.ContentRange.Should().NotBeNull();
        response.Content.Headers.ContentRange!.Unit.Should().Be("bytes");
    }

    [Fact]
    public async Task I9_他人音檔_404不洩漏()
    {
        var (userIdA, tokenA) = await _factory.SeedUserWithTokenAsync($"tts-serveA-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"tts-serveB-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);
        var id = await SynthesizeReadyAsync(clientA, userIdA, "A 的音檔。");

        (await clientB.GetAsync($"/api/tts/audio/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task I10_processing音檔_404只供ready()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"tts-serveP-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // 直接種一列 processing 音檔（尚未 ready）。
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
                    NoteId = null,
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

        (await client.GetAsync($"/api/tts/audio/{processingId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task I11_不存在id_404()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"tts-serve404-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        (await client.GetAsync($"/api/tts/audio/{Guid.NewGuid()}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
