namespace ZonWiki.Domain.Entities;

/// <summary>
/// 任務群組（看板的「分欄/群組」）。卡片可放進群組；Todo 也可放群組。
/// </summary>
public class TaskGroup : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此群組的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 群組名稱（例如「本週」、「專案 A」）。
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 群組顏色（前端標示用，可空）。nullable。
    /// </summary>
    public string? Color { get; set; }

    /// <summary>
    /// 排序序號（數字越小越前面）。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 導覽屬性：此群組底下的任務卡片。
    /// </summary>
    public ICollection<TaskCard> TaskCards { get; set; } = new List<TaskCard>();
}
