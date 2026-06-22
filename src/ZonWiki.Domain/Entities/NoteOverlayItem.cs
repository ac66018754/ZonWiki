namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記內容上方的「浮層元件」（疊在內文最上層、可隨意擺放）。
/// 與被移除的舊「浮動白板」不同：本浮層持久化於資料庫（跨裝置、可備份），不再只存 localStorage。
///
/// Kind 決定型別與使用的欄位：
/// - "sticky"：便利貼 → 用 <see cref="Text"/> + <see cref="Color"/>，可拖曳/縮放定位。
/// - "drawing"：手繪塗鴉層 → 用 <see cref="DataJson"/> 存筆畫（一篇筆記一個，覆蓋整個內文區）。
/// - "slide"：圖片輪播 → 用 <see cref="DataJson"/> 存圖片網址清單，可拖曳/縮放定位。
/// 位置/尺寸以「相對於內文容器左上角的像素」儲存（X/Y/Width/Height），ZIndex 決定疊放順序。
/// </summary>
public class NoteOverlayItem : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此浮層元件的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 元件型別："sticky"（便利貼）/ "drawing"（塗鴉層）/ "slide"（圖片輪播）。
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// 左上 X 座標（相對內文容器，像素）。drawing 為整片覆蓋，通常為 0。
    /// </summary>
    public double X { get; set; }

    /// <summary>
    /// 左上 Y 座標（相對內文容器，像素）。
    /// </summary>
    public double Y { get; set; }

    /// <summary>
    /// 寬度（像素）。
    /// </summary>
    public double Width { get; set; }

    /// <summary>
    /// 高度（像素）。
    /// </summary>
    public double Height { get; set; }

    /// <summary>
    /// 疊放順序（越大越上層）。
    /// </summary>
    public int ZIndex { get; set; }

    /// <summary>
    /// 便利貼底色（sticky 用；十六進位或顏色鍵）。
    /// </summary>
    public string? Color { get; set; }

    /// <summary>
    /// 便利貼文字（sticky 用）。
    /// </summary>
    public string? Text { get; set; }

    /// <summary>
    /// 型別專屬資料的 JSON：
    /// - drawing：筆畫陣列 [{ color, width, points: [[x,y],…] }, …]。
    /// - slide：圖片網址陣列 ["https://…", …]。
    /// 不限長度（手繪資料可能較大）。
    /// </summary>
    public string? DataJson { get; set; }
}
