using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 「精煉成筆記」端點：收一個 URL，非同步把它（影片/播客/文章）抓字幕或音訊轉錄後，
/// 用 AI 整理成分類筆記。立即回應、實際處理在背景；進度以 AiSession 顯示於「AI 處理中」佇列。
/// </summary>
public static class RefineEndpoints
{
    /// <summary>精煉請求。</summary>
    /// <param name="Url">內容連結（YouTube / podcast / 文章…）。</param>
    public sealed record RefineRequest(string Url);

    /// <summary>
    /// 註冊精煉端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapRefineEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/refine", async (
            HttpContext http,
            ZonWikiDbContext db,
            IServiceScopeFactory scopeFactory,
            ILogger<object> logger,
            RefineRequest request,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userGuid))
            {
                return Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);
            }

            var url = (request.Url ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(url)
                || !(url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                     || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                return Results.BadRequest(ApiResponse<object>.Fail("請提供有效的 http/https 連結", 400));
            }

            // 建立 Running 的 AiSession（顯示在「AI 處理中」佇列；Kind=refine）。
            var session = new AiSession
            {
                UserId = userGuid,
                Kind = "refine",
                QuestionText = url.Length > 500 ? url[..500] : url,
                PromptText = url,
                Status = "Running",
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.AiSession.Add(session);
            await db.SaveChangesAsync(ct);
            var sessionId = session.Id;

            // 背景處理：另開子範圍，先設定背景使用者（避免鎖死請求 DbContext 的使用者模型）。
            // 不 await（fire-and-forget）；錯誤由 RefineService 自行記錄並更新 AiSession 為 Failed。
            _ = Task.Run(async () =>
            {
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(RefineTimeoutMinutes));
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var sp = scope.ServiceProvider;
                    var bgDb = sp.GetRequiredService<ZonWikiDbContext>();
                    bgDb.SetCurrentUserId(userGuid); // 第一次查詢前設定
                    var refine = sp.GetRequiredService<RefineService>();
                    await refine.ExecuteAsync(userGuid, url, sessionId, timeoutCts.Token);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "精煉背景工作未預期失敗（sessionId={SessionId}）", sessionId);
                }
            });

            return Results.Ok(ApiResponse<object>.Ok(new { sessionId }));
        })
        .RequireAuthorization()
        .RequireRateLimiting(RateLimitingExtensions.AiPolicy); // 每使用者限流：精煉會 spawn yt-dlp/ffmpeg＋付費 API

        // POST /api/refine/upload —— 上傳音訊/影片檔精煉成筆記（路 A2）。
        // 適用「手機/電腦自己（住宅 IP、已登入）抓下來的 IG/影片檔」：ZonWiki 只負責轉錄＋整理，
        // 不必自己去翻 IG 的登入牆。一律需轉錄 → 需在個人頁把轉錄引擎設為 Groq。
        app.MapPost("/api/refine/upload", async (
            HttpContext http,
            ZonWikiDbContext db,
            IServiceScopeFactory scopeFactory,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userGuid))
            {
                return Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);
            }

            // 放寬此端點的請求大小上限（Kestrel 預設約 28MB 放不下影音）。須在讀取 body 前設定。
            var sizeFeature = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (sizeFeature is not null && !sizeFeature.IsReadOnly)
            {
                sizeFeature.MaxRequestBodySize = MaxUploadBytes;
            }

            // 上傳檔一律需要轉錄 → 必須先設好 Groq，否則白費「上傳 + ffmpeg 轉檔」才失敗。提前擋下回 400。
            var settings = await db.User
                .Where(u => u.Id == userGuid)
                .Select(u => new { u.TranscriptionEngine, u.GroqApiKeyEncrypted })
                .FirstOrDefaultAsync(ct);
            if (settings is null)
            {
                return Results.Json(ApiResponse<object>.Fail("使用者不存在", 404), statusCode: 404);
            }
            if (!string.Equals(settings.TranscriptionEngine, "groq", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrEmpty(settings.GroqApiKeyEncrypted))
            {
                return Results.BadRequest(ApiResponse<object>.Fail(
                    "上傳檔案需要轉錄，請先到「個人頁 → 精煉成筆記」把轉錄引擎設為 Groq（免費）並填入金鑰。", 400));
            }

            if (!http.Request.HasFormContentType)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("請以 multipart/form-data 上傳檔案", 400));
            }

            IFormFile? file;
            try
            {
                var form = await http.Request.ReadFormAsync(ct);
                file = form.Files.GetFile("file");
            }
            catch (Exception ex)
            {
                // 多半是超過大小上限（BadHttpRequestException）或 multipart 解析錯誤；記錄下來方便在 Seq 追。
                logger.LogError(ex, "上傳檔案讀取/解析失敗");
                return Results.BadRequest(ApiResponse<object>.Fail($"檔案讀取失敗（上限 {MaxUploadBytes / (1024 * 1024)}MB）", 400));
            }

            if (file is null || file.Length == 0)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("沒有收到檔案", 400));
            }
            if (file.Length > MaxUploadBytes)
            {
                return Results.BadRequest(ApiResponse<object>.Fail($"檔案過大（上限 {MaxUploadBytes / (1024 * 1024)}MB）", 400));
            }
            if (!IsAcceptedMedia(file))
            {
                return Results.BadRequest(ApiResponse<object>.Fail("只接受音訊或影片檔（mp3 / m4a / wav / mp4 / mov…）", 400));
            }

            // 取「純檔名」（去掉任何路徑成分）只供顯示；存檔一律用「產生的隨機檔名」→ 杜絕路徑穿越。
            var displayName = Path.GetFileName(file.FileName);
            if (string.IsNullOrWhiteSpace(displayName)) displayName = "上傳檔案";
            if (displayName.Length > 255) displayName = displayName[..255];

            var uploadDir = Path.Combine(Path.GetTempPath(), "zonwiki-refine-upload");
            Directory.CreateDirectory(uploadDir);
            var uploadPath = Path.Combine(uploadDir, Guid.NewGuid().ToString("N"));
            try
            {
                await using var fs = File.Create(uploadPath);
                await file.CopyToAsync(fs, ct);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "上傳檔案存檔失敗");
                try { if (File.Exists(uploadPath)) File.Delete(uploadPath); } catch { /* 忽略清理錯誤 */ }
                return Results.Json(ApiResponse<object>.Fail("上傳檔案存檔失敗", 500), statusCode: 500);
            }

            // 建立 Running 的 AiSession（顯示在「AI 處理中」佇列；Kind=refine）。
            var label = $"上傳檔案：{displayName}";
            var session = new AiSession
            {
                UserId = userGuid,
                Kind = "refine",
                QuestionText = label.Length > 500 ? label[..500] : label,
                PromptText = label,
                Status = "Running",
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.AiSession.Add(session);
            await db.SaveChangesAsync(ct);
            var sessionId = session.Id;

            // 背景處理（fire-and-forget）：另開子範圍、先設背景使用者；RefineService 會在完成後刪除上傳暫存檔。
            _ = Task.Run(async () =>
            {
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(RefineTimeoutMinutes));
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var sp = scope.ServiceProvider;
                    var bgDb = sp.GetRequiredService<ZonWikiDbContext>();
                    bgDb.SetCurrentUserId(userGuid);
                    var refine = sp.GetRequiredService<RefineService>();
                    await refine.ExecuteFromFileAsync(userGuid, uploadPath, displayName, sessionId, timeoutCts.Token);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "上傳精煉背景工作未預期失敗（sessionId={SessionId}）", sessionId);
                }
            });

            return Results.Ok(ApiResponse<object>.Ok(new { sessionId }));
        })
        .RequireAuthorization()
        .RequireRateLimiting(RateLimitingExtensions.AiPolicy) // 每使用者限流：上傳精煉同樣觸發轉檔＋付費轉錄
        .DisableAntiforgery();
    }

    /// <summary>上傳檔案大小上限（100MB）。影音抓字幕/短片足夠，又不至於壓垮小型 VM。</summary>
    private const long MaxUploadBytes = 100L * 1024 * 1024;

    /// <summary>
    /// 背景精煉工作的逾時上限（分鐘）。避免 Groq/yt-dlp/ffmpeg 卡住時背景工作永遠不結束；
    /// 逾時會取消並讓 AiSession 轉為 Failed（與佇列的 stale 門檻相呼應）。
    /// </summary>
    private const int RefineTimeoutMinutes = 45;

    /// <summary>可接受的媒體副檔名（content-type 為 octet-stream 時的後援判斷）。</summary>
    private static readonly HashSet<string> AcceptedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma",
        ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".mpeg", ".mpg", ".3gp",
    };

    /// <summary>
    /// 判斷上傳檔是否為可接受的音訊／影片：content-type 為 audio/ 或 video/，
    /// 或（瀏覽器送 application/octet-stream 時）副檔名屬於已知媒體格式。ffmpeg 為最終把關者。
    /// </summary>
    private static bool IsAcceptedMedia(IFormFile file)
    {
        var contentType = file.ContentType ?? string.Empty;
        if (contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)
            || contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var ext = Path.GetExtension(file.FileName ?? string.Empty);
        return ext.Length > 0 && AcceptedExtensions.Contains(ext);
    }
}
