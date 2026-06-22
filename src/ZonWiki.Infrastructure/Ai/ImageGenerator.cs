using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 一張已產生的圖片：原始位元組與內容型別。
/// </summary>
/// <param name="Bytes">圖檔位元組。</param>
/// <param name="ContentType">MIME 型別（如 image/png）。</param>
public sealed record GeneratedImage(byte[] Bytes, string ContentType);

/// <summary>
/// OpenAI 相容的圖片生成。
///
/// TODO（暫時／2026-06-11）：banana 的 <c>/images/generations</c> 目前異常無法使用，故改走
/// <c>/chat/completions</c> 生圖——把提示當成一則 user 訊息送出，再從回應的 message 內容中
/// 解析出圖片（base64 data URI / Markdown 圖片連結 / 純 URL / 多模態 image_url 皆容錯）。
/// 待 banana 修復後，應改回 <c>/images/generations</c>（payload 改回 <c>{ model, prompt, n }</c>、
/// 解析改用 <see cref="ParseImagesEndpointPayload"/>）。<b>還原前請先詢問使用者。</b>
/// </summary>
public sealed class ImageGenerator
{
    // TODO（暫時）：banana /images/generations 修好後改回 "/images/generations"。
    private const string EndpointPath = "/chat/completions";

    private readonly HttpClient _http;
    private readonly string _endpoint;
    private readonly string _apiKey;
    private readonly string _modelId;
    private readonly int _timeoutSeconds;

    /// <summary>
    /// 建立圖片生成器。
    /// </summary>
    public ImageGenerator(HttpClient http, string baseUrl, string apiKey, string modelId, int timeoutSeconds = 300)
    {
        _http = http;
        _endpoint = baseUrl.TrimEnd('/') + EndpointPath;
        _apiKey = apiKey;
        _modelId = modelId;
        _timeoutSeconds = Math.Clamp(timeoutSeconds <= 0 ? 300 : timeoutSeconds, 10, 3600);
    }

    /// <summary>
    /// 依提示產生一張圖。失敗丟出 <see cref="InvalidOperationException"/>（含友善訊息）；
    /// 取消（使用者中斷 / 逾時）則拋出 <see cref="OperationCanceledException"/>。
    /// </summary>
    public async Task<GeneratedImage> GenerateAsync(string prompt, CancellationToken cancellationToken = default)
    {
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_timeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        var ct = linkedCts.Token;

        // TODO（暫時）：走 /chat/completions——提示當成一則 user 訊息。修復後改回 { model, prompt, n = 1 }。
        var payload = JsonSerializer.Serialize(new
        {
            model = _modelId,
            messages = new[] { new { role = "user", content = prompt } },
            stream = false,
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        using var response = await _http.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(ExtractError(body, (int)response.StatusCode));
        }

        // TODO（暫時）：解析 chat 回應中的圖片。修復後改回 ParseImagesEndpointPayload(body)。
        var (b64, url) = ParseChatImagePayload(body);
        if (!string.IsNullOrEmpty(b64))
        {
            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(b64);
            }
            catch (FormatException)
            {
                throw new InvalidOperationException("圖片端點回傳的 base64 影像資料格式錯誤。");
            }
            return new GeneratedImage(bytes, "image/png");
        }
        if (!string.IsNullOrEmpty(url))
        {
            // SSRF 防護：驗證 URL 不指向內部/本機服務。
            if (!IsUrlSafe(url))
            {
                throw new InvalidOperationException($"圖片 URL 被阻止（潛在的 SSRF 攻擊）：{url}");
            }

            using var imgResp = await _http.GetAsync(url, ct);
            imgResp.EnsureSuccessStatusCode();
            var bytes = await imgResp.Content.ReadAsByteArrayAsync(ct);
            var contentType = imgResp.Content.Headers.ContentType?.MediaType ?? "image/png";
            return new GeneratedImage(bytes, contentType);
        }

        throw new InvalidOperationException("圖片端點（/chat/completions）回應中找不到可用的影像（base64 / 連結皆無）。");
    }

    /// <summary>
    /// 從 <c>/chat/completions</c> 回應解析圖片：依序看 choices[0].message 的 images[]、content（字串或多模態陣列），
    /// 抽出 base64 data URI（→ b64）或圖片連結（→ url）。解析失敗回 (null, null)。
    /// </summary>
    private static (string? B64, string? Url) ParseChatImagePayload(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("choices", out var choices)
                || choices.ValueKind != JsonValueKind.Array
                || choices.GetArrayLength() == 0
                || !choices[0].TryGetProperty("message", out var message))
            {
                return (null, null);
            }

