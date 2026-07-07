namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// 文字轉語音（TTS）服務抽象：把一段純文字合成成音檔位元組。
/// 介面形狀採「per-call 參數」（仿 <c>ITranscriptionService</c>）：聲音／語言／格式／模型皆為呼叫參數，
/// 便於同一實例服務不同聲音，也便於測試以 Fake 覆寫。
/// </summary>
public interface ITextToSpeechService
{
    /// <summary>
    /// 合成一段文字為音檔位元組（已 base64 解碼的原始音檔內容）。
    /// </summary>
    /// <param name="text">要合成的純文字（呼叫端需自行確保 ≤ 模型單次上限，如 4,000 bytes）。</param>
    /// <param name="voiceName">聲音代號（Gemini-TTS voice.name，如 "Kore"）。</param>
    /// <param name="languageCode">語言（BCP-47，如 "cmn-TW"）。</param>
    /// <param name="modelName">TTS 模型代號（如 "gemini-2.5-flash-tts"）。</param>
    /// <param name="audioEncoding">音檔編碼（如 "MP3" 或 "OGG_OPUS"）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>合成後的音檔位元組。</returns>
    /// <exception cref="TtsSynthesisException">合成失敗（非 2xx／ADC 不可用／回應無音檔內容）。</exception>
    Task<byte[]> SynthesizeAsync(
        string text,
        string voiceName,
        string languageCode,
        string modelName,
        string audioEncoding,
        CancellationToken cancellationToken);
}
