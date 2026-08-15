namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// Vertex AI 端點主機名的縱深防禦斷言（【審修-S6】）。
///
/// 用途：<see cref="CoachLiveClient"/> 在握手時會把「可存取整個 GCP 專案的 ADC access token」當作
/// Bearer 送出。若日後有人加了 <c>Coach:Region</c>／BaseUrl override、或讓使用者選 region 而污染了
/// 組出的 WebSocket URL，token 就可能被導向外部端點竊取。故在送 Bearer 之前，一律以此處的白名單斷言
/// 「組出的 host 確實是 Vertex 官方端點、且 scheme 為安全的 wss」，否則拒連。
///
/// 邏輯與 <c>AiProviderFactory.IsVertexBaseUrlAllowed</c>（REST 路徑用、要求 https）同源，
/// 差別僅在此處針對 Live WebSocket 要求 <c>wss</c>。刻意獨立成共用小類別、以單元測試釘死，
/// 避免各處各自重刻而漂移。
/// </summary>
public static class VertexHostGuard
{
    /// <summary>Vertex AI 官方端點的全域主機名（region=global 時使用，無 region 前綴）。</summary>
    public const string VertexOfficialHost = "aiplatform.googleapis.com";

    /// <summary>
    /// 斷言一個 WebSocket URL 指向 Vertex AI 官方端點且使用安全的 <c>wss</c> scheme。
    ///
    /// 允許：<c>wss://aiplatform.googleapis.com/...</c>（全域）或
    /// <c>wss://&lt;region&gt;-aiplatform.googleapis.com/...</c>（區域前綴，如 us-central1-aiplatform.googleapis.com）。
    /// 要求 region 前綴後必接「<c>-aiplatform.googleapis.com</c>」，可擋掉如
    /// <c>aiplatform.googleapis.com.evil.com</c>（結尾為 .evil.com）與無 dash 分隔的混淆主機。
    /// </summary>
    /// <param name="wsUrl">待檢查的 WebSocket URL 字串。</param>
    /// <returns>是 Vertex AI 官方 <c>wss</c> 端點時為 true。</returns>
    public static bool IsAllowedVertexWssUrl(string? wsUrl)
    {
        if (string.IsNullOrEmpty(wsUrl) || !Uri.TryCreate(wsUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        // Live API 一律走加密的 wss（不接受明文 ws；也不接受 https，Live 是 WebSocket 而非 REST）。
        if (!string.Equals(uri.Scheme, "wss", StringComparison.Ordinal))
        {
            return false;
        }

        var host = uri.Host.ToLowerInvariant();
        return host == VertexOfficialHost
            || host.EndsWith("-" + VertexOfficialHost, StringComparison.Ordinal);
    }
}
