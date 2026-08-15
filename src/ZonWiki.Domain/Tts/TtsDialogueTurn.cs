namespace ZonWiki.Domain.Tts;

/// <summary>
/// 雙主持人 Podcast 對談腳本的一個發話回合（其他功能群 Phase 3）。
/// </summary>
/// <param name="Speaker">
/// 講者標記，只允許 <c>"A"</c> 或 <c>"B"</c>（對應多講者 TTS 的 speakerAlias；映射到 voiceA／voiceB）。
/// </param>
/// <param name="Text">此回合要朗讀的純文字（不含 Markdown 記號、不含 SSML）。</param>
public sealed record TtsDialogueTurn(string Speaker, string Text)
{
    /// <summary>講者 A 的標記字串常數。</summary>
    public const string SpeakerA = "A";

    /// <summary>講者 B 的標記字串常數。</summary>
    public const string SpeakerB = "B";

    /// <summary>把任意講者字串正規化為 "A"／"B"（非 B 一律視為 A，保底不留未定義講者）。</summary>
    /// <param name="raw">原始講者字串。</param>
    /// <returns>正規化後的講者標記（"A" 或 "B"）。</returns>
    public static string NormalizeSpeaker(string? raw)
        => string.Equals(raw?.Trim(), SpeakerB, System.StringComparison.OrdinalIgnoreCase)
            ? SpeakerB
            : SpeakerA;
}
