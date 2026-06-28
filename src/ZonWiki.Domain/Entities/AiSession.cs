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
    /// 框選提問的來源筆記外鍵（可空；只在框選提問時設定）。
    /// </summary>
    public Guid? NoteId { get; set; }

    /// <summary>
    /// 產生的答案筆記外鍵（可空；框選提問成功時設定）。
    /// </summary>
    public Guid? AnswerNoteId { get; set; }

    /// <summary>
    /// 來源筆記上的 NoteMark（錨點）外鍵（可空；框選提問成功時設定）。
    /// </summary>
    public Guid? MarkId { get; set; }

    /// <summary>
    /// 使用者提問文字（可空；框選提問時用以在佇列上顯示，毋須解析 PromptText）。
    /// </summary>
    public string? QuestionText { get; set; }

    /// <summary>
    /// 框選的文字片段（可空；框選提問時填入，佇列上顯示選取上下文用）。
    /// </summary>
    public string? AnchorText { get; set; }

    /// <summary>
    /// 失敗訊息（可空；僅在 Status=Failed 時填入；不含堆疊/檔案路徑等敏感資訊）。
    /// </summary>
    public string? ErrorText { get; set; }

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
    /// 這次工作實際使用的「AI 供應者」標示（可空；例如 "Groq"、"Gemini（共用預設）"、"Claude CLI"）。
    /// 供使用者在「AI 處理佇列」看出是哪家提供商，失敗時較好回報問題。
    /// </summary>
    public string? AiProvider { get; set; }

    /// <summary>
    /// 這次工作實際使用的「模型代號」（可空；例如 "llama-3.3-70b-versatile"、"gemini-flash-lite"）。
    /// </summary>
    public string? AiModelId { get; set; }

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
