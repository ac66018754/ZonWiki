namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一次 AI 提問的稽核紀錄。採 one-shot 模型：每次提問即一筆 AiSession，
/// 完整保存實際送給 claude 的 prompt 與結果，方便在 MVP 測試階段 Review。
/// 屬於某位使用者，所以帶 UserId 以實作多租戶資料隔離。
/// </summary>
public class AiSession : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此 AI Session 的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬畫布外鍵（可空）。
    /// </summary>
    public Guid? CanvasId { get; set; }

    /// <summary>
    /// 發問來源節點外鍵（可空）。
    /// </summary>
    public Guid? AskNodeId { get; set; }

    /// <summary>
    /// 提問結果產生的節點外鍵（對節點提問時為 answer 節點；可空）。
    /// </summary>
    public Guid? ResultNodeId { get; set; }

    /// <summary>
    /// 提問種類：node（對整個節點提問）或 floatingnote（對選取片段提問）。
    /// </summary>
    public string Kind { get; set; } = "node";

    /// <summary>
    /// 實際送給 claude 的完整 prompt（供 Review 與除錯）。
    /// </summary>
    public string PromptText { get; set; } = string.Empty;

    /// <summary>
    /// 狀態：Running / Completed / Failed。
    /// </summary>
    public string Status { get; set; } = "Running";

    /// <summary>
    /// token 用量，以 JSON 字串保存。
    /// </summary>
    public string TokenUsageJson { get; set; } = "{}";

    /// <summary>
    /// 此次提問串流出的訊息集合（導覽屬性）。
    /// </summary>
    public ICollection<AiMessage> Messages { get; set; } = new List<AiMessage>();

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }

    /// <summary>
    /// 發問來源節點（導覽屬性）。
    /// </summary>
    public Node? AskNode { get; set; }

    /// <summary>
    /// 提問結果產生的節點（導覽屬性）。
    /// </summary>
    public Node? ResultNode { get; set; }
}
