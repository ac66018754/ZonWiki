using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Domain.Common;
using ZonWiki.Infrastructure.Notes;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 通用 AI 提問端點：給「沒有特定筆記/節點脈絡」的場景用（例如開問啦畫布便利貼的「繼續問」）。
/// 以呼叫端自行組好的 <c>Context</c> ＋ <c>Question</c> 請 AI 回答，只回傳答案文字。
/// 與筆記的 <c>/ask-selection-answer</c> 共用同一套 <see cref="INoteAiService.AskAboutAsync"/>（共用預設模型）。
/// </summary>
public static class AiEndpoints
{
    /// <summary>
    /// 通用 AI 提問請求。
    /// </summary>
    /// <param name="Context">脈絡（呼叫端自行組好，例如「前一張便利貼＋目前便利貼」）。可空。</param>
    /// <param name="Question">使用者問題。</param>
    public sealed record AiAskRequest(string? Context, string Question);

    /// <summary>
    /// 通用 AI 提問結果。
    /// </summary>
    /// <param name="Answer">AI 回答文字。</param>
    public sealed record AiAskResult(string Answer);

    /// <summary>
    /// 註冊通用 AI 提問端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        // POST /api/ai/ask - 以 Context + Question 請 AI 回答（不綁定筆記/節點）
        app.MapPost("/api/ai/ask", async (
            HttpContext http,
            INoteAiService aiService,
            ILogger<object> logger,
            AiAskRequest request,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out _))
            {
                return Results.Unauthorized();
            }

            var question = (request.Question ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(question))
            {
                return Results.BadRequest(ApiResponse<AiAskResult>.Fail("缺少問題", 400));
            }

            try
            {
                var answer = await aiService.AskAboutAsync(request.Context ?? string.Empty, question, ct);
                return Results.Ok(ApiResponse<AiAskResult>.Ok(new AiAskResult(answer)));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed /api/ai/ask");
                return Results.StatusCode(500);
            }
        })
        .RequireAuthorization()
        .RequireRateLimiting(RateLimitingExtensions.AiPolicy); // 每使用者限流：防迴圈灌爆付費 LLM
    }
}
