namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記內文的「文字標註」（富文字註記）。同一段文字可同時擁有多筆不同種類的標註。
/// 以「錨點文字＋字元位移＋前後文窗」定位選取的片段（不嵌入內文），內容編輯後可重新定位（reAnchor）；
/// 找不到時標為 Detached（保留紀錄但視覺停用）。
///
/// Kind 決定使用哪些欄位：
/// - "highlight"：畫重點 → 用 <see cref="Color"/>。
/// - "link"：做關聯 → 用 <see cref="TargetType"/> + <see cref="TargetId"/>（或外部網址 <see cref="TargetUrl"/>）。
/// - "annotation"：寫備註 → 用 <see cref="Text"/>。
/// </summary>
public class NoteMark : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此標註的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 標註種類："highlight"（重點）/ "link"（關聯）/ "annotation"（備註）。
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    // ── 錨點（定位選取的文字片段；與前端 anchor 工具一致）──

    /// <summary>
    /// 選取的文字（用於重新定位）。
    /// </summary>
    public string AnchorText { get; set; } = string.Empty;

    /// <summary>
    /// 選取在「內文純文字」中的起始字元位移。
    /// </summary>
    public int AnchorStart { get; set; }

    /// <summary>
    /// 選取在「內文純文字」中的結束字元位移（不含）。
    /// </summary>
    public int AnchorEnd { get; set; }

    /// <summary>
    /// 前文窗（上下文，用於容忍編輯造成的位移）。
    /// </summary>
    public string AnchorPrefix { get; set; } = string.Empty;

    /// <summary>
    /// 後文窗（上下文）。
    /// </summary>
    public string AnchorSuffix { get; set; } = string.Empty;

    /// <summary>
    /// 內文編輯後找不到錨點時為 true（標註保留、但視覺上停用）。
    /// </summary>
    public bool Detached { get; set; }

    // ── highlight ──

    /// <summary>
    /// 畫重點顏色鍵（yellow / pink / blue / green / purple）；僅 highlight 使用。
    /// </summary>
    public string? Color { get; set; }

    // ── link ──

    /// <summary>
    /// 關聯目標型別："note" / "taskcard" / "node" / "url"；僅 link 使用。
    /// </summary>
    public string? TargetType { get; set; }

    /// <summary>
    /// 關聯目標實體識別碼（note / taskcard / node）；外部網址型別時為 null。
    /// </summary>
    public Guid? TargetId { get; set; }

    /// <summary>
    /// 外部網址（TargetType = "url" 時使用）。
    /// </summary>
    public string? TargetUrl { get; set; }

    // ── annotation ──

    /// <summary>
    /// 備註文字（僅 annotation 使用）。
    /// </summary>
    public string? Text { get; set; }
}
