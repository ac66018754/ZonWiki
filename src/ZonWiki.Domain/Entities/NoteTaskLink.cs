namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記與任務卡片的多對多關聯（一篇筆記可連到多張卡片，反之亦然）。
/// </summary>
public class NoteTaskLink : AuditableEntity, IUserOwned
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
    /// 任務卡片識別碼。
    /// </summary>
    public Guid TaskCardId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的筆記。
    /// </summary>
    public Note? Note { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的任務卡片。
    /// </summary>
    public TaskCard? TaskCard { get; set; }
}
