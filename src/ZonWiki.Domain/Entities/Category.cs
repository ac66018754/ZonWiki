namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記分類（可階層）。匯入時對應 docs/notes-seed 的資料夾；之後可在網頁自由增刪。
/// 與筆記為多對多關係（透過 NoteCategory）。
/// </summary>
public class Category : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此分類的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 上層分類識別碼（nullable，最上層為 null）。
    /// </summary>
    public Guid? ParentId { get; set; }

    /// <summary>
    /// 分類名稱。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 匯入來源資料夾路徑（相對於 docs/notes-seed 根目錄；僅由匯入而來的分類有值，可空）。
    /// </summary>
    public string FolderPath { get; set; } = string.Empty;

    /// <summary>
    /// 手動排序序號（同一層級內由小到大排列）。預設 0；
    /// 由使用者在側欄「排序模式」拖曳調整，未排序時以名稱（Name）作為次要排序鍵。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 導覽屬性：上層分類。
    /// </summary>
    public Category? Parent { get; set; }

    /// <summary>
    /// 導覽屬性：下層分類清單。
    /// </summary>
    public ICollection<Category> Children { get; set; } = new List<Category>();

    /// <summary>
    /// 導覽屬性：此分類與筆記的多對多關聯。
    /// </summary>
    public ICollection<NoteCategory> NoteCategories { get; set; } = new List<NoteCategory>();

    /// <summary>
    /// 導覽屬性：此分類貼到的標籤（多對多關聯，透過 CategoryTag）。
    /// </summary>
    public ICollection<CategoryTag> CategoryTags { get; set; } = new List<CategoryTag>();
}
