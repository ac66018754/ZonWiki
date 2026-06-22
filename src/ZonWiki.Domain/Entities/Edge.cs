namespace ZonWiki.Domain.Entities;

/// <summary>
/// 兩個節點之間的連線。例如「從問題節點 → 其 AI 回答節點」。
/// </summary>
public class Edge : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此連線的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬畫布的外鍵。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// 來源節點外鍵。
    /// </summary>
    public Guid SourceNodeId { get; set; }

    /// <summary>
    /// 目標節點外鍵。
    /// </summary>
    public Guid TargetNodeId { get; set; }

    /// <summary>
    /// 連線種類（預設 default）。
    /// </summary>
    public string Kind { get; set; } = "default";

    /// <summary>
    /// 來源連接點（t/r/b/l，對應節點四邊；可空，預設由前端決定）。
    /// </summary>
    public string? SourceHandle { get; set; }

    /// <summary>
    /// 目標連接點（t/r/b/l；可空）。
    /// </summary>
    public string? TargetHandle { get; set; }

    /// <summary>
    /// 連線標籤（可空）。
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// 連線附加資料，以 JSON 字串保存。
    /// </summary>
    public string DataJson { get; set; } = "{}";

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }
}
