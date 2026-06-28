using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
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
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var sp = scope.ServiceProvider;
                    var bgDb = sp.GetRequiredService<ZonWikiDbContext>();
                    bgDb.SetCurrentUserId(userGuid); // 第一次查詢前設定
                    var refine = sp.GetRequiredService<RefineService>();
                    await refine.ExecuteAsync(userGuid, url, sessionId, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "精煉背景工作未預期失敗（sessionId={SessionId}）", sessionId);
                }
            });

            return Results.Ok(ApiResponse<object>.Ok(new { sessionId }));
        }).RequireAuthorization();
    }
}
