namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// TTS 合成失敗例外。訊息一律為「安全摘要」（不含 access token、不含完整回應主體），
/// 由合成管線攔截後把音檔列標記為 failed。
/// </summary>
public sealed class TtsSynthesisException : Exception
{
    /// <summary>
    /// 以安全訊息建立合成失敗例外。
    /// </summary>
    /// <param name="message">安全的失敗摘要（不含敏感資訊）。</param>
    public TtsSynthesisException(string message) : base(message)
    {
    }

    /// <summary>
    /// 以安全訊息與內部例外建立合成失敗例外。
    /// </summary>
    /// <param name="message">安全的失敗摘要（不含敏感資訊）。</param>
    /// <param name="innerException">內部例外（供伺服器端除錯，不外流客戶端）。</param>
    public TtsSynthesisException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
