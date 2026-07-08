using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ZonWiki.Api.Attachments;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Domain.Common;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記附件端點：上傳圖片（POST）與取回圖檔（GET）。
/// 筆記內文以 <c>![圖片](/api/attachments/{id})</c> 短網址引用，取代舊的 base64 內嵌
/// （動機與取捨見 docs/DECISIONS.md 2026-07-08）。
/// </summary>
public static class AttachmentEndpoints
{
    /// <summary>
    /// 上傳成功時回傳的附件資訊。
    /// </summary>
    /// <param name="Id">附件識別碼。</param>
    /// <param name="Url">引用網址（相對路徑，跨環境通用；前端顯示時再補 API base）。</param>
    /// <param name="FileName">清洗後的原始檔名（顯示用）。</param>
    /// <param name="ContentType">落地內容型別（image/webp 或 image/gif）。</param>
    /// <param name="FileSizeBytes">落地檔案大小（bytes）。</param>
    /// <param name="Width">影像寬（像素）。</param>
    /// <param name="Height">影像高（像素）。</param>
    public sealed record AttachmentDto(
        Guid Id,
        string Url,
        string FileName,
        string ContentType,
        long FileSizeBytes,
        int Width,
        int Height);

    /// <summary>
    /// 註冊附件端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapAttachmentEndpoints(this IEndpointRouteBuilder app)
    {
        // 上傳圖片（multipart/form-data，欄位名 file）。
        app.MapPost("/api/attachments", async (
            HttpContext http,
            AttachmentService service,
            ILogger<AttachmentService> logger,
            IOptions<AttachmentOptions> options,
            CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            if (!http.Request.HasFormContentType)
            {
                return Results.BadRequest(ApiResponse<AttachmentDto>.Fail("請以 multipart/form-data 上傳檔案", 400));
            }

            // 請求體上限收斂到「單檔上限＋multipart 額外負擔」：超大請求在框架層即被截斷，
            // 不會整包讀進記憶體才被應用層拒絕（Kestrel 預設約 28MB，比 10MB 上限寬）。
            var sizeFeature = http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (sizeFeature is not null && !sizeFeature.IsReadOnly)
            {
                sizeFeature.MaxRequestBodySize = options.Value.MaxUploadBytes + 1024 * 1024;
            }

            IFormFile? file;
            try
            {
                var form = await http.Request.ReadFormAsync(ct);
                file = form.Files.GetFile("file");
            }
            catch (Exception ex)
            {
                // 多半是超過大小上限（BadHttpRequestException）或 multipart 解析錯誤。
                logger.LogWarning(ex, "附件上傳表單解析失敗");
                return Results.BadRequest(ApiResponse<AttachmentDto>.Fail(
                    $"檔案讀取失敗（上限 {options.Value.MaxUploadBytes / (1024 * 1024)}MB）", 400));
            }

            if (file is null)
            {
                return Results.BadRequest(ApiResponse<AttachmentDto>.Fail("沒有收到檔案（表單欄位名須為 file）", 400));
            }

            var result = await service.SaveAsync(userGuid, file, ct);
            if (result.Attachment is null)
            {
                return Results.BadRequest(ApiResponse<AttachmentDto>.Fail(result.Error ?? "上傳失敗", 400));
            }

            var a = result.Attachment;
            var dto = new AttachmentDto(
                a.Id, $"/api/attachments/{a.Id}", a.FileName, a.ContentType, a.FileSizeBytes, a.Width, a.Height);
            return Results.Ok(ApiResponse<AttachmentDto>.Ok(dto));
        })
        .RequireAuthorization()
        .RequireRateLimiting(RateLimitingExtensions.UploadPolicy);

        // 取回圖檔：驗登入＋使用者隔離；瀏覽器 <img> 同站請求會自動帶 Cookie。
        app.MapGet("/api/attachments/{id:guid}", async (
            Guid id,
            HttpContext http,
            ZonWikiDbContext db,
            IOptions<AttachmentOptions> options,
            IHostEnvironment environment,
            ILogger<AttachmentService> logger,
            CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            var attachment = await db.NoteAttachment
                .AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userGuid && a.ValidFlag, ct);
            if (attachment is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("附件不存在", 404));
            }

            // 防禦性檢查：組出的實體路徑必須仍在附件根目錄下（FilePath 由系統產生，理論上不會出界）。
            var rootPath = AttachmentService.ResolveRootPath(environment, options.Value);
            var fullPath = Path.GetFullPath(Path.Combine(rootPath, attachment.FilePath));
            if (!fullPath.StartsWith(rootPath + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                logger.LogError("附件路徑異常出界：{Id} → {Path}", id, attachment.FilePath);
                return Results.NotFound(ApiResponse<object>.Fail("附件不存在", 404));
            }
            if (!File.Exists(fullPath))
            {
                // DB 有列但檔案遺失（部分寫入/人為誤刪/未同步的本地環境）——回 404 並留紀錄。
                logger.LogWarning("附件檔案遺失：{Id} → {Path}", id, fullPath);
                return Results.NotFound(ApiResponse<object>.Fail("附件檔案遺失", 404));
            }

            // 內容不可變（重新上傳＝新 id）→ 允許瀏覽器長期快取；private：僅擁有者可見，不給共享快取存。
            http.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            // GIF 為原樣保存（未重編碼清洗），nosniff 確保瀏覽器不做 MIME 猜測、不當 HTML 執行。
            http.Response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(fullPath, attachment.ContentType);
        })
        .RequireAuthorization();
    }

    /// <summary>
    /// 從 claim 取出登入使用者 Id。
    /// </summary>
    /// <param name="http">目前的 HTTP 內容。</param>
    /// <param name="userGuid">解析出的使用者 Id。</param>
    /// <returns>是否成功解析。</returns>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var raw = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(raw, out userGuid);
    }
}
