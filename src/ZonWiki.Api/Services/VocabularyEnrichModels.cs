namespace ZonWiki.Api.Services;

/// <summary>
/// 單字補釋義的結果。<see cref="Success"/>=false 表示需降級——端點據此仍存 word、僅不填釋義（優雅降級）。
/// </summary>
/// <param name="Success">是否成功補上釋義（false＝壞 JSON／解析失敗→降級）。</param>
/// <param name="Phonetic">音標（IPA；可空）。</param>
/// <param name="PartOfSpeech">詞性（可空）。</param>
/// <param name="DefinitionEn">英文釋義（可空）。</param>
/// <param name="DefinitionZh">中文釋義（可空）。</param>
/// <param name="ExampleSentence">例句（可空）。</param>
/// <param name="Reasoning">LLM 的推理過程（僅供除錯／記錄；不入庫）。</param>
public sealed record VocabularyEnrichmentOutcome(
    bool Success,
    string? Phonetic,
    string? PartOfSpeech,
    string? DefinitionEn,
    string? DefinitionZh,
    string? ExampleSentence,
    string? Reasoning)
{
    /// <summary>
    /// 建立「降級」結果（補釋義失敗）：Success=false、各釋義欄 null，供端點仍存 word、不填釋義。
    /// </summary>
    /// <param name="reason">可選的降級原因（供記錄）。</param>
    /// <returns>降級用的補釋義結果。</returns>
    public static VocabularyEnrichmentOutcome Degraded(string? reason = null) =>
        new(false, null, null, null, null, null, reason);
}

/// <summary>
/// 單字補釋義過程中「供應者回報硬錯誤（Error 事件）」時拋出的例外。
/// 端點攔截此例外後走降級路（word 已存、僅不填釋義，絕不回 500）。
/// </summary>
public sealed class VocabularyEnrichException : Exception
{
    /// <summary>
    /// 以錯誤訊息建立補釋義例外。
    /// </summary>
    /// <param name="message">錯誤訊息（通常來自 AI 供應者的 Error 事件）。</param>
    public VocabularyEnrichException(string message) : base(message)
    {
    }
}
