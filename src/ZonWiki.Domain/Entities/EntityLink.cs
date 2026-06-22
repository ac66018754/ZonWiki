namespace ZonWiki.Domain.Entities;

/// <summary>
/// 通用的「實體之間雙向關聯」。可連接任務(taskcard)、子任務(subtask)、筆記(note)、開問啦節點(node)
/// 之中任意兩者（例如 任務↔筆記、子任務↔節點、筆記↔節點）。以「一筆代表雙向」儲存，
/// 查詢時兩個方向都比對（Source 或 Target 命中皆算）。
/// </summary>
public class EntityLink : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 來源實體型別："taskcard" / "subtask" / "note" / "node"。
    /// </summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>
    /// 來源實體識別碼。
    /// </summary>
    public Guid SourceId { get; set; }

    /// <summary>
    /// 目標實體型別："taskcard" / "subtask" / "note" / "node"。
    /// </summary>
    public string TargetType { get; set; } = string.Empty;

    /// <summary>
    /// 目標實體識別碼。
    /// </summary>
    public Guid TargetId { get; set; }

    /// <summary>
    /// 關聯種類（預設 "link"；保留供未來分類）。
    /// </summary>
    public string Kind { get; set; } = "link";
}
