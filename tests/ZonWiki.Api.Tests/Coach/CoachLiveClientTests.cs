using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Coach;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="CoachLiveClient"/> 單元測試（不連真 Vertex，測內部行為）：
/// ①A1 並發送 audio＋toolResponse 不擲 InvalidOperationException；②host 斷言拒非 aiplatform host
/// （且拒連時不取 token）；③Abort／Dispose 冪等且中止後不再送。
/// </summary>
public sealed class CoachLiveClientTests
{
    /// <summary>會記錄「是否被呼叫」的 ADC token 提供者假件（驗 host 斷言先於取 token）。</summary>
    private sealed class RecordingTokenProvider : IVertexAdcTokenProvider
    {
        public bool Called { get; private set; }

        public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
        {
            Called = true;
            return Task.FromResult("fake-token");
        }
    }

    private static CoachLiveClient NewClient(CoachLiveConnectionConfig config, IVertexAdcTokenProvider tokenProvider)
        => new(tokenProvider, config, NullLogger<CoachLiveClient>.Instance);

    private static CoachLiveConnectionConfig NormalConfig(string region = "us-central1")
        => new(region, "zonwiki-prod", "gemini-live-2.5-flash-native-audio", "Kore", "en-US", "16000");

    [Fact]
    public async Task 並發送出_audio與toolResponse_不擲InvalidOperationException()
    {
        await using var client = NewClient(NormalConfig(), new RecordingTokenProvider());

        // 未連線時 Send* 只入序列化佇列（不直接 SendAsync）；並發呼叫應永不擲 InvalidOperationException。
        var tasks = new List<Task>();
        for (var i = 0; i < 200; i++)
        {
            tasks.Add(client.SendAudioAsync("AAAA", CancellationToken.None).AsTask());
            tasks.Add(client.SendToolResponseAsync("id", "add_vocabulary", new { result = "ok" }, "WHEN_IDLE", CancellationToken.None).AsTask());
        }

        var act = async () => await Task.WhenAll(tasks);
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task ConnectAsync_非Vertex官方host_拒連且不取token()
    {
        // region 帶斜線 → 組出的 URL host 落在 "evil.attacker.example"（非 aiplatform）→ 斷言拒連。
        var tokenProvider = new RecordingTokenProvider();
        await using var client = NewClient(NormalConfig("evil.attacker.example/"), tokenProvider);

        var act = async () => await client.ConnectAsync(
            new CoachLiveSetup("system"), resumptionHandle: null, CancellationToken.None);

        await act.Should().ThrowAsync<InvalidOperationException>();
        tokenProvider.Called.Should().BeFalse("host 斷言必須先於取 token，避免 ADC token 外流");
    }

    [Fact]
    public async Task Abort_冪等_且中止後送出被丟棄()
    {
        await using var client = NewClient(NormalConfig(), new RecordingTokenProvider());

        client.Abort();
        client.Abort(); // 冪等，不擲例外。

        // 中止後再送不擲例外（靜默丟棄）。
        var act = async () => await client.SendAudioAsync("AAAA", CancellationToken.None);
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task DisposeAsync_冪等_可安全重複呼叫()
    {
        var client = NewClient(NormalConfig(), new RecordingTokenProvider());

        await client.DisposeAsync();
        var act = async () => await client.DisposeAsync();
        await act.Should().NotThrowAsync();
    }
}