            // 1) 某些中轉站把圖放在 message.images[]（{ image_url: { url } } 或 { url }）。
            if (message.TryGetProperty("images", out var images) && images.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in images.EnumerateArray())
                {
                    var reference = item.TryGetProperty("image_url", out var iu) && iu.TryGetProperty("url", out var iuu)
                        ? iuu.GetString()
                        : item.TryGetProperty("url", out var u2) ? u2.GetString() : null;
                    var fromRef = FromImageReference(reference);
                    if (fromRef.B64 is not null || fromRef.Url is not null)
                    {
                        return fromRef;
                    }
                }
            }

            // 2) message.content：可能是純字串，或多模態陣列（含 image_url / text parts）。
            if (message.TryGetProperty("content", out var content))
            {
                if (content.ValueKind == JsonValueKind.String)
                {
                    return FromText(content.GetString());
                }
                if (content.ValueKind == JsonValueKind.Array)
                {
                    foreach (var part in content.EnumerateArray())
                    {
                        if (part.TryGetProperty("image_url", out var pu) && pu.TryGetProperty("url", out var puu))
                        {
                            var fromRef = FromImageReference(puu.GetString());
                            if (fromRef.B64 is not null || fromRef.Url is not null)
                            {
                                return fromRef;
                            }
                        }
                        if (part.TryGetProperty("text", out var pt) && pt.ValueKind == JsonValueKind.String)
                        {
                            var fromText = FromText(pt.GetString());
                            if (fromText.B64 is not null || fromText.Url is not null)
                            {
                                return fromText;
                            }
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
            // 落到下方回 (null, null)，由呼叫端丟出友善錯誤。
        }
        return (null, null);
    }

    /// <summary>
    /// 從一段文字裡抽圖片：base64 data URI → b64；Markdown 圖片或純 http(s) 連結 → url。
    /// </summary>
    private static (string? B64, string? Url) FromText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return (null, null);
        }

        var dataUri = Regex.Match(text, @"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)");
        if (dataUri.Success)
        {
            return (dataUri.Groups[1].Value, null);
        }
        var markdown = Regex.Match(text, @"!\[[^\]]*\]\((https?://[^\s)]+)\)");
        if (markdown.Success)
        {
            return (null, markdown.Groups[1].Value);
        }
        var bareUrl = Regex.Match(text, @"https?://[^\s)\]]+");
        if (bareUrl.Success)
        {
            return (null, bareUrl.Value);
        }
        return (null, null);
    }

    /// <summary>
    /// SSRF 防護：檢查 URL 是否安全（不指向內部/本機服務、不使用危險的協議或埠）。
    /// 允許的只有公開網際網路的 http(s) 協議。
    /// </summary>
    private static bool IsUrlSafe(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return false;
        }

        // 只允許 HTTP 與 HTTPS 協議。
        if (uri.Scheme != "http" && uri.Scheme != "https")
        {
            return false;
        }

        var host = uri.Host.ToLowerInvariant();

        // 阻止本機與私有 IP 範圍。
        if (host == "localhost"
            || host == "127.0.0.1"
            || host.StartsWith("192.168.")
            || host.StartsWith("10.")
            || host.StartsWith("172.")  // 172.16.0.0/12
            || host == "::1"             // IPv6 loopback
            || host == "[::1]"
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        // 阻止 AWS 與 GCP 的元資料端點。
        if (host == "169.254.169.254" || host == "metadata.google.internal")
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// 解析單一圖片參照字串：data URI → b64；http(s) → url。
    /// </summary>
    private static (string? B64, string? Url) FromImageReference(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference))
        {
            return (null, null);
        }
        if (reference.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var marker = reference.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
            if (marker >= 0)
            {
                return (reference[(marker + "base64,".Length)..], null);
            }
        }
        if (reference.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            return (null, reference);
        }
        return (null, null);
    }

    /// <summary>
    /// 【還原用】從 <c>/images/generations</c> 回應取出 data[0] 的 b64_json 或 url。
    /// banana 修復後，GenerateAsync 應改回呼叫此方法並把 endpoint / payload 一併還原。
    /// </summary>
    private static (string? B64, string? Url) ParseImagesEndpointPayload(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("data", out var data)
                && data.ValueKind == JsonValueKind.Array
                && data.GetArrayLength() > 0)
            {
                var first = data[0];
                var b64 = first.TryGetProperty("b64_json", out var b) && b.ValueKind == JsonValueKind.String ? b.GetString() : null;
                var url = first.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
                return (b64, url);
            }
        }
        catch (JsonException)
        {
            // 落到下方丟錯
        }
        return (null, null);
    }

    /// <summary>
    /// 從錯誤 body 取出友善訊息（容錯物件 / 陣列外型，見 <see cref="OpenAiResponseParsing"/>）。
    /// </summary>
    private static string ExtractError(string body, int statusCode)
        => OpenAiResponseParsing.ExtractError(body, statusCode, "圖片端點錯誤");
}
