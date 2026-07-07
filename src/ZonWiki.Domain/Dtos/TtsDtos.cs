namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 觸發筆記朗讀合成的請求（欄位皆可選；缺省時回退：使用者 tts-settings → 系統預設）。
/// </summary>
/// <param name="Voice">聲音代號（Gemini-TTS voice.name，如 "Kore"）；須為 30 聲之一。</param>
/// <param name="Language">語言（BCP-47，如 "cmn-TW"）。</param>
/// <param name="Format">音檔格式："MP3" 或 "OGG_OPUS"。</param>
public sealed record TtsSynthesizeRequest(
    string? Voice = null,
    string? Language = null,
    string? Format = null);

/// <summary>
/// 合成端點（POST /api/tts/notes/{noteId}/synthesize）的回應。
///
/// <b>契約鎖定（審查修正 #1）</b>：音檔主鍵欄名為 <see cref="TtsAudioId"/>（JSON <c>ttsAudioId</c>），
/// 與前端契約一致；前端據此輪詢 status／供檔／播放。
/// <b>契約鎖定（審查修正 #3）</b>：<b>快取命中的 ready 路徑</b>也一併回 <see cref="DurationSeconds"/> 與
/// <see cref="Chapters"/>，讓前端「重播零成本」時仍能顯示章節列表（不需再打一次 /status）。
/// </summary>
/// <param name="TtsAudioId">音檔列識別碼（JSON <c>ttsAudioId</c>）。</param>
/// <param name="Status">狀態："processing"（合成中，回 202）或 "ready"（快取命中，回 200）。</param>
/// <param name="DurationSeconds">總時長（秒；ready 時可能有值，processing 時為 null）。</param>
/// <param name="Chapters">章節列表（ready 且有章節時有值；processing 時為 null）。</param>
public sealed record TtsSynthesizeResponseDto(
    Guid TtsAudioId,
    string Status,
    double? DurationSeconds,
    IReadOnlyList<ChapterDto>? Chapters);

/// <summary>
/// 狀態輪詢端點（GET /api/tts/audio/{id}/status）的回應。
/// </summary>
/// <param name="TtsAudioId">音檔列識別碼（JSON <c>ttsAudioId</c>）。</param>
/// <param name="Status">狀態："processing"／"ready"／"failed"。</param>
/// <param name="DurationSeconds">總時長（秒；ready 時可能有值）。</param>
/// <param name="Chapters">章節列表（ready 且有章節時有值）。</param>
/// <param name="Error">失敗安全摘要（failed 時可能有值；不含敏感資訊）。</param>
public sealed record TtsStatusDto(
    Guid TtsAudioId,
    string Status,
    double? DurationSeconds,
    IReadOnlyList<ChapterDto>? Chapters,
    string? Error);

/// <summary>
/// 一個章節（標題＋時間位移）。
///
/// <b>契約鎖定（審查修正 #2）</b>：時間位移欄名為 <see cref="StartSeconds"/>（JSON <c>startSeconds</c>），
/// 與前端播放器 <c>audio.currentTime = chapter.startSeconds</c> 一致。
/// </summary>
/// <param name="Title">章節標題（來自口語稿 heading 片段）。</param>
/// <param name="StartSeconds">章節起始秒數（JSON <c>startSeconds</c>）。</param>
public sealed record ChapterDto(
    string Title,
    double StartSeconds);

/// <summary>
/// 一個可選聲音（GET /api/tts/voices 的元素）。
///
/// <b>契約鎖定（審查修正 #7）</b>：顯示標籤欄名為 <see cref="Label"/>（JSON <c>label</c>），
/// 與前端 <c>formatVoiceLabel</c> 優先讀取的欄位一致；風格標籤才會真正顯示。
/// </summary>
/// <param name="Name">聲音代號（合成時原樣送 voice.name，如 "Kore"）。</param>
/// <param name="Gender">性別："male" 或 "female"。</param>
/// <param name="Label">顯示標籤（風格文字，如「女・清亮」；JSON <c>label</c>）。</param>
/// <param name="Language">語言（BCP-47，如 "cmn-TW"）。</param>
public sealed record VoiceDto(
    string Name,
    string Gender,
    string Label,
    string Language);

/// <summary>
/// 使用者的 TTS 偏好設定（GET/PUT /api/me/tts-settings）。
///
/// <b>契約對齊</b>：欄名 <see cref="Voice"/>（JSON <c>voice</c>）／<see cref="Format"/>（<c>format</c>）
/// 與前端 <c>TtsSettings</c> 一致；<see cref="Voice"/> 一律回「已解析的預設聲音」（未設時回系統預設，非 null）。
/// </summary>
/// <param name="Voice">預設聲音代號。</param>
/// <param name="Language">預設語言（BCP-47）。</param>
/// <param name="Format">預設音檔格式（MP3／OGG_OPUS）。</param>
public sealed record TtsSettingsDto(
    string Voice,
    string Language,
    string Format);

/// <summary>
/// 更新 TTS 偏好設定的請求（欄位皆可選；只更新有給的欄位）。
/// </summary>
/// <param name="Voice">預設聲音代號（須為 30 聲之一）。</param>
/// <param name="Language">預設語言（BCP-47）。</param>
/// <param name="Format">預設音檔格式（MP3／OGG_OPUS）。</param>
public sealed record UpdateTtsSettingsRequest(
    string? Voice = null,
    string? Language = null,
    string? Format = null);
