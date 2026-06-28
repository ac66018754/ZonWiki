using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 以 OpenAI 相容的 <c>/audio/transcriptions</c> 端點做語音轉文字。
/// Groq（https://api.groq.com/openai/v1）與多數 OpenAI 相容服務皆可用此格式：
/// multipart/form-data，欄位 file（音訊）、model、response_format=json。
/// </summary>
public sealed class OpenAiCompatibleTranscriptionService : ITranscriptionService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OpenAiCompatibleTranscriptionService> _logger;

    /// <summary>
    /// 建立轉錄服務。
    /// </summary>
    public OpenAiCompatibleTranscriptionService(
        IHttpClientFactory httpClientFactory,
        ILogger<OpenAiCompatibleTranscriptionService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<string> TranscribeAsync(
        string audioFilePath,
        string baseUrl,
        string apiKey,
        string model,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(audioFilePath))
        {
            throw new FileNotFoundException("找不到要轉錄的音訊檔。", audioFilePath);
        }
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("轉錄服務缺少 API 金鑰。");
        }

        var endpoint = baseUrl.TrimEnd('/') + "/audio/transcriptions";

        // ai HttpClient 已設定較長逾時（600 秒），轉錄長音訊需要。
        var http = _httpClientFactory.CreateClient("ai");

        using var form = new MultipartFormDataContent();
        await using var fileStream = File.OpenRead(audioFilePath);
        var fileContent = new StreamContent(fileStream);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(fileContent, "file", Path.GetFileName(audioFilePath));
        form.Add(new StringContent(model), "model");
        form.Add(new StringContent("json"), "response_format");

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("轉錄失敗（{Status}）：{Body}", (int)response.StatusCode, Truncate(body, 500));
            throw new InvalidOperationException($"轉錄服務回應 {(int)response.StatusCode}：{Truncate(body, 200)}");
        }

        // 回應格式：{ "text": "..." }
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("text", out var textElement))
            {
                return textElement.GetString() ?? string.Empty;
            }
        }
        catch (JsonException)
        {
            // 某些端點 response_format=text 時直接回純文字。
            return body;
        }

        return body;
    }

    /// <summary>截斷字串（記錄用）。</summary>
    private static string Truncate(string s, int max) => s.Length > max ? s[..max] + "…" : s;
}
