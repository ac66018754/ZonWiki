using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 通用 AI 提問端點：給「沒有特定筆記/節點脈絡」的場景用（例如開問啦畫布便利貼的「繼續問」）。
/// 以呼叫端自行組好的 <c>Context</c> ＋ <c>Question</c> 請 AI 回答。
/// **非同步**：立即回 202 + sessionId，後援鏈在背景跑（避免 claude 冷啟動阻塞請求→反向代理逾時 502），
/// 前端輪詢 <c>/api/ask-queue/{sessionId}</c> 取 <c>ResultText</c>。
/// 與筆記的 <c>/ask-selection-answer</c> 共用同一套 <see cref="INoteAiService.AskAboutAsync"/> + 後援鏈。
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
    /// 註冊通用 AI 提問端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        // POST /api/ai/ask - 以 Context + Question 請 AI 回答（不綁定筆記/節點）；非同步（202 + sessionId）
        app.MapPost("/api/ai/ask", async (
            HttpContext http,
            AskQueueService queueService,
            IServiceScopeFactory scopeFactory,
            ILoggerFactory loggerFactory,
            AiAskRequest request,
            CancellationToken ct) =>
        {
            var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Results.Unauthorized();
            }

            var question = (request.Question ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(question))
            {
                return Results.BadRequest(ApiResponse<AiAsyncStartedDto>.Fail("缺少問題", 400));
            }

            var context = request.Context ?? string.Empty;

            // 同步建 Running session、立即回 sessionId（前端據此輪詢）。
            var session = await queueService.CreateRunningNoteAiSessionAsync(userId, null, "floatingnote", question, null, ct);
            var sessionId = session.Id;

            // 背景跑後援鏈（不阻塞請求）。
            _ = Task.Run(async () =>
            {
                using var scope = scopeFactory.CreateScope();
                var bgDb = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
                bgDb.SetCurrentUserId(userId);
                var bgQueue = scope.ServiceProvider.GetRequiredService<AskQueueService>();
                var bgAi = scope.ServiceProvider.GetRequiredService<INoteAiService>();
                var bgLogger = loggerFactory.CreateLogger("NoteAiBackground");
                // 背景逾時 340 秒（>claude 單次 300s），非同步背景執行、不阻塞請求。
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(340));
                try
                {
                    await bgQueue.FinishNoteAiAsync(
                        sessionId,
                        userId,
                        async (onStage, bgCt) => await bgAi.AskAboutAsync(context, question, bgCt, onStage),
                        cts.Token);
                }
                catch (Exception ex)
                {
                    bgLogger.LogError(ex, "通用提問 /api/ai/ask 背景失敗（session={SessionId}）", sessionId);
                }
            });

            return Results.Accepted(value: ApiResponse<AiAsyncStartedDto>.Ok(new AiAsyncStartedDto(sessionId)));
        }).RequireAuthorization();
    }
}
