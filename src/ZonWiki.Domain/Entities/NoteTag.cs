namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記與標籤的多對多關聯表（一篇筆記可貼多個標籤）。
/// </summary>
public class NoteTag : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 標籤識別碼。
    /// </summary>
    public Guid TagId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的筆記。
    /// </summary>
    public Note? Note { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的標籤。
    /// </summary>
    public Tag? Tag { get; set; }
}
