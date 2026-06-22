namespace ZonWiki.Domain.Entities;

/// <summary>
/// 常用連結卡（首頁的「常用連結」區塊）。使用者可建立多張卡片、點擊開啟對應網站。
/// 屬於某工作區、且屬於某位使用者（每人有自己的常用連結）。
/// </summary>
public class QuickLink : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此連結卡的使用者識別碼（每位使用者各自的常用連結）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 卡片標題（顯示文字）。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 目標網址（點擊卡片開啟）。
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// 圖示識別鍵（前端用來挑選顯示的 icon，可空）。nullable。
    /// </summary>
    public string? IconKey { get; set; }

    /// <summary>
    /// 分類（自由文字，常用連結自有的分組標籤；非與筆記/任務共用）。可空＝未分類。
    /// </summary>
    public string? Category { get; set; }

    /// <summary>
    /// 排序序號（數字越小越前面）。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 導覽屬性：此連結卡貼的標籤關聯（與筆記/任務共用同一套 <see cref="Tag"/> 標籤庫）。
    /// </summary>
    public ICollection<QuickLinkTag> QuickLinkTags { get; set; } = new List<QuickLinkTag>();
}
