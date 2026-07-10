namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記內容上方的「浮層元件」（疊在內文最上層、可隨意擺放）。
/// 與被移除的舊「浮動白板」不同：本浮層持久化於資料庫（跨裝置、可備份），不再只存 localStorage。
///
/// Kind 決定型別與使用的欄位：
/// - "sticky"：便利貼 → 用 <see cref="Text"/> + <see cref="Color"/>，可拖曳/縮放定位。
/// - "text"：純文字框（Snipaste 風格）→ 文字存 <see cref="Text"/>、樣式（背景/字級/旋轉）存 <see cref="DataJson"/>；與開問啦畫布共用同一套標註型別。
/// - "drawing"：手繪塗鴉層 → 用 <see cref="DataJson"/> 存筆畫（一篇筆記一個，覆蓋整個內文區）。
/// - "slide"：圖片輪播 → 用 <see cref="DataJson"/> 存圖片網址清單，可拖曳/縮放定位。
/// 位置/尺寸以「相對於內文容器左上角的像素」儲存（X/Y/Width/Height），ZIndex 決定疊放順序。
///
/// 「問題」屬性（<see cref="IsQuestion"/> / <see cref="QuestionAnswer"/>）僅適用於 "sticky" 與 "text"：
/// 使用者可把一張便利貼或一個文字框標記為「問題」，之後在問題清單集中檢視、答題（手寫或請 AI 回答）。
/// </summary>
public class NoteOverlayItem : AuditableEntity, IUserOwned
{
    /// <summary>
    /// <see cref="Text"/> 欄位的最大長度（字元）。
    /// DB 層上限（HasMaxLength）與應用層驗證（如 ask-question 的問題長度檢查）共用此常數，
    /// 避免兩處魔術數字各自漂移。
    /// </summary>
    public const int TextMaxLength = 4000;

    /// <summary>
    /// 擁有此浮層元件的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 元件型別："sticky"（便利貼）/ "text"（文字框）/ "drawing"（塗鴉層）/ "slide"（圖片輪播）。
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

    /// <summary>
    /// 是否被標記為「問題」（僅 sticky / text 適用；預設 false）。
    /// 被標記者會出現在「問題清單」中，供使用者集中答題（手寫或請 AI 回答）。
    /// </summary>
    public bool IsQuestion { get; set; }

    /// <summary>
    /// 問題的回答內容（可空；使用者手寫或 AI 產生後儲存）。
    /// 空字串／null 皆視為「尚未作答」。內容可能是較長的 Markdown，故不設長度上限。
    /// </summary>
    public string? QuestionAnswer { get; set; }
}
