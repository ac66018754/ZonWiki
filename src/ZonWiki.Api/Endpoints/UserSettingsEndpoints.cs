using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 使用者全站設定相關的 API 端點：
/// GET /api/me/settings（取得設定）、PUT /api/me/settings（更新設定）。
/// 涵蓋顯示模式與時區；屬當前登入使用者的個人設定。
/// </summary>
public static class UserSettingsEndpoints
{
    /// <summary>
    /// 註冊使用者設定相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapUserSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 取得當前登入使用者的全站設定（顯示模式、時區）。
        /// GET /api/me/settings
        /// </summary>
        app.MapGet("/api/me/settings", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var user = await db.User
                .Where(u => u.Id == userGuid)
                .Select(u => new UserSettingsDto(
                    DisplayMode: u.DisplayMode,
                    TimeZone: u.TimeZone,
                    ShortcutsJson: u.ShortcutsJson,
                    TranscriptionEngine: u.TranscriptionEngine,
                    GroqKeySet: u.GroqApiKeyEncrypted != null && u.GroqApiKeyEncrypted != ""))
                .FirstOrDefaultAsync(ct);

            if (user is null)
            {
                return Results.NotFound(ApiResponse<UserSettingsDto>.Fail("使用者不存在", 404));
            }

            return Results.Ok(ApiResponse<UserSettingsDto>.Ok(user));
        });

        /// <summary>
        /// 更新當前登入使用者的全站設定（顯示模式、時區、快捷鍵覆寫）。欄位皆選擇性。
        /// PUT /api/me/settings
        /// Body: { displayMode?, timeZone?, shortcutsJson? }
        ///
        /// 有效的顯示模式："warmpaper"（暖紙）、"light"（明亮）、"dark"（暗色）、"night"（夜間）。
        /// 時區應為 IANA 名稱（例如 "Asia/Taipei"，或空字串表示跟隨裝置預設）。
        /// 快捷鍵覆寫為 JSON 字串；傳空字串代表清除（還原全部預設）。
        /// </summary>
        app.MapPut("/api/me/settings", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            ZonWiki.Infrastructure.Ai.AiModelResolver keyResolver,
            UpdateUserSettingsRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var user = await db.User
                .Where(u => u.Id == userGuid)
                .FirstOrDefaultAsync(ct);

            if (user is null)
            {
                return Results.NotFound(ApiResponse<UserSettingsDto>.Fail("使用者不存在", 404));
            }

            // 轉錄引擎（gemini / groq）
            if (request.TranscriptionEngine != null)
            {
                var engine = request.TranscriptionEngine.Trim().ToLowerInvariant();
                if (engine is not ("gemini" or "groq"))
                {
                    return Results.BadRequest(ApiResponse<UserSettingsDto>.Fail("無效的轉錄引擎（只接受 gemini 或 groq）", 400));
                }
                user.TranscriptionEngine = engine;
            }

            // Groq 金鑰：非 null 才動作。空字串＝清除；否則加密儲存（絕不回傳明碼）。
            if (request.GroqApiKey != null)
            {
                user.GroqApiKeyEncrypted = request.GroqApiKey.Length == 0
                    ? null
                    : keyResolver.EncryptApiKey(request.GroqApiKey.Trim());
            }

            // 驗證與更新顯示模式
            if (!string.IsNullOrEmpty(request.DisplayMode))
            {
                var validModes = new[] { "warmpaper", "light", "dark", "night" };
                if (!validModes.Contains(request.DisplayMode))
                {
                    return Results.BadRequest(ApiResponse<UserSettingsDto>.Fail(
                        $"無效的顯示模式。有效值：{string.Join(", ", validModes)}", 400));
                }

                user.DisplayMode = request.DisplayMode;
            }

            // 更新時區（不驗證 IANA 清單，因為可能變更；僅檢查非 null）
            if (request.TimeZone != null)
            {
                user.TimeZone = request.TimeZone;
            }

            // 更新快捷鍵覆寫：非 null 才更新。空字串＝清除覆寫（還原全部預設，存 null）。
            if (request.ShortcutsJson != null)
            {
                user.ShortcutsJson = request.ShortcutsJson.Length == 0 ? null : request.ShortcutsJson;
            }

            user.UpdatedDateTime = DateTime.UtcNow;
            user.UpdatedUser = userId;

            await db.SaveChangesAsync(ct);

            var resultDto = new UserSettingsDto(
                DisplayMode: user.DisplayMode,
                TimeZone: user.TimeZone,
                ShortcutsJson: user.ShortcutsJson,
                TranscriptionEngine: user.TranscriptionEngine,
                GroqKeySet: !string.IsNullOrEmpty(user.GroqApiKeyEncrypted));

            return Results.Ok(ApiResponse<UserSettingsDto>.Ok(resultDto));
        });
    }
}
