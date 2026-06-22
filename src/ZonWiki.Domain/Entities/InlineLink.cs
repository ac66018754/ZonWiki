namespace ZonWiki.Domain.Entities;

/// <summary>
/// 行內連結：把某節點內容中的一段「被框選的文字」連到另一個（通常是 AI 回答的）節點。
/// 來源文字會變成可點擊，點擊即導覽到目標節點；目標節點也可反向導覽回此來源片段（雙向）。
/// 取代舊的浮動筆記概念：框選提問的回答改為一般節點 + 本連結。
/// 錨點以「渲染後純文字」的字元位移 + 前後文窗紀錄，於前端 render 時重新定位。
/// </summary>
public class InlineLink : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此行內連結的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬畫布外鍵。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// 來源節點外鍵（含可點擊文字的節點）。
    /// </summary>
    public Guid SourceNodeId { get; set; }

    /// <summary>
    /// 被框選、變成可點擊的文字。
    /// </summary>
    public string AnchorText { get; set; } = string.Empty;

    /// <summary>
    /// 錨點起始字元位移（渲染後純文字空間，提示用）。
    /// </summary>
    public int AnchorStart { get; set; }

    /// <summary>
    /// 錨點結束字元位移。
    /// </summary>
    public int AnchorEnd { get; set; }

    /// <summary>
    /// 錨點前文窗（消歧用）。
    /// </summary>
    public string AnchorPrefix { get; set; } = string.Empty;

    /// <summary>
    /// 錨點後文窗（消歧用）。
    /// </summary>
    public string AnchorSuffix { get; set; } = string.Empty;

    /// <summary>
    /// 目標節點外鍵（點擊來源文字後要導覽到的節點，通常為 AI 回答）。
    /// </summary>
    public Guid TargetNodeId { get; set; }

    /// <summary>
    /// 是否已脫錨：來源節點內容編輯後找不到原文時設為 true（連結保留供重新連結）。
    /// </summary>
    public bool Detached { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }

    /// <summary>
    /// 來源節點（導覽屬性）。
    /// </summary>
    public Node? SourceNode { get; set; }

    /// <summary>
    /// 目標節點（導覽屬性）。
    /// </summary>
    public Node? TargetNode { get; set; }
}
