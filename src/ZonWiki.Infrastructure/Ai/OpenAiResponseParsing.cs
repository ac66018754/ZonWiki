using System.Text.Json;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// OpenAI 相容端點的回應解析輔助（包含容錯外型與錯誤提取）。
/// </summary>
public static class OpenAiResponseParsing
{
    /// <summary>
    /// 從 JSON 物件試著取出 error.message；容錯物件與陣列外型。
    /// </summary>
    public static string? TryGetErrorMessage(JsonElement root)
    {
        if (root.TryGetProperty("error", out var error))
        {
            if (error.ValueKind == JsonValueKind.Object)
            {
                if (error.TryGetProperty("message", out var msg) && msg.ValueKind == JsonValueKind.String)
                {
                    return msg.GetString();
                }
            }
        }
        return null;
    }

    /// <summary>
    /// 從錯誤回應 body 解析並組成友善錯誤訊息。
    /// </summary>
    public static string ExtractError(string body, int statusCode, string prefix = "API 錯誤")
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var error = TryGetErrorMessage(doc.RootElement);
            if (error is not null)
            {
                return $"{prefix}（{statusCode}）：{error}";
            }
        }
        catch (JsonException)
        {
            // 落到下方回傳通用訊息。
        }
        return $"{prefix}（HTTP {statusCode}）";
    }
}
