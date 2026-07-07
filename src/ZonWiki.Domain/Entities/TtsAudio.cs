namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一筆筆記朗讀語音的快取品（其他功能群 Phase 2・TTS v1）。
///
/// 定位與慣例：
/// - 這是「可完全由筆記內容再生」的<b>快取產物</b>（非使用者主資料）：故<b>不</b>登記進
///   <c>TrashTypeRegistry</c>（進垃圾桶語意錯誤）與 <c>ActivityLogInterceptor</c>（會灌活動流），
///   見準則 §2.3、設計書 §9。
/// - 繼承 <see cref="AuditableEntity"/>＋實作 <see cref="IUserOwned"/> → 自動獲得六稽核欄、
///   使用者隔離全域過濾、fail-closed 具現化攔截器，欄名一律 <c>TtsAudio_{Property}</c>。
/// - 一律軟刪除（ValidFlag=false）；快取鍵 <see cref="ContentHash"/> 見 <c>TtsSynthesisService.ComputeContentHash</c>。
/// - 時間一律以 UTC 儲存。
/// </summary>
public class TtsAudio : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此音檔的使用者識別碼。對應資料表欄位 TtsAudio_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 來源筆記識別碼（可空；單向關聯 FK→Note，Restrict＝不連鎖硬刪）。v1 一律有值。
    /// 供「同一筆記＋同一聲音重新合成即失效舊列」的清理查詢（見 <see cref="VoiceName"/>）。
    /// </summary>
    public Guid? NoteId { get; set; }

    /// <summary>
    /// 快取鍵（SHA-256 十六進位小寫）。以「筆記內容正規化＋聲音＋語言＋格式＋口語化 prompt 版本＋TTS 模型代號」
    /// 計算（見 <c>TtsSynthesisService.ComputeContentHash</c>）。唯一索引 (UserId, ContentHash) 不含 ValidFlag。
    /// </summary>
    public string ContentHash { get; set; } = string.Empty;

    /// <summary>
    /// 口語稿（segments JSON 字串）。由 VertexAdc 依 Markdown 產出，供除錯與再利用。
    /// </summary>
    public string ScriptJson { get; set; } = string.Empty;

    /// <summary>
    /// 章節（標題＋時間位移）JSON 字串；可空。無標題（口語稿無章節切點）時為 null。
    /// 每項形狀為 <c>{ "title": "第一節：…", "startSeconds": 0.0 }</c>（前端章節列表點擊即跳段）。
    /// </summary>
    public string? ChaptersJson { get; set; }

    /// <summary>
    /// 合成狀態："processing"（合成中）／"ready"（就緒可播）／"failed"（失敗）。
    /// 沿用 AiSession 以字串表示狀態的慣例。
    /// </summary>
    public string Status { get; set; } = "processing";

    /// <summary>
    /// 聲音代號（Gemini-TTS voice.name，如 "Kore"）。入快取鍵。
    /// </summary>
    public string VoiceName { get; set; } = string.Empty;

    /// <summary>
    /// TTS 模型代號（如 "gemini-2.5-flash-tts"）。入快取鍵。
    /// </summary>
    public string ModelKey { get; set; } = string.Empty;

    /// <summary>
    /// 音檔磁碟相對路徑（相對於 ContentRoot），例如 App_Data/tts-cache/{id}.mp3。
    /// 由伺服器以列 Id 生成（非使用者輸入）→ 無路徑穿越風險。
    /// </summary>
    public string FilePath { get; set; } = string.Empty;

    /// <summary>
    /// 內容型別（MIME），例如 audio/mpeg（MP3）或 audio/ogg（OGG_OPUS）。
    /// </summary>
    public string ContentType { get; set; } = "audio/mpeg";

    /// <summary>
    /// 總時長（秒；ready 時填，ffprobe 量測；不可用時為 null，前端可靠 &lt;audio&gt;.duration）。
    /// </summary>
    public double? DurationSeconds { get; set; }

    /// <summary>
    /// 音檔位元組數（ready 時填）。
    /// </summary>
    public long SizeBytes { get; set; }

    /// <summary>
    /// 失敗安全摘要（僅供除錯；不含 token／堆疊；≤500 字）。Status="failed" 時填。
    /// </summary>
    public string? ErrorText { get; set; }

    /// <summary>
    /// 導覽屬性：來源筆記（單向；可空）。
    /// </summary>
    public Note? Note { get; set; }
}
