using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Tts;

/// <summary>
/// Gemini-TTS（gemini-2.5-flash-tts）30 個預建聲音的硬編清單（recon 實打 voices:list，設計書 §6.1）。
///
/// 說明：
/// - 使用 <c>modelName=gemini-2.5-flash-tts</c> 時「語言無關同一批聲音」（語言由 languageCode 決定），
///   故 <c>Language</c> 一律回目前預設 <c>cmn-TW</c>。
/// - <c>Label</c>（顯示標籤）v1 先給「性別聲・代號」佔位（前端 <c>formatVoiceLabel</c> 優先讀 <c>label</c>）；
///   <b>TODO</b>：確切風格標籤（如「女・清亮」「男・沉穩」）待 cmn-TW Gemini-TTS PoC 實聽後定案（監工職責）。
/// </summary>
public static class TtsVoiceCatalog
{
    /// <summary>預設語言（BCP-47）。</summary>
    public const string DefaultLanguage = "cmn-TW";

    private const string Female = "female";
    private const string Male = "male";

    /// <summary>
    /// 合法語言（BCP-47）白名單（審查修正 #4）：主語言 cmn-TW，加設計書 §6.1 退路階梯的少數 BCP-47。
    ///
    /// 為何要白名單：language 會進 (1) 付費 Cloud TTS 請求 body 的 <c>voice.languageCode</c>，
    /// 與 (2) 快取鍵 <c>ContentHash</c>。若不驗，使用者每次改 language 就對同筆記鑄造相異 ContentHash →
    /// 相異 processing 列 → 繞過「in-flight 去重」放大 DoS／燒 TTS 額度。故比照 voice/format 收斂為有限清單。
    /// </summary>
    private static readonly HashSet<string> ValidLanguageCodes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "cmn-TW", // 主語言（台灣華語，Gemini-TTS Preview）
            "cmn-CN", // 退路：Chirp 3 HD 華語（北京腔）
            "yue-HK", // 退路：粵語（香港）
            "en-US",  // 退路：Chirp 3 HD 英文
        };

    /// <summary>女聲代號（14 個，recon 清單）。</summary>
    private static readonly string[] FemaleVoiceNames =
    {
        "Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux",
        "Kore", "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr",
    };

    /// <summary>男聲代號（16 個，recon 清單）。</summary>
    private static readonly string[] MaleVoiceNames =
    {
        "Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus",
        "Orus", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi",
    };

    /// <summary>30 聲清單（14 女＋16 男），供 <c>GET /api/tts/voices</c> 直接回傳。</summary>
    public static readonly IReadOnlyList<VoiceDto> Voices = BuildVoices();

    /// <summary>合法聲音代號集合（供合成端點白名單驗證；不分大小寫）。</summary>
    private static readonly HashSet<string> ValidVoiceNames =
        new(Voices.Select(v => v.Name), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// 檢查聲音代號是否為 30 聲之一（不分大小寫）。
    /// </summary>
    /// <param name="voiceName">待檢查的聲音代號。</param>
    /// <returns>是合法聲音時為 true。</returns>
    public static bool IsValidVoice(string? voiceName)
        => !string.IsNullOrWhiteSpace(voiceName) && ValidVoiceNames.Contains(voiceName.Trim());

    /// <summary>
    /// 檢查語言代碼是否在白名單內（不分大小寫；審查修正 #4）。
    /// </summary>
    /// <param name="languageCode">待檢查的 BCP-47 語言代碼。</param>
    /// <returns>是合法語言時為 true。</returns>
    public static bool IsValidLanguage(string? languageCode)
        => !string.IsNullOrWhiteSpace(languageCode) && ValidLanguageCodes.Contains(languageCode.Trim());

    /// <summary>組出 30 聲的 <see cref="VoiceDto"/> 清單（女先男後）。</summary>
    private static List<VoiceDto> BuildVoices()
    {
        var voices = new List<VoiceDto>(FemaleVoiceNames.Length + MaleVoiceNames.Length);

        foreach (var name in FemaleVoiceNames)
        {
            voices.Add(new VoiceDto(name, Female, $"女聲・{name}", DefaultLanguage));
        }

        foreach (var name in MaleVoiceNames)
        {
            voices.Add(new VoiceDto(name, Male, $"男聲・{name}", DefaultLanguage));
        }

        return voices;
    }
}
