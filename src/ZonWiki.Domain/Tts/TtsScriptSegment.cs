namespace ZonWiki.Domain.Tts;

/// <summary>
/// 口語稿的一個片段（由 Markdown 轉出的朗讀稿最小單位）。
/// </summary>
/// <param name="Kind">
/// 片段種類：
/// <list type="bullet">
/// <item><c>"heading"</c>：標題（作為<b>章節切點</b>，同時會被朗讀，其文字即章節標題）。</item>
/// <item><c>"speech"</c>：一般朗讀內文。</item>
/// </list>
/// </param>
/// <param name="Text">要朗讀的純文字（不含 Markdown 記號、不含 SSML）。</param>
public sealed record TtsScriptSegment(string Kind, string Text)
{
    /// <summary>標題片段的種類字串常數。</summary>
    public const string HeadingKind = "heading";

    /// <summary>一般朗讀片段的種類字串常數。</summary>
    public const string SpeechKind = "speech";

    /// <summary>此片段是否為標題（章節切點）。</summary>
    public bool IsHeading => string.Equals(Kind, HeadingKind, System.StringComparison.OrdinalIgnoreCase);
}
