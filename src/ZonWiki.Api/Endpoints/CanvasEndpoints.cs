using System.Net.Mime;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Realtime;
using ZonWiki.Domain.Common;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布 SSE 端點（P4 第一版：基礎架構，完整功能 pending Canvas schema）。
/// </summary>
public static class CanvasEndpoints
{
    /// <summary>
    /// 註冊開問啦相關端點。
    /// </summary>
    public static void MapCanvasEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/canvas");

        group.MapGet("/sse/{canvasId}",
            CanvasSSESubscribe)
            .WithName("CanvasSSE")
            .WithOpenApi()
            .Produces(StatusCodes.Status200OK, contentType: "text/event-stream");
    }

    /// <summary>
    /// 訂閱畫布的 SSE 事件流（含補播機制）。
    /// 需驗證使用者對該畫布的訪問權限。
    /// </summary>
    private static async Task CanvasSSESubscribe(
        string canvasId,
        SseHub hub,
        IHttpContextAccessor httpContextAccessor,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        int afterSeq = 0,
        CancellationToken cancellationToken = default)
    {
        var httpContext = httpContextAccessor.HttpContext;
        if (httpContext is null)
        {
            httpContext?.Response.StatusCode = StatusCodes.Status500InternalServerError;
            return;
        }

        // 驗證使用者已認證
        if (currentUser.UserId == Guid.Empty)
        {
            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        // 驗證畫布存在且屬於當前使用者
        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var canvas = await db.Canvas
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, cancellationToken);

        if (canvas is null)
        {
            httpContext.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var response = httpContext.Response;
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        response.Headers.Connection = "keep-alive";

        try
        {
            await foreach (var evt in hub.SubscribeAsync(canvasId, afterSeq, cancellationToken))
            {
                var json = JsonSerializer.Serialize(evt);
                await response.WriteAsync($"data: {json}\n\n", cancellationToken);
                await response.Body.FlushAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // 客戶端中斷，正常結束。
        }
    }
}
