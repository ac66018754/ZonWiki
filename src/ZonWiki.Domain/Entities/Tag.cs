namespace ZonWiki.Domain.Entities;

/// <summary>
/// 標籤（跨分類的第二維度組織方式）。屬於某工作區，可貼到多篇筆記上（透過 NoteTag 關聯表）。
/// </summary>
public class Tag : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此標籤的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 標籤名稱（同一使用者底下不重複）。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 手動排序序號（由小到大排列）。預設 0；
    /// 由使用者在側欄「標籤」分頁的「排序模式」拖曳調整，未排序時以名稱（Name）作為次要排序鍵。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 此標籤貼到的所有筆記（多對多關聯）。
    /// </summary>
    public ICollection<NoteTag> NoteTags { get; set; } = new List<NoteTag>();

    /// <summary>
    /// 此標籤貼到的所有分類（多對多關聯，透過 CategoryTag）。
    /// </summary>
    public ICollection<CategoryTag> CategoryTags { get; set; } = new List<CategoryTag>();

    /// <summary>
    /// 此標籤貼到的所有任務卡片（多對多關聯，透過 TaskTag）。
    /// </summary>
    public ICollection<TaskTag> TaskTags { get; set; } = new List<TaskTag>();

    /// <summary>
    /// 此標籤貼到的所有常用連結卡（多對多關聯，透過 QuickLinkTag）。
    /// </summary>
    public ICollection<QuickLinkTag> QuickLinkTags { get; set; } = new List<QuickLinkTag>();
}
