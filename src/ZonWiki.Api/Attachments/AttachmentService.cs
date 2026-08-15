using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Memory;
using SixLabors.ImageSharp.Processing;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Attachments;

/// <summary>
/// 附件儲存結果：成功時 <see cref="Attachment"/> 有值；失敗時 <see cref="Error"/> 為給使用者看的繁中訊息。
/// </summary>
/// <param name="Attachment">成功建立的附件實體（失敗為 null）。</param>
/// <param name="Error">失敗原因（成功為 null；內容可直接回給前端顯示）。</param>
public sealed record AttachmentSaveResult(NoteAttachment? Attachment, string? Error);

/// <summary>
/// 筆記附件服務：驗證上傳影像、重編碼落地磁碟、寫入中繼資料。
///
/// 安全設計（對抗式審查結論，見 docs/DECISIONS.md 2026-07-08）：
/// - 不信任 client 宣稱的 Content-Type：一律以 ImageSharp 實際探測（header-only）判定格式。
/// - 防解壓縮炸彈：先 <c>Image.Identify</c>（不解像素）檢查像素總數上限，通過才完整解碼。
/// - png/jpeg/webp/bmp 一律「解碼→EXIF 轉正→必要時等比縮小→重編碼 WebP」，重編碼天然清洗
///   任何夾帶內容；gif 僅探測驗證後原樣保存（保留動畫；回應時搭配 nosniff 標頭）。
/// - 落地檔名一律系統產生（GUID），與使用者輸入無關，杜絕路徑穿越。
/// - 先寫檔、後寫 DB；DB 失敗時補償刪除剛寫的檔，不留「無 DB 列的永久孤兒檔」。
/// </summary>
public sealed class AttachmentService(
    ZonWikiDbContext db,
    IOptions<AttachmentOptions> options,
    IHostEnvironment environment,
    ILogger<AttachmentService> logger)
{
    /// <summary>
    /// 伺服器接受的影像格式白名單（以 ImageSharp 偵測到的格式名稱為準，皆為大寫）。
    /// SVG 有 XSS 風險、HEIC 無內建解碼器，皆不在名單內（會回 400）。
    /// </summary>
    private static readonly HashSet<string> AllowedFormatNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "PNG", "JPEG", "WEBP", "BMP", "GIF",
    };

    /// <summary>
    /// 解碼專用的 ImageSharp 設定：限制「單一緩衝區」的記憶體配置上限（非累積總量——
    /// ImageSharp 的 AllocationLimitMegabytes 只管單次配置）。這是「解碼前像素檢查」之外的
    /// 第二道防線：即使畸形檔案騙過 header 探測，超大單次配置也會直接丟例外而非吃光記憶體。
    /// 「同時多請求疊加」的總量風險另由 <see cref="ProcessingGate"/> 併發閘門控制。
    /// </summary>
    private static readonly Configuration DecodeConfiguration = CreateDecodeConfiguration();

    /// <summary>
    /// 影像轉檔併發閘門：同時最多 2 個請求進行「解碼→轉正→縮圖→編碼」。
    /// 限流（TokenBucket）只限制時間窗內的請求數、擋不住瞬時並發——
    /// 20 個請求同時各吃數十至數百 MB working buffer 會把 2GB 正式機 OOM，故以號誌硬性序列化。
    /// </summary>
    private static readonly SemaphoreSlim ProcessingGate = new(2, 2);

    /// <summary>
    /// 建立含記憶體上限的解碼設定（單次配置 256MB、累積 512MB）。
    /// </summary>
    /// <returns>解碼專用 Configuration。</returns>
    private static Configuration CreateDecodeConfiguration()
    {
        var configuration = Configuration.Default.Clone();
        configuration.MemoryAllocator = MemoryAllocator.Create(new MemoryAllocatorOptions
        {
            AllocationLimitMegabytes = 256,
        });
        return configuration;
    }

    /// <summary>
    /// 解碼選項：套用記憶體上限設定（供 Identify 與 Load 共用）。
    /// </summary>
    private static readonly DecoderOptions SafeDecoderOptions = new()
    {
        Configuration = DecodeConfiguration,
    };

    /// <summary>
    /// 解析附件根目錄的絕對路徑：設定為相對路徑時以 ContentRoot 為基準；絕對路徑（測試）直接採用。
    /// </summary>
    /// <param name="environment">主機環境（取 ContentRootPath）。</param>
    /// <param name="options">附件設定。</param>
    /// <returns>附件根目錄的絕對路徑（已正規化）。</returns>
    public static string ResolveRootPath(IHostEnvironment environment, AttachmentOptions options) =>
        Path.GetFullPath(Path.Combine(environment.ContentRootPath, options.RootPath));

    /// <summary>
    /// 驗證並儲存一張上傳影像：格式/大小/像素檢查 → 重編碼落地 → 寫入 NoteAttachment 中繼資料。
    /// </summary>
    /// <param name="userId">上傳者的使用者 Id（附件擁有者）。</param>
    /// <param name="file">上傳的表單檔案。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>儲存結果（成功含實體；失敗含繁中錯誤訊息）。</returns>
    public async Task<AttachmentSaveResult> SaveAsync(Guid userId, IFormFile file, CancellationToken ct)
    {
        var opt = options.Value;

        // --- 基本大小檢查 ---------------------------------------------------
        if (file.Length == 0)
        {
            return new AttachmentSaveResult(null, "沒有收到檔案內容（0 byte）");
        }
        if (file.Length > opt.MaxUploadBytes)
        {
            return new AttachmentSaveResult(null, $"圖片過大（上限 {opt.MaxUploadBytes / (1024 * 1024)}MB）");
        }

        // --- 讀入記憶體（已受單檔上限保護，最大 10MB 等級） ---------------------
        byte[] inputBytes;
        await using (var buffer = new MemoryStream((int)file.Length))
        {
            await file.CopyToAsync(buffer, ct);
            inputBytes = buffer.ToArray();
        }

        // --- header-only 探測：格式白名單＋解壓縮炸彈防護（不解像素） -----------
        ImageInfo info;
        try
        {
            using var identifyStream = new MemoryStream(inputBytes, writable: false);
            info = await Image.IdentifyAsync(SafeDecoderOptions, identifyStream, ct);
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
        {
            return new AttachmentSaveResult(
                null, "無法辨識的圖片格式（支援 PNG / JPEG / WebP / BMP / GIF；iPhone 的 HEIC 請先轉存 JPEG）");
        }

        var formatName = info.Metadata.DecodedImageFormat?.Name ?? string.Empty;
        if (!AllowedFormatNames.Contains(formatName))
        {
            return new AttachmentSaveResult(
                null, $"不支援的圖片格式（{formatName}）；支援 PNG / JPEG / WebP / BMP / GIF");
        }
        if ((long)info.Width * info.Height > opt.MaxDecodePixels)
        {
            return new AttachmentSaveResult(
                null, $"圖片像素過多（{info.Width}×{info.Height}，上限 {opt.MaxDecodePixels / 1_000_000}MP）");
        }

        // --- 產生落地內容：gif 原樣；其餘重編碼 WebP --------------------------
        var attachmentId = Guid.NewGuid();
        var isGif = string.Equals(formatName, "GIF", StringComparison.OrdinalIgnoreCase);
        byte[] outputBytes;
        string contentType;
        string extension;
        int width;
        int height;

        if (isGif)
        {
            // GIF 原樣保存（重編碼會失去動畫）；已通過 Identify 驗證與像素上限。
            outputBytes = inputBytes;
            contentType = "image/gif";
            extension = ".gif";
            width = info.Width;
            height = info.Height;
        }
        else
        {
            // 併發閘門：轉檔屬記憶體密集操作，同時最多 2 個請求進行（防瞬時並發 OOM）。
            await ProcessingGate.WaitAsync(ct);
            try
            {
                using var loadStream = new MemoryStream(inputBytes, writable: false);
                using var image = await Image.LoadAsync(SafeDecoderOptions, loadStream, ct);
                // EXIF 轉正：手機照片常以 Orientation 標籤記錄方向，重編碼前必須實際旋轉像素，
                // 否則轉成 WebP 後方向資訊遺失、照片永久橫躺。
                image.Mutate(x => x.AutoOrient());
                if (Math.Max(image.Width, image.Height) > opt.MaxDimensionPixels)
                {
                    // ResizeMode.Max：等比縮小到「最長邊 = 上限」，不裁切、不變形。
                    image.Mutate(x => x.Resize(new ResizeOptions
                    {
                        Mode = ResizeMode.Max,
                        Size = new Size(opt.MaxDimensionPixels, opt.MaxDimensionPixels),
                    }));
                }

                await using var encoded = new MemoryStream();
                await image.SaveAsWebpAsync(encoded, new WebpEncoder { Quality = opt.WebpQuality }, ct);
                outputBytes = encoded.ToArray();
                width = image.Width;
                height = image.Height;
            }
            catch (Exception ex) when (
                ex is UnknownImageFormatException
                    or InvalidImageContentException
                    or NotSupportedException
                    or InvalidMemoryOperationException)
            {
                // Identify 過了但完整解碼失敗＝內容損毀或惡意構造（含記憶體配置超限的防線觸發）。
                logger.LogWarning(ex, "附件完整解碼失敗（使用者 {UserId}，宣稱格式 {Format}）", userId, formatName);
                return new AttachmentSaveResult(null, "圖片內容損毀，無法處理");
            }
            finally
            {
                ProcessingGate.Release();
            }

            contentType = "image/webp";
            extension = ".webp";
        }

        // --- 檔名清洗（僅供顯示；落地路徑一律用 GUID） -------------------------
        var displayName = Path.GetFileName(file.FileName ?? string.Empty);
        displayName = new string(displayName.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (string.IsNullOrWhiteSpace(displayName)) displayName = "貼上的圖片";
        if (displayName.Length > 255) displayName = displayName[..255];

        // --- 落地：交易＋使用者級 advisory lock 內做配額檢查與 DB 寫入 ----------
        // 配額的 SUM 檢查與插入若不原子化，同一使用者並發上傳會各自讀到舊總量而同時通過
        // （對抗式復審 HIGH 發現）；以 pg_advisory_xact_lock（交易結束自動釋放）序列化
        // 同一使用者的「檢查＋寫入」，不同使用者互不阻塞。
        var relativePath = Path.Combine(userId.ToString("N"), attachmentId.ToString("N") + extension)
            .Replace('\\', '/'); // DB 一律存正斜線，跨平台一致。
        var rootPath = ResolveRootPath(environment, opt);
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // 鎖鍵：由 UserId 前 8 bytes 導出的穩定 64 位元值（單庫內僅此用途，無碰撞疑慮）。
        var lockKey = BitConverter.ToInt64(userId.ToByteArray(), 0);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", ct);

        // 配額檢查（於鎖內、以「落地後大小」計，只計有效附件）。
        var usedBytes = await db.NoteAttachment
            .Where(a => a.UserId == userId && a.ValidFlag)
            .SumAsync(a => (long?)a.FileSizeBytes, ct) ?? 0L;
        if (usedBytes + outputBytes.LongLength > opt.MaxTotalBytesPerUser)
        {
            await transaction.RollbackAsync(ct);
            return new AttachmentSaveResult(
                null,
                $"附件總容量已達上限（{opt.MaxTotalBytesPerUser / (1024 * 1024)}MB），請先清理不用的圖片");
        }

        // 先寫檔、後寫 DB；任一步失敗補償刪檔，不留「掃描永遠看不到」的純檔案孤兒。
        await File.WriteAllBytesAsync(fullPath, outputBytes, ct);
        try
        {
            var attachment = new NoteAttachment
            {
                Id = attachmentId,
                UserId = userId,
                FileName = displayName,
                FilePath = relativePath,
                ContentType = contentType,
                FileSizeBytes = outputBytes.LongLength,
                Width = width,
                Height = height,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
            };
            db.NoteAttachment.Add(attachment);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new AttachmentSaveResult(attachment, null);
        }
        catch
        {
            // 補償：DB 寫入/提交失敗時移除剛落地的檔案（交易未提交會自動回滾 DB 列）。
            try { if (File.Exists(fullPath)) File.Delete(fullPath); }
            catch (Exception cleanupEx) { logger.LogWarning(cleanupEx, "附件補償刪檔失敗：{Path}", fullPath); }
            throw;
        }
    }
}
