namespace ZonWiki.Domain.Entities;

/// <summary>
/// 開問啦畫布上的「標註浮層元件」（疊在節點之上、隨畫布平移縮放）。
/// 與筆記浮層 <see cref="NoteOverlayItem"/> 對等，差別在於：本元件綁定「畫布 (Canvas)」而非筆記，
/// 且座標一律以「畫布座標 (flow coordinates)」儲存（非螢幕像素），故 pan/zoom 後仍與節點對齊。
///
/// Kind 決定型別與使用的欄位：
/// - "sticky"：便利貼 → 用 <see cref="Text"/> + <see cref="Color"/>，可拖曳/縮放定位。
/// - "drawing"：手繪塗鴉層 → 用 <see cref="DataJson"/> 存筆畫（一張畫布一個，覆蓋整片）。
/// - "slide"：圖片板 → 用 <see cref="DataJson"/> 存圖片清單（data URL 或網址），可拖曳/縮放定位。
/// 位置/尺寸以 X/Y/Width/Height（flow 座標）儲存，ZIndex 決定疊放順序。
/// </summary>
public class CanvasAnnotation : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此標註的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離全域過濾）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬畫布識別碼（外鍵）。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// 元件型別："sticky"（便利貼）/ "drawing"（塗鴉層）/ "slide"（圖片板）。
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// 左上 X 座標（畫布座標 / flow coords）。drawing 為整片覆蓋，通常為 0。
    /// </summary>
    public double X { get; set; }

    /// <summary>
    /// 左上 Y 座標（畫布座標 / flow coords）。
    /// </summary>
    public double Y { get; set; }

    /// <summary>
    /// 寬度（畫布座標單位）。
    /// </summary>
    public double Width { get; set; }

    /// <summary>
    /// 高度（畫布座標單位）。
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
    /// - drawing：筆畫陣列 [{ type, color, width, dash, points: [[x,y],…] }, …]（座標為 flow coords）。
    /// - slide：圖片清單 ["data:image/…", "https://…", …]。
    /// 不限長度（手繪資料可能較大）。
    /// </summary>
    public string? DataJson { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }
}
