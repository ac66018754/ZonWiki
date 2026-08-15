namespace ZonWiki.Domain.Entities;

/// <summary>
/// 筆記附件（貼上/選檔上傳的圖片）。實際圖檔存於磁碟（App_Data/attachments），
/// 此處只存中繼資料；透過 GET /api/attachments/{id} 提供圖檔，
/// 筆記內文以 Markdown 圖片語法 <c>![圖片](/api/attachments/{id})</c> 引用（取代舊的 base64 內嵌）。
///
/// 設計要點（決策見 docs/DECISIONS.md 2026-07-08）：
/// - 不設 NoteId 外鍵：上傳當下筆記可能尚未儲存；引用關係由「內容字串掃描」維護
///   （孤兒附件由 <c>AttachmentOrphanCleanupService</c> 定期掃描軟刪除）。
/// - 上傳時 png/jpeg/webp/bmp 一律重編碼為 WebP（附帶清洗檔案內容）；gif 原樣保存（保留動畫）。
/// </summary>
public class NoteAttachment : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此附件的使用者識別碼（使用者隔離用）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 原始檔名（僅供顯示；已去除路徑成分並截斷長度，絕不用於落地路徑）。
    /// </summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>
    /// 磁碟相對路徑（相對於附件根目錄），例如 <c>{userId:N}/{id:N}.webp</c>。
    /// 落地檔名一律由系統產生（GUID），杜絕路徑穿越。
    /// </summary>
    public string FilePath { get; set; } = string.Empty;

    /// <summary>
    /// 內容型別（MIME），由伺服器實際解碼判定（不信任 client 宣稱），例如 image/webp、image/gif。
    /// </summary>
    public string ContentType { get; set; } = "image/webp";

    /// <summary>
    /// 落地後的檔案大小（bytes；重編碼後的實際大小，非上傳原檔大小）。
    /// </summary>
    public long FileSizeBytes { get; set; }

    /// <summary>
    /// 落地影像寬度（像素；重編碼/縮圖後）。
    /// </summary>
    public int Width { get; set; }

    /// <summary>
    /// 落地影像高度（像素；重編碼/縮圖後）。
    /// </summary>
    public int Height { get; set; }
}
