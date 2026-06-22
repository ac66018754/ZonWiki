namespace ZonWiki.Domain.Entities;

/// <summary>
/// 任務卡片之間的關聯（對等、無上下級關係）。
/// 用來表達「這兩張卡片相關」。預設視為無方向（雙向）關聯。
/// </summary>
public class TaskRelation : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 關聯來源卡片識別碼。
    /// </summary>
    public Guid SourceTaskCardId { get; set; }

    /// <summary>
    /// 關聯目標卡片識別碼。
    /// </summary>
    public Guid TargetTaskCardId { get; set; }

    /// <summary>
    /// 關聯種類（預設 "related"，對等關係）。預留日後擴充。
    /// </summary>
    public string Kind { get; set; } = "related";

    /// <summary>
    /// 導覽屬性：來源卡片。
    /// </summary>
    public TaskCard? SourceTaskCard { get; set; }

    /// <summary>
    /// 導覽屬性：目標卡片。
    /// </summary>
    public TaskCard? TargetTaskCard { get; set; }
}
