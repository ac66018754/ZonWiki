namespace ZonWiki.Domain.Entities;

/// <summary>
/// 畫布上的一個框框（節點）。可能是問題、AI 回答或純筆記。
/// 內容以 Markdown 儲存且可編輯；以 ParentId 串成祖先脈絡供 AI 重建 context。
/// 屬於某位使用者（其所屬 Canvas 的擁有者）。
/// 為了讓「全域查詢過濾」與「使用者隔離最終防線攔截器」能對節點自動生效（縱深防禦：
/// 即使某查詢忘了 Join Canvas 也不外洩），此處冗餘存一份 UserId（與所屬 Canvas 一致，建立時自動帶入）。
/// </summary>
public class Node : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此節點的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬畫布的外鍵。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// 節點標題（可空；通常留白，內容自說明）。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 節點內容（Markdown）。可編輯。
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 父節點外鍵（自我參考）。用於重建祖先脈絡；根節點為 null。
    /// </summary>
    public Guid? ParentId { get; set; }

    /// <summary>
    /// 節點在畫布上的 X 座標。
    /// </summary>
    public double X { get; set; }

    /// <summary>
    /// 節點在畫布上的 Y 座標。
    /// </summary>
    public double Y { get; set; }

    /// <summary>
    /// 節點寬度（可空，未設則由前端自動量測）。
    /// </summary>
    public double? Width { get; set; }

    /// <summary>
    /// 節點高度（可空，未設則由前端自動量測）。
    /// </summary>
    public double? Height { get; set; }

    /// <summary>
    /// 疊放層級（z-order）。
    /// </summary>
    public int ZIndex { get; set; }

    /// <summary>
    /// 節點底色（可空）。
    /// </summary>
    public string? Color { get; set; }

    /// <summary>
    /// 此節點提問時偏好使用的 AI 模型別名（如 opus / sonnet / haiku）；可空，null 或空字串表示用 claude 預設模型。
    /// 由此節點發出的提問 / 追問會沿用此設定，並由產生的回答節點繼承，使整條對話脈絡模型一致。
    /// </summary>
    public string? Model { get; set; }

    /// <summary>
    /// 節點來源：<c>user</c>＝使用者手動建立（或追問時輸入的問題節點）；<c>ai</c>＝AI 文字回答節點；<c>image</c>＝AI 生成的圖片節點。
    /// 用來決定節點上要顯示哪些動作鈕（使用者節點才有「請AI回應 / 生圖」；AI 回答節點只有「提問」；圖片節點無提問鈕）。
    /// </summary>
    public string Origin { get; set; } = "user";

    /// <summary>
    /// 此節點所代表對話的 claude session 識別碼（由 AI 回答節點持有；用於後續以 --resume 接續）。可空。
    /// </summary>
    public Guid? AiSessionId { get; set; }

    /// <summary>
    /// 該 session 是否已被某次追問消耗。已消耗者，後續分支改以重建脈絡的全文 prompt，避免污染。
    /// </summary>
    public bool AiSessionConsumed { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }

    /// <summary>
    /// 父節點（導覽屬性）。
    /// </summary>
    public Node? Parent { get; set; }

    /// <summary>
    /// 子節點集合（導覽屬性）。
    /// </summary>
    public ICollection<Node> Children { get; set; } = new List<Node>();

    /// <summary>
    /// 此節點的編輯紀錄集合（導覽屬性）。
    /// </summary>
    public ICollection<NodeRevision> Revisions { get; set; } = new List<NodeRevision>();

    /// <summary>
    /// 此節點的生成圖片集合（導覽屬性）。
    /// </summary>
    public ICollection<NodeImage> Images { get; set; } = new List<NodeImage>();

    /// <summary>
    /// 此節點的重點標記集合（導覽屬性）。
    /// </summary>
    public ICollection<Highlight> Highlights { get; set; } = new List<Highlight>();
}
