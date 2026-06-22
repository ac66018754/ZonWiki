namespace ZonWiki.Domain.Entities;

/// <summary>
/// AI 提問過程中，從 claude stdout 解析出的單一串流事件 / 訊息。
/// 以 SeqNo 維持順序與去重，保留原始 JSON 行供除錯。
/// </summary>
public class AiMessage : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此訊息的使用者識別碼（與所屬 AiSession 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬 AiSession 外鍵。
    /// </summary>
    public Guid SessionId { get; set; }

    /// <summary>
    /// 角色 / 事件型別（assistant / result / error 等）。
    /// </summary>
    public string Role { get; set; } = "assistant";

    /// <summary>
    /// 訊息文字內容。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 對應的原始 stream-json 行（除錯用）。
    /// </summary>
    public string RawJsonLine { get; set; } = string.Empty;

    /// <summary>
    /// 單調遞增序號，用於串流順序與去重。
    /// </summary>
    public int SeqNo { get; set; }

    /// <summary>
    /// 所屬 AiSession（導覽屬性）。
    /// </summary>
    public AiSession? Session { get; set; }
}
