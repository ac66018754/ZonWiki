namespace ZonWiki.Domain.Entities;

/// <summary>
/// 快速捕捉項目（Inbox 收件匣）。首頁與筆記頁共用的「零摩擦記下想法」入口：
/// 可打字或錄音先丟進來，之後再分流（歸檔）成筆記或任務。
/// </summary>
public class CaptureItem : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此捕捉項目的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 捕捉來源："web"（網頁打字）、"voice"（錄音）、"text"（其他文字管道）。
    /// </summary>
    public string Source { get; set; } = "web";

    /// <summary>
    /// 原始內容（打字文字，或錄音轉出的文字）。
    /// </summary>
    public string RawContent { get; set; } = string.Empty;

    /// <summary>
    /// 錄音檔路徑（source = voice 時）。nullable。
    /// </summary>
    public string? AudioPath { get; set; }

    /// <summary>
    /// 狀態："inbox"（待分流）或 "filed"（已歸檔）。
    /// </summary>
    public string Status { get; set; } = "inbox";

    /// <summary>
    /// 歸檔後的目標型別（例如 "note" 或 "taskcard"）。未歸檔時為 null。
    /// </summary>
    public string? FiledTargetType { get; set; }

    /// <summary>
    /// 歸檔後的目標識別碼（對應 Note.Id 或 TaskCard.Id）。未歸檔時為 null。
    /// </summary>
    public Guid? FiledTargetId { get; set; }
}
