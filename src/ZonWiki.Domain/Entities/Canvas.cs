namespace ZonWiki.Domain.Entities;

/// <summary>
/// 畫布（一個工作區 / 一張心智圖板）。所有節點、連線、AI 提問紀錄都歸屬於某個畫布。
/// 屬於某位使用者，所以帶 UserId 以實作多租戶資料隔離。
/// </summary>
public class Canvas : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此畫布的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 畫布標題。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 畫布描述（可選）。
    /// </summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// 畫布層級的 UI 狀態（縮放、平移等）以 JSON 字串保存。
    /// </summary>
    public string StateJson { get; set; } = "{}";

    /// <summary>
    /// 此畫布下的節點集合（導覽屬性）。
    /// </summary>
    public ICollection<Node> Nodes { get; set; } = new List<Node>();

    /// <summary>
    /// 此畫布下的連線集合（導覽屬性）。
    /// </summary>
    public ICollection<Edge> Edges { get; set; } = new List<Edge>();

    /// <summary>
    /// 此畫布與畫布分類的多對多關聯（導覽屬性）。
    /// </summary>
    public ICollection<CanvasCategory> CanvasCategories { get; set; } = new List<CanvasCategory>();

    /// <summary>
    /// 此畫布自選的 System Prompt（導覽屬性）。
    /// </summary>
    public ICollection<CanvasSystemPrompt> CanvasSystemPrompts { get; set; } = new List<CanvasSystemPrompt>();

    /// <summary>
    /// 此畫布下的行內連結集合（導覽屬性）。
    /// </summary>
    public ICollection<InlineLink> InlineLinks { get; set; } = new List<InlineLink>();
}
