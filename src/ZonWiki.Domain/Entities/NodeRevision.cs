namespace ZonWiki.Domain.Entities;

/// <summary>
/// 節點內容的編輯紀錄（每次內容變動留一筆）。供右側面板顯示「編輯記錄」。
/// 來源：created（建立時即有內容）、edited（使用者編輯）、ai（AI 生成完成）。
/// </summary>
public class NodeRevision : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此編輯紀錄的使用者識別碼（與所屬 Node→Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬節點外鍵。
    /// </summary>
    public Guid NodeId { get; set; }

    /// <summary>
    /// 該版本的內容快照。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 來源：created / edited / ai。
    /// </summary>
    public string Source { get; set; } = "edited";

    /// <summary>
    /// 所屬節點（導覽屬性）。
    /// </summary>
    public Node? Node { get; set; }
}
