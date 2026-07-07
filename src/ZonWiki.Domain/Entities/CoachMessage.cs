namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一則教練對話逐字稿（其他功能群 Phase 3・英文教練）——屬於某一場 <see cref="CoachSession"/>。
///
/// 定位與慣例：
/// - 繼承 <see cref="AuditableEntity"/>＋實作 <see cref="IUserOwned"/> → 自動獲得六稽核欄、
///   使用者隔離全域過濾、fail-closed 具現化攔截器，欄名一律 <c>CoachMessage_{Property}</c>。
/// - 一律以 UTC 儲存時間；一律軟刪除。
/// - <b>不</b>登記進垃圾桶白名單與活動流（每場數十則，登記會灌爆；見 <see cref="CoachSession"/> summary）。
/// - <b>barge-in 落地</b>（【審修-F4】）：使用者插話打斷時，仍存「完整 outputTranscription」＋
///   <see cref="InterruptedFlag"/>=true ＋前端回報的近似截點 <see cref="ApproxCutChars"/>，
///   <b>不宣稱截到精準已播位置</b>（後端無從得知瀏覽器 audio-streamer 的實際播放 sample）。
/// </summary>
public class CoachMessage : AuditableEntity, IUserOwned
{
    /// <summary>角色字串常數：使用者（學習者）。</summary>
    public const string RoleUser = "user";

    /// <summary>角色字串常數：教練（模型）。</summary>
    public const string RoleAssistant = "assistant";

    /// <summary>
    /// 擁有此訊息的使用者識別碼。對應資料表欄位 CoachMessage_UserId。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬教練場次識別碼（FK→CoachSession；禁止硬刪連鎖）。
    /// </summary>
    public Guid CoachSessionId { get; set; }

    /// <summary>
    /// 角色："user"（學習者）／"assistant"（教練）。
    /// </summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>
    /// 逐字稿內容（純文字；無界 text）。assistant 側為完整 outputTranscription。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 糾錯卡 JSON（可空；show_correction Function Call 組出，僅 assistant 訊息可能有）。
    /// </summary>
    public string? CorrectionJson { get; set; }

    /// <summary>
    /// 本場內的序號（自 DB max(SeqNo)+1 種子，唯一索引 (CoachSessionId, SeqNo) 為單寫者防呆背板）。
    /// </summary>
    public int SeqNo { get; set; }

    /// <summary>
    /// 是否被使用者插話打斷（barge-in）。true＝本則 assistant 音訊在播放中被打斷。
    /// </summary>
    public bool InterruptedFlag { get; set; }

    /// <summary>
    /// 前端回報的近似截斷字元位置（可空；barge-in 時前端依 audio-streamer 排程進度估算，非精準對齊）。
    /// </summary>
    public int? ApproxCutChars { get; set; }

    /// <summary>
    /// 導覽屬性：所屬教練場次。
    /// </summary>
    public CoachSession? CoachSession { get; set; }
}
