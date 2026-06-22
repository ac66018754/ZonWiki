namespace ZonWiki.Domain.Entities;

/// <summary>
/// 快速捕捉項目「衍生出的筆記 / 任務」關聯（一個捕捉可衍生多筆，不限筆數）。
/// 供首頁捕捉分流彈窗顯示「這則捕捉過去新增過哪些筆記 / Todo」。
/// </summary>
public class CaptureLink : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 來源捕捉項目識別碼。
    /// </summary>
    public Guid CaptureItemId { get; set; }

    /// <summary>
    /// 衍生目標型別："note"（筆記）或 "taskcard"（任務）。
    /// </summary>
    public string TargetType { get; set; } = string.Empty;

    /// <summary>
    /// 衍生目標識別碼（對應 Note.Id 或 TaskCard.Id）。
    /// </summary>
    public Guid TargetId { get; set; }

    /// <summary>
    /// 導覽屬性：來源捕捉項目。
    /// </summary>
    public CaptureItem? CaptureItem { get; set; }
}
