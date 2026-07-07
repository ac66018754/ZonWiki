using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// Gemini-TTS（透過 Cloud Text-to-Speech API）文字轉語音實作。
///
/// 端點（recon 實打 HTTP 200，設計書 §6.1）：
/// <c>POST https://texttospeech.googleapis.com/v1/text:synthesize</c>，body 形狀：
/// <code>
/// { "input": { "text": "…" },
///   "voice": { "languageCode": "cmn-TW", "name": "Kore", "modelName": "gemini-2.5-flash-tts" },
///   "audioConfig": { "audioEncoding": "MP3" } }
/// </code>
/// 回應 <c>{ "audioContent": "&lt;base64&gt;" }</c>。
///
/// 認證與安全：
/// - ADC access token 當 Bearer（<see cref="IVertexAdcTokenProvider"/>；cloud-platform scope、自動刷新）。
/// - <b>必帶 <c>x-goog-user-project</c> header</b>（值取自設定 <c>Gcp:QuotaProject</c>，預設 zonwiki-prod）——
///   Cloud TTS 端點 URL 不含 project，user ADC 缺此 header 會 403（quota project）；prod SA 帶了無害。
/// - 目標 URL <b>非使用者可控</b>（固定官方端點，經設定值 <c>Tts:Endpoint</c> 也只在部署時設定），
///   ADC token 只送這一個官方端點，杜絕「系統憑證被導向外部端點竊取」。
/// - v1 不帶 style prompt（recon 標「確切 body 形狀未確認」）；語氣／個性參數留 v2。
/// </summary>
public sealed class GeminiCloudTtsService : ITextToSpeechService
{
    /// <summary>Cloud TTS synthesize 端點預設 URL（設定鍵 <c>Tts:Endpoint</c> 可覆寫）。</summary>
    private const string DefaultEndpoint = "https://texttospeech.googleapis.com/v1/text:synthesize";

    /// <summary>quota project 預設值（設定鍵 <c>Gcp:QuotaProject</c> 可覆寫）。</summary>
    private const string DefaultQuotaProject = "zonwiki-prod";

    /// <summary>命名 HttpClient 名稱（timeout 見 DI 註冊）。</summary>
    public const string HttpClientName = "tts";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IVertexAdcTokenProvider _tokenProvider;
    private readonly IConfiguration _configuration;
    private readonly ILogger<GeminiCloudTtsService> _logger;

    /// <summary>
    /// 建立 Gemini-TTS 服務。
    /// </summary>
    /// <param name="httpClientFactory">HTTP 用戶端工廠（用命名 client "tts"）。</param>
    /// <param name="tokenProvider">ADC access token 提供者。</param>
    /// <param name="configuration">設定（讀 Tts:Endpoint、Gcp:QuotaProject）。</param>
    /// <param name="logger">記錄器。</param>
    public GeminiCloudTtsService(
        IHttpClientFactory httpClientFactory,
        IVertexAdcTokenProvider tokenProvider,
        IConfiguration configuration,
        ILogger<GeminiCloudTtsService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _tokenProvider = tokenProvider;
        _configuration = configuration;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<byte[]> SynthesizeAsync(
        string text,
        string voiceName,
        string languageCode,
        string modelName,
        string audioEncoding,
        CancellationToken cancellationToken)
    {
        var endpoint = _configuration["Tts:Endpoint"];
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            endpoint = DefaultEndpoint;
        }

        var quotaProject = _configuration["Gcp:QuotaProject"];
        if (string.IsNullOrWhiteSpace(quotaProject))
        {
            quotaProject = DefaultQuotaProject;
        }

        // ADC token（不可用時 token provider 拋帶引導的 InvalidOperationException；此處轉成安全的合成例外）。
        string accessToken;
        try
        {
            accessToken = await _tokenProvider.GetAccessTokenAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new TtsSynthesisException("無法取得 Cloud TTS 存取憑證（ADC 不可用）。", ex);
        }

        // 組請求主體（含中文 → 明示 UTF-8 序列化）。
        var payload = new
        {
            input = new { text },
            voice = new { languageCode, name = voiceName, modelName },
            audioConfig = new { audioEncoding },
        };
        var json = JsonSerializer.Serialize(payload);

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        // Cloud TTS URL 無 project → 必帶 quota project header，否則 403。
        request.Headers.Add("x-goog-user-project", quotaProject);

        var http = _httpClientFactory.CreateClient(HttpClientName);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Cloud TTS 請求傳輸失敗（voice={Voice}）", voiceName);
            throw new TtsSynthesisException("Cloud TTS 請求傳輸失敗。", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                // 記錄狀態碼供除錯（不記完整主體，可能含敏感資訊）；對外只給安全摘要。
                _logger.LogWarning(
                    "Cloud TTS 回非 2xx（status={Status}，voice={Voice}）", (int)response.StatusCode, voiceName);
                throw new TtsSynthesisException($"Cloud TTS 回應狀態碼 {(int)response.StatusCode}。");
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return ExtractAudioContent(body);
        }
    }

    /// <summary>
    /// 解析回應 JSON 的 <c>audioContent</c>（base64）→ 音檔位元組。缺欄／非法 base64 → 拋安全例外。
    /// </summary>
    /// <param name="body">回應 JSON 主體。</param>
    /// <returns>解碼後的音檔位元組。</returns>
    private static byte[] ExtractAudioContent(string body)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw new TtsSynthesisException("Cloud TTS 回應非合法 JSON。", ex);
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("audioContent", out var audioContent)
                || audioContent.ValueKind != JsonValueKind.String)
            {
                throw new TtsSynthesisException("Cloud TTS 回應缺少 audioContent。");
            }

            var base64 = audioContent.GetString() ?? string.Empty;
            try
            {
                return Convert.FromBase64String(base64);
            }
            catch (FormatException ex)
            {
                throw new TtsSynthesisException("Cloud TTS 回應 audioContent 非合法 base64。", ex);
            }
        }
    }
}
