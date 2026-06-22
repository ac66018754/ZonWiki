namespace ZonWiki.Domain.Entities;

/// <summary>
/// 子任務（任務卡片底下的「檢核清單項目」）。
/// 一張任務卡片（TaskCard）可包含多個子任務，用來把一件大任務拆成可逐項打勾的小步驟，
/// 並由「已完成數 / 總數」算出完成進度。子任務本身只有標題與是否完成，不另帶日期/狀態欄位
/// （刻意保持輕量，採「檢核清單」設計，而非完整的子卡片）。
/// </summary>
public class SubTask : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此子任務的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬任務卡片識別碼。
    /// </summary>
    public Guid TaskCardId { get; set; }

    /// <summary>
    /// 子任務標題（要做的小步驟描述）。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 是否已完成。true = 已打勾完成；false = 尚未完成。
    /// </summary>
    public bool IsDone { get; set; }

    /// <summary>
    /// 完成時間（UTC，可空）。打勾完成時設為當下；取消完成時清為 null。
    /// 建立時間沿用 <see cref="AuditableEntity.CreatedDateTime"/>。
    /// </summary>
    public DateTime? CompletedDateTime { get; set; }

    /// <summary>
    /// 在同一張卡片內的排序序號（數字越小越前面）。
    /// </summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// 導覽屬性：所屬的任務卡片。
    /// </summary>
    public TaskCard? TaskCard { get; set; }
}
