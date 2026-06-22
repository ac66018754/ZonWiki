namespace ZonWiki.Domain.Entities;

/// <summary>
/// 常用連結卡與標籤的多對多關聯表（一張連結卡可貼多個標籤；一個標籤可貼到多張連結卡）。
/// 刻意與筆記、任務「共用同一套 <see cref="Tag"/> 標籤庫」——標籤體系跨筆記/任務/常用連結統一，方便查詢。
/// </summary>
public class QuickLinkTag : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 常用連結卡識別碼。
    /// </summary>
    public Guid QuickLinkId { get; set; }

    /// <summary>
    /// 標籤識別碼（指向與筆記/任務共用的 Tag）。
    /// </summary>
    public Guid TagId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的常用連結卡。
    /// </summary>
    public QuickLink? QuickLink { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的標籤。
    /// </summary>
    public Tag? Tag { get; set; }
}
