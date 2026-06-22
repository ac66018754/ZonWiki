namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記留言（支援整篇或範圍留言）。留言者即擁有者（UserId）。
/// </summary>
public class Comment : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 所屬筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 留言者（即擁有者）的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 留言內容。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 錨點類型："full"（整篇）或 "range"（針對某段文字範圍）。
    /// </summary>
    public string AnchorType { get; set; } = "full";

    /// <summary>
    /// 錨點資料（JSON；範圍留言時記錄選取文字與前後文窗以便 re-anchor）。nullable。
    /// </summary>
    public string? AnchorData { get; set; }

    /// <summary>
    /// 導覽屬性：所屬筆記。
    /// </summary>
    public Note? Note { get; set; }

    /// <summary>
    /// 導覽屬性：留言者。
    /// </summary>
    public User? User { get; set; }
}
