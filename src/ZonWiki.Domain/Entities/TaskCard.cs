namespace ZonWiki.Domain.Entities;

/// <summary>
/// 任務卡片（日程規劃 / Todo 的基本單位，卡片式）。
/// 卡片之間可建立「對等關聯」(TaskRelation，無上下級)、可放進群組 (TaskGroup)、可與筆記多對多關聯。
/// 支援清單 / 看板 / 行事曆等多種檢視（由查詢與前端組合，無需額外欄位）。
/// 時間欄一律以 UTC 儲存。
/// </summary>
public class TaskCard : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此卡片的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 卡片標題。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 卡片內容（Markdown，可空）。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 狀態（看板分欄用）："todo"、"doing"、"done"…（預留可自訂）。
    /// </summary>
    public string Status { get; set; } = "todo";

    /// <summary>
    /// 優先度（0 = 無 / 最低，數字越大越重要；建議 0–3）。
    /// </summary>
    public int Priority { get; set; }

    /// <summary>
    /// 預計處理時間（UTC，nullable）。行事曆/排序用。
    /// </summary>
    public DateTime? PlannedDateTime { get; set; }

    /// <summary>
    /// 到期時間（UTC，nullable）。提醒/排序用。
    /// </summary>
    public DateTime? DueDateTime { get; set; }

    /// <summary>
    /// 所屬群組識別碼（nullable，未分組時為 null）。
    /// </summary>
    public Guid? GroupId { get; set; }

    /// <summary>
    /// 群組內 / 清單內的排序序號。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 重複規則（iCal RRULE 字串，nullable）。一次性任務為 null。
    /// </summary>
    public string? RecurrenceRule { get; set; }

    /// <summary>
    /// 父任務識別碼（nullable，自我參照）。null＝頂層任務；非 null＝某任務的「子任務」。
    /// 子任務與父任務是同一種實體（皆為 TaskCard），只是多了父子關係（#8 重構）。
    /// </summary>
    public Guid? ParentId { get; set; }

    /// <summary>
    /// 完成時間（UTC，nullable）。狀態轉為 done 時設為當下；離開 done 時清為 null。
    /// </summary>
    public DateTime? CompletedDateTime { get; set; }

    /// <summary>
    /// 導覽屬性：所屬群組（前端以「分類」呈現）。
    /// </summary>
    public TaskGroup? Group { get; set; }

    /// <summary>
    /// 導覽屬性：父任務（自我參照）。
    /// </summary>
    public TaskCard? Parent { get; set; }

    /// <summary>
    /// 導覽屬性：子任務（同為 TaskCard，其 ParentId 指向本卡）。
    /// </summary>
    public ICollection<TaskCard> Children { get; set; } = new List<TaskCard>();

    /// <summary>
    /// 導覽屬性：此卡片底下的舊版子任務（SubTask 表；#8 後保留為備份，不再用於顯示）。
    /// </summary>
    public ICollection<SubTask> SubTasks { get; set; } = new List<SubTask>();

    /// <summary>
    /// 導覽屬性：此卡片貼上的標籤關聯（多對多，與筆記共用 Tag）。
    /// </summary>
    public ICollection<TaskTag> TaskTags { get; set; } = new List<TaskTag>();
}
