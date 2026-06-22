namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記分類與標籤的多對多關聯表（一個分類可貼多個標籤）。
/// 讓標籤不只能加在筆記上，也能加在分類上（第二維度組織方式延伸到分類）。
/// </summary>
public class CategoryTag : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 分類識別碼。
    /// </summary>
    public Guid CategoryId { get; set; }

    /// <summary>
    /// 標籤識別碼。
    /// </summary>
    public Guid TagId { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的分類。
    /// </summary>
    public Category? Category { get; set; }

    /// <summary>
    /// 導覽屬性：關聯的標籤。
    /// </summary>
    public Tag? Tag { get; set; }
}
