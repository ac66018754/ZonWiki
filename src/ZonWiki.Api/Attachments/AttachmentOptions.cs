namespace ZonWiki.Api.Attachments;

/// <summary>
/// 筆記附件（圖片上傳）功能的設定選項（"Attachments" 設定區段）。
/// 所有值皆有安全預設；測試環境會覆寫 <see cref="RootPath"/> 指向暫存目錄。
/// </summary>
public sealed class AttachmentOptions
{
    /// <summary>
    /// 設定區段名稱。
    /// </summary>
    public const string SectionName = "Attachments";

    /// <summary>
    /// 附件根目錄。相對路徑時以 ContentRoot 為基準（預設 App_Data/attachments）；
    /// 也可設絕對路徑（測試用）。正式環境此目錄需掛 Docker volume 並納入備份（見 scripts/backup-db.sh）。
    /// </summary>
    public string RootPath { get; init; } = "App_Data/attachments";

    /// <summary>
    /// 單檔上傳大小上限（bytes）。預設 10MB。
    /// </summary>
    public long MaxUploadBytes { get; init; } = 10 * 1024 * 1024;

    /// <summary>
    /// 落地影像的最長邊上限（像素）。超過時等比縮小到此上限。預設 2560（足夠 2x retina 全寬顯示）。
    /// </summary>
    public int MaxDimensionPixels { get; init; } = 2560;

    /// <summary>
    /// 「解碼前」的像素總數上限（寬×高）。防解壓縮炸彈（decompression bomb）：
    /// 先以 header-only 探測尺寸，超過此值直接拒收、不進入完整解碼，
    /// 避免小檔宣告超大尺寸把 2GB 記憶體的正式機打掛。預設 24MP（約 6000×4000，一般相機上限）。
    /// </summary>
    public long MaxDecodePixels { get; init; } = 24_000_000;

    /// <summary>
    /// WebP 重編碼品質（1-100）。預設 80（截圖與照片皆可接受的品質/體積折衷）。
    /// </summary>
    public int WebpQuality { get; init; } = 80;

    /// <summary>
    /// 每位使用者的附件累積容量上限（bytes；只計 ValidFlag=true 者）。預設 500MB。
    /// 防止單一帳號（或被盜的 PAT）灌爆磁碟。
    /// </summary>
    public long MaxTotalBytesPerUser { get; init; } = 500L * 1024 * 1024;

    /// <summary>
    /// 孤兒附件寬限期（小時）。建立超過此時數且未被任何內容引用的附件，才會被掃描軟刪除；
    /// 避免「上傳後筆記還沒存」或「短暫誤刪後復原」被誤殺。預設 48 小時。
    /// </summary>
    public int OrphanGraceHours { get; init; } = 48;

    /// <summary>
    /// 孤兒掃描輪詢間隔（小時）。預設 24（每日一輪；單人系統不需更即時）。
    /// </summary>
    public int OrphanScanIntervalHours { get; init; } = 24;
}
