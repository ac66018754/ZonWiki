using System.Collections.Concurrent;

namespace ZonWiki.Api.Coach;

/// <summary>
/// <c>/ws/coach</c> 建線速率限流（【審修-S2】）：既有 <c>RateLimiter</c> 中介軟體只掛 HTTP 端點，
/// WebSocket upgrade 不經任何限流，故此處以「單機記憶體固定視窗」對每 user／IP 每分鐘的建線次數設限
/// （防被盜 Cookie 或前端 bug 狂開 Live 連線灌爆計費）。單實例部署，不引入 Redis（比照既有限流決策）。
/// </summary>
public static class CoachConnectRateLimiter
{
    /// <summary>固定視窗長度（1 分鐘）。</summary>
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    /// <summary>分區鍵 → （視窗起點, 本視窗計數）。</summary>
    private static readonly ConcurrentDictionary<string, WindowCounter> Counters = new();

    /// <summary>
    /// 嘗試對某分區鍵記一次建線；若本分鐘內已達上限則拒絕。
    /// </summary>
    /// <param name="partitionKey">分區鍵（user:{id} 或 ip:{addr}）。</param>
    /// <param name="limitPerMinute">每分鐘上限（&lt;=0 視為不限流，一律放行）。</param>
    /// <returns>允許建線時為 true；已達上限為 false。</returns>
    public static bool TryAcquire(string partitionKey, int limitPerMinute)
    {
        if (limitPerMinute <= 0)
        {
            return true;
        }

        var now = DateTime.UtcNow;
        var updated = Counters.AddOrUpdate(
            partitionKey,
            _ => new WindowCounter(now, 1),
            (_, existing) => now - existing.WindowStart >= Window
                ? new WindowCounter(now, 1)            // 視窗已過 → 重置。
                : existing with { Count = existing.Count + 1 });

        return updated.Count <= limitPerMinute;
    }

    /// <summary>固定視窗計數（視窗起點＋本視窗已用次數）。</summary>
    /// <param name="WindowStart">本視窗起點（UTC）。</param>
    /// <param name="Count">本視窗已用次數。</param>
    private sealed record WindowCounter(DateTime WindowStart, int Count);
}
