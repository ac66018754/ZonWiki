using System.Text;

namespace ZonWiki.Infrastructure.Tts;

/// <summary>
/// 測試用假 TTS：回固定可辨識、長度足夠（供 HTTP Range 測試）的音檔位元組，不做任何外呼。
/// 以設定 <c>Tts:Provider=Fake</c> 註冊（整合測試基座 <c>Tts__Provider=Fake</c>）。
/// </summary>
public sealed class FakeTextToSpeechService : ITextToSpeechService
{
    /// <summary>每次合成回傳的固定位元組長度（≥ Range 測試所需的 10 bytes）。</summary>
    public const int FakeChunkByteLength = 64;

    /// <inheritdoc />
    public Task<byte[]> SynthesizeAsync(
        string text,
        string voiceName,
        string languageCode,
        string modelName,
        string audioEncoding,
        CancellationToken cancellationToken)
    {
        // 產生「可辨識前綴＋固定長度」的位元組：前綴含聲音與文字長度，尾端補零到固定長度，
        // 讓整合測試既能驗證檔案有內容、又有足夠位元組數測 HTTP Range（bytes=0-9→206）。
        var prefix = Encoding.UTF8.GetBytes($"FAKETTS:{voiceName}:{text.Length}:");
        var buffer = new byte[FakeChunkByteLength];
        Array.Copy(prefix, buffer, Math.Min(prefix.Length, buffer.Length));
        return Task.FromResult(buffer);
    }
}
