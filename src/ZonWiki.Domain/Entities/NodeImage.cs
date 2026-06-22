namespace ZonWiki.Domain.Entities;

/// <summary>
/// 節點的 AI 生成圖片。實際圖檔存於磁碟（App_Data/images），此處只存中繼資料；
/// 透過 /api/images/{id} 提供圖檔，節點內容以 Markdown 圖片語法嵌入顯示。
/// </summary>
public class NodeImage : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此圖片的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬節點外鍵。
    /// </summary>
    public Guid NodeId { get; set; }

    /// <summary>
    /// 所屬畫布外鍵（便於範圍查詢與清理）。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// 產生此圖所用的提示文字。
    /// </summary>
    public string Prompt { get; set; } = string.Empty;

    /// <summary>
    /// 產生此圖所用的模型代號。
    /// </summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>
    /// 磁碟相對路徑（相對於 ContentRoot），例如 App_Data/images/{id}.png。
    /// </summary>
    public string FilePath { get; set; } = string.Empty;

    /// <summary>
    /// 內容型別（MIME），例如 image/png。
    /// </summary>
    public string ContentType { get; set; } = "image/png";

    /// <summary>
    /// 所屬節點（導覽屬性）。
    /// </summary>
    public Node? Node { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }
}
