namespace ZonWiki.Domain.Entities;

/// <summary>
/// 任務卡片與標籤的多對多關聯表（一張卡片可貼多個標籤；一個標籤可貼到多張卡片）。
/// 刻意與筆記「共用同一套 <see cref="Tag"/> 標籤庫」——標籤體系跨筆記與任務統一，方便查詢。
/// </summary>
public class TaskTag : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 任務卡片識別碼。
    /// </summary>
    public Guid TaskCardId { get; set; }

    /// <summary>
    /// 標籤識別碼（指向與筆記共用的 Tag）。
    /// </summary>
    public Guid TagId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的任務卡片。
    /// </summary>
    public TaskCard? TaskCard { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的標籤。
    /// </summary>
    public Tag? Tag { get; set; }
}
