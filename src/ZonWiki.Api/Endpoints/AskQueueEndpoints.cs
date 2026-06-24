using Microsoft.Extensions.Logging;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 提問佇列端點（查詢使用者的 AI 提問歷史、狀態與結果）。
/// </summary>
public static class AskQueueEndpoints
{
    /// <summary>
    /// 註冊提問佇列相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    /// <param name="authConfigured">是否已設定驗證（未設定時略過授權要求）。</param>
    public static void MapAskQueueEndpoints(this IEndpointRouteBuilder app, bool authConfigured)
    {
        // GET /api/ask-queue - 查詢使用者的提問佇列
        var getQueue = app.MapGet("/api/ask-queue", GetQueueHandler);

        // 要求驗證的端點
        if (authConfigured)
        {
            getQueue.RequireAuthorization();
        }
    }

    /// <summary>
    /// 查詢目前使用者的提問佇列。
    /// 支援可選篩選：?status=Running|Completed|Failed、?kind=floatingnote|node、?limit=50。
    /// 回傳清單依建立時間由新到舊排列。
    /// </summary>
    private static async Task<IResult> GetQueueHandler(
        HttpContext http,
        AskQueueService queueService,
        ILogger<object> logger,
        string? status = null,
        string? kind = null,
        int? limit = null,
        CancellationToken ct = default)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<IReadOnlyList<AskQueueItemDto>>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        try
        {
            var items = await queueService.GetQueueAsync(userId, status, kind, limit, ct);
            return Results.Ok(ApiResponse<IReadOnlyList<AskQueueItemDto>>.Ok(items));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get ask-queue (userId={UserId})", userId);
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// 從 HttpContext 提取使用者 ID。
    /// 只允許從使用者聲明（user claim）提取；禁止從查詢參數或其他來源讀取，避免用戶繞過授權。
    /// </summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        if (!string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId))
        {
            return userId;
        }

        return Guid.Empty;
    }
}
