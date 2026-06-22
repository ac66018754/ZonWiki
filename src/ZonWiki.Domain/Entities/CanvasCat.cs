namespace ZonWiki.Domain.Entities;

/// <summary>
/// 畫布分類（為避免與筆記系統的 Category 衝突，改名為 CanvasCat）。
/// 畫布與分類為多對多（一個畫布可屬於多個分類，一個分類可含多個畫布）；
/// 分類與 System Prompt 也是多對多（分類可吃到多個 System Prompt）。
/// 屬於某位使用者，所以帶 UserId。
/// </summary>
public class CanvasCat : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此分類的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 分類名稱。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 此分類與畫布的多對多關聯（導覽屬性）。
    /// </summary>
    public ICollection<CanvasCategory> CanvasCategories { get; set; } = new List<CanvasCategory>();

    /// <summary>
    /// 此分類與 System Prompt 的多對多關聯（導覽屬性）。
    /// </summary>
    public ICollection<CategorySystemPrompt> CategorySystemPrompts { get; set; } = new List<CategorySystemPrompt>();
}
