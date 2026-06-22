using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 以「OpenAI 相容」HTTP 端點為後端的 AI 供應者。一條程式路徑即可涵蓋
/// OpenAI、Google Gemini（OpenAI 相容端點）、Anthropic 相容端點，以及各種 OpenAI 相容中轉站
/// （one-api / new-api / 自架 proxy）。差異全部由設定（BaseUrl / ApiKey / ModelId）決定。
///
/// 串流採 SSE：POST {BaseUrl}/chat/completions，body 帶 stream:true，
/// 逐行讀取「data: {json}」，從 choices[0].delta.content 取增量文字，遇 "data: [DONE]" 結束。
/// 為無狀態端點，不支援 resume（接續對話以完整脈絡 prompt 重建，由上層負責）。
/// </summary>
public sealed class OpenAiCompatibleStreamingProvider : IAiProvider
{
    private readonly HttpClient _http;
    private readonly string _endpoint;
    private readonly string _apiKey;
    private readonly string _modelId;
    private readonly int _timeoutSeconds;

    /// <summary>
    /// 建立 OpenAI 相容供應者。
    /// </summary>
    /// <param name="http">共用的 HttpClient（由 IHttpClientFactory 提供，避免 socket 耗盡）。</param>
    /// <param name="baseUrl">端點基底 URL，需含正確路徑前綴（如 .../v1 或 .../v1beta/openai）。</param>
    /// <param name="apiKey">已解析的 API 金鑰（Bearer）。</param>
    /// <param name="modelId">模型代號（請求 body 的 model 欄位）。</param>
    /// <param name="timeoutSeconds">串流逾時秒數（夾在 10–3600）。</param>
    public OpenAiCompatibleStreamingProvider(HttpClient http, string baseUrl, string apiKey, string modelId, int timeoutSeconds = 300)
    {
        _http = http;
        _endpoint = baseUrl.TrimEnd('/') + "/chat/completions";
        _apiKey = apiKey;
        _modelId = modelId;
        _timeoutSeconds = Math.Clamp(timeoutSeconds <= 0 ? 300 : timeoutSeconds, 10, 3600);
    }

    /// <summary>
    /// 送出單則使用者訊息並串流回應。<paramref name="resumeSessionId"/> 與 <paramref name="model"/> 在此忽略
    /// （模型由建構時的 ModelId 決定；無狀態端點不接續 session）。
    /// </summary>
    public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_timeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        var ct = linkedCts.Token;

        // 有系統提示時，於 messages 最前面加一則 role=system（OpenAI 相容原生作法）。
        var messages = string.IsNullOrWhiteSpace(systemPrompt)
            ? new[] { new { role = "user", content = prompt } }
            : new[] { new { role = "system", content = systemPrompt }, new { role = "user", content = prompt } };

        var payload = JsonSerializer.Serialize(new
        {
            model = _modelId,
            messages,
            stream = true,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        // 送出與狀態檢查放在「不含 yield」的 try 內，把錯誤轉成 Error 事件；
        // 串流讀取迴圈在外層 yield，取消（使用者中斷 / 逾時）則讓 OperationCanceledException 往上拋由協調器處理。
        HttpResponseMessage? response = null;
        string? preStreamError = null;
        try
        {
            response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct);
                preStreamError = ExtractError(errorBody, (int)response.StatusCode);
            }
        }
        catch (HttpRequestException ex)
        {
            preStreamError = $"連線 AI 端點失敗：{ex.Message}";
        }

        if (preStreamError is not null)
        {
            response?.Dispose();
            yield return new AiStreamEvent(AiStreamEventType.Error, preStreamError);
            yield break;
        }

        var accumulated = new StringBuilder();
        var resp = response!;
        using (resp)
        await using (var stream = await resp.Content.ReadAsStreamAsync(ct))
        using (var reader = new StreamReader(stream, Encoding.UTF8))
        {
            string? line;
            while ((line = await reader.ReadLineAsync(ct)) is not null)
            {
                if (line.Length == 0 || !line.StartsWith("data:", StringComparison.Ordinal))
                {
                    continue;
                }

                var data = line[5..].Trim();
                if (data.Length == 0)
                {
                    continue;
                }
                if (data == "[DONE]")
                {
                    break;
                }

                var (delta, midStreamError) = ParseChunk(data);
                if (midStreamError is not null)
                {
                    yield return new AiStreamEvent(AiStreamEventType.Error, midStreamError);
                    yield break;
                }
                if (!string.IsNullOrEmpty(delta))
                {
                    accumulated.Append(delta);
                    yield return new AiStreamEvent(AiStreamEventType.Delta, delta, line);
                }
            }
        }

        yield return new AiStreamEvent(AiStreamEventType.Completed, accumulated.ToString());
    }

    /// <summary>
    /// 解析一則 SSE chunk：取 choices[0].delta.content；若帶 error 物件則回傳錯誤訊息；解析失敗回 (null, null) 略過。
    /// </summary>
    private static (string? Delta, string? Error) ParseChunk(string data)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(data);
        }
        catch (JsonException)
        {
            return (null, null);
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return (null, null);
            }

            var errorMessage = OpenAiResponseParsing.TryGetErrorMessage(root);
            if (errorMessage is not null)
            {
                return (null, $"AI 端點回報錯誤：{errorMessage}");
            }

            if (root.TryGetProperty("choices", out var choices)
                && choices.ValueKind == JsonValueKind.Array
                && choices.GetArrayLength() > 0)
            {
                var first = choices[0];
                if (first.TryGetProperty("delta", out var delta)
                    && delta.TryGetProperty("content", out var content)
                    && content.ValueKind == JsonValueKind.String)
                {
                    return (content.GetString(), null);
                }
            }

            return (null, null);
        }
    }

    /// <summary>
    /// 從錯誤回應 body 取出友善訊息（容錯物件 / 陣列外型，見 <see cref="OpenAiResponseParsing"/>）。
    /// </summary>
    private static string ExtractError(string body, int statusCode)
        => OpenAiResponseParsing.ExtractError(body, statusCode, "AI 端點錯誤");
}
