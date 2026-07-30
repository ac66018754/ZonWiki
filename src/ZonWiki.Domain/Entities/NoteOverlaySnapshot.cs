namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記浮層的「手動版本快照」：使用者在右下角工具列按「儲存浮層」時，
/// 把該筆記當下的全部浮層元件（便利貼 / 文字框 / 塗鴉 / 圖片輪播）與文字標註（畫記）
/// 完整序列化保存一份，供未知覆寫時救援。
///
/// 設計要點（詳見 docs/DECISIONS.md 2026-07-30 第二批）：
/// - 「手動觸發」而非自動：浮層拖曳/塗鴉的變更頻率極高，自動快照會讓筆數爆炸——
///   由使用者決定「這一刻值得保存」，與筆記內文的 NoteRevision（每次存檔自動記）刻意不同。
/// - 「不去重」：即使內容與上一份快照相同也照存——使用者按下儲存＝明確的存檔意圖，
///   與 NoteRevision 的「同值不寫」語意相反，勿依姊妹功能慣例「順手」加去重。
/// - 內容由「伺服器端」讀取當下資料庫狀態序列化（不信任 client 上傳的 payload）。
/// - 快照不可變、不註冊進垃圾桶型別表（TrashTypeRegistry）——歷史紀錄不開放使用者自行刪除。
/// </summary>
public class NoteOverlaySnapshot : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 摘要欄位（<see cref="Summary"/>）的最大長度（字元）。
    /// </summary>
    public const int SummaryMaxLength = 200;

    /// <summary>
    /// 擁有此快照的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 所屬筆記識別碼。
    /// </summary>
    public Guid NoteId { get; set; }

    /// <summary>
    /// 快照序號（同一筆記內遞增；(NoteId, SnapshotNo) 唯一）。
    /// </summary>
    public int SnapshotNo { get; set; }

    /// <summary>
    /// 快照內容 JSON：{ overlayItems: [...], marks: [...] }——
    /// 浮層元件（含位置/尺寸/文字/DataJson）與文字標註的完整狀態。不限長度（塗鴉資料可能較大）。
    /// ⚠️ 本欄位可能引用附件短網址：AttachmentOrphanScanner 的引用判定必須涵蓋本欄位，
    /// 否則附件會被誤判孤兒回收、快照裡的圖變成壞圖。
    /// </summary>
    public string ItemsJson { get; set; } = string.Empty;

    /// <summary>
    /// 顯示用摘要（例如「便利貼2・文字框1・塗鴉1・畫記3」；空浮層為「（空浮層）」）。
    /// 建立當下計算固定，清單查詢不需反序列化 <see cref="ItemsJson"/>。
    /// </summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>
    /// 導覽屬性：所屬筆記。
    /// </summary>
    public Note? Note { get; set; }
}
