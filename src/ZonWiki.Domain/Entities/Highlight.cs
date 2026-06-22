namespace ZonWiki.Domain.Entities;

/// <summary>
/// 重點標記（畫重點）：在某節點內容上標記一段文字並指定顏色。
/// 與行內連結共用相同的穩健重新定位策略（AnchorText + 位移 + 前後文）。
/// </summary>
public class Highlight : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此重點標記的使用者識別碼（與所屬 Node→Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬節點外鍵。
    /// </summary>
    public Guid NodeId { get; set; }

    /// <summary>
    /// 被標記的原文（重新定位的主要依據）。
    /// </summary>
    public string AnchorText { get; set; } = string.Empty;

    /// <summary>
    /// 起始字元位移。
    /// </summary>
    public int Start { get; set; }

    /// <summary>
    /// 結束字元位移。
    /// </summary>
    public int End { get; set; }

    /// <summary>
    /// 錨點前文窗（消歧用）。
    /// </summary>
    public string AnchorPrefix { get; set; } = string.Empty;

    /// <summary>
    /// 錨點後文窗（消歧用）。
    /// </summary>
    public string AnchorSuffix { get; set; } = string.Empty;

    /// <summary>
    /// 重點顏色（預設 yellow）。
    /// </summary>
    public string Color { get; set; } = "yellow";

    /// <summary>
    /// 是否已脫錨：節點內容編輯後找不到原文時設為 true。
    /// </summary>
    public bool Detached { get; set; }

    /// <summary>
    /// 所屬節點（導覽屬性）。
    /// </summary>
    public Node? Node { get; set; }
}
