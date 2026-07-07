using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Tts;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="GeminiCloudTtsService.SynthesizeMultiSpeakerAsync"/> 的請求 body 形狀單元測試（Phase 3，spec §8）：
/// 以攔截式 HttpMessageHandler 捕捉真實送出的 JSON，驗證多講者 markup／speakerVoiceConfigs（恰 2 講者、
/// speakerAlias 對應 speakerId 裸聲音名）／voice.modelName 放 voice 內／audioConfig。不打真網路（返回假 audioContent）。
/// </summary>
public sealed class TtsMultiSpeakerBodyTests
{
    [Fact]
    public async Task 多講者body_形狀符合spec()
    {
        var capturingHandler = new CapturingHandler();
        var service = new GeminiCloudTtsService(
            new StubHttpClientFactory(capturingHandler),
            new StubTokenProvider(),
            new ConfigurationBuilder().Build(),
            NullLogger<GeminiCloudTtsService>.Instance);

        var turns = new List<(string Speaker, string Text)>
        {
            ("A", "歡迎回到節目"),
            ("B", "我先整理三個重點"),
        };

        var audio = await service.SynthesizeMultiSpeakerAsync(
            turns, voiceA: "Kore", voiceB: "Charon",
            languageCode: "cmn-TW", modelName: "gemini-2.5-flash-tts",
            audioEncoding: "MP3", CancellationToken.None);

        // 回傳假 audioContent 已解碼。
        audio.Should().NotBeNull();
        Encoding.UTF8.GetString(audio).Should().Be("hello");

        // 驗證捕捉到的 JSON body 形狀。
        capturingHandler.CapturedBody.Should().NotBeNull();
        using var doc = JsonDocument.Parse(capturingHandler.CapturedBody!);
        var root = doc.RootElement;

        // input.multiSpeakerMarkup.turns[]（speaker/text）
        var markupTurns = root.GetProperty("input").GetProperty("multiSpeakerMarkup").GetProperty("turns");
        markupTurns.GetArrayLength().Should().Be(2);
        markupTurns[0].GetProperty("speaker").GetString().Should().Be("A");
        markupTurns[0].GetProperty("text").GetString().Should().Be("歡迎回到節目");
        markupTurns[1].GetProperty("speaker").GetString().Should().Be("B");

        // voice.modelName 放 voice 物件內（非頂層）。
        var voice = root.GetProperty("voice");
        voice.GetProperty("modelName").GetString().Should().Be("gemini-2.5-flash-tts");
        voice.GetProperty("languageCode").GetString().Should().Be("cmn-TW");

        // voice.multiSpeakerVoiceConfig.speakerVoiceConfigs[]（恰 2 講者，alias→裸聲音名）。
        var configs = voice.GetProperty("multiSpeakerVoiceConfig").GetProperty("speakerVoiceConfigs");
        configs.GetArrayLength().Should().Be(2);
        configs[0].GetProperty("speakerAlias").GetString().Should().Be("A");
        configs[0].GetProperty("speakerId").GetString().Should().Be("Kore");
        configs[1].GetProperty("speakerAlias").GetString().Should().Be("B");
        configs[1].GetProperty("speakerId").GetString().Should().Be("Charon");

        // audioConfig：audioEncoding 傳入值 + 24kHz。
        var audioConfig = root.GetProperty("audioConfig");
        audioConfig.GetProperty("audioEncoding").GetString().Should().Be("MP3");
        audioConfig.GetProperty("sampleRateHertz").GetInt32().Should().Be(24000);

        // 認證：Bearer + x-goog-user-project（送官方端點）。
        capturingHandler.CapturedAuthorization.Should().Be("Bearer fake-token");
        capturingHandler.CapturedQuotaProject.Should().NotBeNullOrEmpty();
        capturingHandler.CapturedUri.Should().Be("https://texttospeech.googleapis.com/v1/text:synthesize");
    }

    [Fact]
    public async Task 空回合_擲合成例外()
    {
        var service = new GeminiCloudTtsService(
            new StubHttpClientFactory(new CapturingHandler()),
            new StubTokenProvider(),
            new ConfigurationBuilder().Build(),
            NullLogger<GeminiCloudTtsService>.Instance);

        var act = () => service.SynthesizeMultiSpeakerAsync(
            new List<(string, string)>(), "Kore", "Charon", "cmn-TW", "gemini-2.5-flash-tts", "MP3", CancellationToken.None);

        await act.Should().ThrowAsync<TtsSynthesisException>();
    }

    /// <summary>攔截式 handler：捕捉 body／授權標頭／URI，回固定假 audioContent（base64 of "hello"）。</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string? CapturedBody { get; private set; }
        public string? CapturedAuthorization { get; private set; }
        public string? CapturedQuotaProject { get; private set; }
        public string? CapturedUri { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CapturedUri = request.RequestUri?.ToString();
            CapturedAuthorization = request.Headers.Authorization?.ToString();
            CapturedQuotaProject = request.Headers.TryGetValues("x-goog-user-project", out var v)
                ? string.Join(",", v)
                : null;
            CapturedBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

            var base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("hello"));
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($"{{\"audioContent\":\"{base64}\"}}", Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public StubHttpClientFactory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed class StubTokenProvider : IVertexAdcTokenProvider
    {
        public Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
            => Task.FromResult("fake-token");
    }
}
