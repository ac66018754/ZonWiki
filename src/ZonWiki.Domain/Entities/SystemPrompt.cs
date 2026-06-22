namespace ZonWiki.Domain.Entities;

/// <summary>
/// 一段可重複使用的 System Prompt（系統提示）。可標記為全域（套用到所有畫布），
/// 或透過分類 / 畫布的多對多關聯被選用。提問時會把畫布生效的 System Prompt 注入給 AI。
/// 屬於某位使用者，所以帶 UserId 以實作多租戶資料隔離。
/// </summary>
public class SystemPrompt : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此 System Prompt 的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 顯示標題（供清單辨識）。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 提示內容（會送給 AI 作為系統提示）。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 是否為全域：true 表示套用到所有畫布（不需經分類或畫布選用）。
    /// </summary>
    public bool IsGlobal { get; set; }

    /// <summary>
    /// 此 System Prompt 與分類的多對多關聯（導覽屬性）。
    /// </summary>
    public ICollection<CategorySystemPrompt> CategorySystemPrompts { get; set; } = new List<CategorySystemPrompt>();

    /// <summary>
    /// 此 System Prompt 與畫布的多對多關聯（導覽屬性）。
    /// </summary>
    public ICollection<CanvasSystemPrompt> CanvasSystemPrompts { get; set; } = new List<CanvasSystemPrompt>();
}
