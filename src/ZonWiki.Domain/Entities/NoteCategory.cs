namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記與分類的多對多關聯表（一篇筆記可屬於多個分類）。先採正規化設計。
/// </summary>
public class NoteCategory : AuditableEntity, IUserOwned
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
    /// 分類識別碼。
    /// </summary>
    public Guid CategoryId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的筆記。
    /// </summary>
    public Note? Note { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的分類。
    /// </summary>
    public Category? Category { get; set; }
}
