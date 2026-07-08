using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布端點——AI 提問（節點提問 / 追問 / 選取片段提問，皆背景執行並經 SSE 推送）與取消。
/// </summary>
public static partial class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 對節點提問：以該節點內容為問題，背景執行並串流 AI 回答。
    /// 事件經由 SSE 推送到前端；前端應監聽 /api/canvas/sse/{canvasId}。
    /// 立即回傳 Accepted（202），實際提問非同步進行。
    /// </summary>
    private static IResult AskNode(
        string canvasId,
        ICurrentUser currentUser,
        AskNodeRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.AskFromNodeId))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("AskFromNodeId is required"), StatusCodes.Status400BadRequest);
        }

        // 先把使用者 Id 取出成區域變數：ICurrentUser 是「scoped」服務，綁定當前 HTTP 請求；
        // 一旦下方回傳 Accepted、請求 scope 釋放後，背景工作再去讀 currentUser.UserId 會變成
        // Guid.Empty（它從已消失的 HttpContext 取值），導致 orchestrator 用 Guid.Empty 查不到
        // 任何畫布而「靜默不產生回答、也不報錯」。故必須在進背景前先擷取。
        var userId = currentUser.UserId;

        // 背景執行提問流程，避免被請求超時影響
        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunNodeAskAsync(userId, canvasId, req.AskFromNodeId, cts, req.X, req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskNode operation failed (canvasId={CanvasId}, nodeId={NodeId})", canvasId, req.AskFromNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 追問（對話式）：在來源節點下建立問題節點後提問（接續對話）。
    /// 背景執行；事件經由 SSE 推送。立即回傳 Accepted（202）。
    /// </summary>
    private static IResult AskFollowup(
        string canvasId,
        ICurrentUser currentUser,
        AskFollowupRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.FromNodeId) || string.IsNullOrWhiteSpace(req.Question))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("FromNodeId and Question are required"), StatusCodes.Status400BadRequest);
        }

        // 同 AskNode：ICurrentUser 為 scoped，需在進背景工作前先擷取使用者 Id。
        var userId = currentUser.UserId;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunFollowupAskAsync(userId, canvasId, req.FromNodeId, req.Question, cts, req.X, req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskFollowup operation failed (canvasId={CanvasId}, fromNodeId={FromNodeId})", canvasId, req.FromNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 對選取片段提問：產生回答節點 + 行內連結（來源文字 ↔ 回答節點）。
    /// 背景執行；事件經由 SSE 推送。立即回傳 Accepted（202）。
    /// </summary>
    private static IResult AskInlineLink(
        string canvasId,
        ICurrentUser currentUser,
        AskInlineLinkRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.SourceNodeId) || string.IsNullOrWhiteSpace(req.AnchorText))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("SourceNodeId and AnchorText are required"), StatusCodes.Status400BadRequest);
        }

        // 同 AskNode：ICurrentUser 為 scoped，需在進背景工作前先擷取使用者 Id。
        var userId = currentUser.UserId;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunInlineLinkAskAsync(
                    userId,
                    canvasId,
                    req.SourceNodeId,
                    req.AnchorText,
                    req.AnchorStart,
                    req.AnchorEnd,
                    req.AnchorPrefix,
                    req.AnchorSuffix,
                    req.Question ?? "",
                    cts,
                    req.X,
                    req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskInlineLink operation failed (canvasId={CanvasId}, sourceNodeId={SourceNodeId})", canvasId, req.SourceNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 中止某個回答節點正在進行的 AI 生成。已生成的片段會被保留，spinner 會停止。
    /// 找不到對應進行中的工作（已結束 / 不存在）仍回 Ok（冪等）。
    /// </summary>
    private static IResult CancelAsk(
        string canvasId,
        ICurrentUser currentUser,
        CancelAskRequest req,
        AskCancellationRegistry cancelRegistry)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.NodeId))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("NodeId is required"), StatusCodes.Status400BadRequest);
        }

        var cancelled = cancelRegistry.TryCancel(req.NodeId);
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { NodeId = req.NodeId, Cancelled = cancelled }));
    }
}
