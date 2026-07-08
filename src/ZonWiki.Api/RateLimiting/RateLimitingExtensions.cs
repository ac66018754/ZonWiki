using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;

namespace ZonWiki.Api.RateLimiting;

/// <summary>
/// ZonWiki 端點限流（rate limiting）設定。
///
/// 對應審查發現 #30/#58「全站無 rate limit，AI 與認證端點無節流」：
/// 對外的 PAT（Bearer）與 AI 提問／精煉端點會實際觸發付費 LLM 呼叫並 spawn yt-dlp/ffmpeg 子行程，
/// 一個被盜權杖或無窮迴圈就能灌爆外部 API 額度或撐爆 2GB VM 記憶體；密碼登入端點則可被暴力破解。
///
/// 決策（見 docs/DECISIONS.md 2026-07-06）：只用 .NET 內建 <c>System.Threading.RateLimiting</c> 的
/// 「單機記憶體計數」限流器，<b>不引入 Redis</b>——本系統為單實例部署（單台 VM），跨實例分散式限流
/// 目前用不到；日後真的水平擴充再換 Redis 後端。
///
/// 三個具名 policy：
/// - <see cref="LoginPolicy"/>：密碼登入／註冊。以「用戶端 IP」分區的 FixedWindow（較嚴，防暴力破解）。
/// - <see cref="AiPolicy"/>：AI 提問／精煉。以「UserId 宣告（退回 IP）」分區的 SlidingWindow（防迴圈灌爆付費 LLM）。
/// - <see cref="PatPolicy"/>：PAT 驗證的對外整合端點與權杖產生。以「UserId／權杖」分區的 TokenBucket（允許短暫爆量、長期受限）。
///
/// 逾限一律回 HTTP 429＋明確 JSON 訊息（<see cref="ApiResponse{T}"/> 格式），並在可得時附上 <c>Retry-After</c> 標頭。
/// </summary>
public static class RateLimitingExtensions
{
    /// <summary>
    /// 密碼登入／註冊端點的限流 policy 名稱（以用戶端 IP 分區、FixedWindow、較嚴，防暴力破解）。
    /// </summary>
    public const string LoginPolicy = "zonwiki-login";

    /// <summary>
    /// AI 提問／精煉端點的限流 policy 名稱（以 UserId 分區、SlidingWindow，防迴圈灌爆付費 LLM）。
    /// </summary>
    public const string AiPolicy = "zonwiki-ai";

    /// <summary>
    /// PAT（個人存取權杖）對外整合端點與權杖產生的限流 policy 名稱（以 UserId／權杖分區、TokenBucket）。
    /// </summary>
    public const string PatPolicy = "zonwiki-pat";

    /// <summary>
    /// 附件（圖片）上傳端點的限流 policy 名稱（以 UserId 分區、TokenBucket；
    /// 允許連續貼多張截圖的短暫爆量、長期受限，防磁碟灌爆）。
    /// </summary>
    public const string UploadPolicy = "zonwiki-upload";

    // ── 登入限流參數（IP 分區）───────────────────────────────────────────────
    /// <summary>登入視窗長度（1 分鐘）。</summary>
    private static readonly TimeSpan LoginWindow = TimeSpan.FromMinutes(1);
    /// <summary>單一 IP 於每個登入視窗內允許的請求數上限（防暴力破解，故較嚴）。</summary>
    private const int LoginPermitLimit = 10;

    // ── AI 提問／精煉限流參數（UserId 分區）─────────────────────────────────
    /// <summary>AI 滑動視窗長度（1 分鐘）。</summary>
    private static readonly TimeSpan AiWindow = TimeSpan.FromMinutes(1);
    /// <summary>AI 滑動視窗的分段數（越多越平滑）。</summary>
    private const int AiSegmentsPerWindow = 6;
    /// <summary>單一使用者於每個 AI 滑動視窗內允許的請求數上限。</summary>
    private const int AiPermitLimit = 20;

    // ── PAT 限流參數（UserId／權杖分區）─────────────────────────────────────
    /// <summary>PAT 權杖桶容量（可累積的最大令牌數；允許短暫爆量）。</summary>
    private const int PatTokenLimit = 30;
    /// <summary>每個補充週期補回的令牌數。</summary>
    private const int PatTokensPerPeriod = 15;
    /// <summary>PAT 令牌補充週期（1 分鐘補一次）。</summary>
    private static readonly TimeSpan PatReplenishmentPeriod = TimeSpan.FromMinutes(1);

    // ── 附件上傳限流參數（UserId 分區）──────────────────────────────────────
    /// <summary>附件上傳權杖桶容量（允許一口氣貼多張截圖的短暫爆量）。</summary>
    private const int UploadTokenLimit = 20;
    /// <summary>每個補充週期補回的上傳令牌數。</summary>
    private const int UploadTokensPerPeriod = 10;
    /// <summary>上傳令牌補充週期（1 分鐘補一次）。</summary>
    private static readonly TimeSpan UploadReplenishmentPeriod = TimeSpan.FromMinutes(1);

    /// <summary>
    /// 逾限時回應的 JSON 訊息（繁中＋英文提示，方便前端與外部 AI 客戶端辨識）。
    /// </summary>
    private const string RejectedMessage = "請求過於頻繁，請稍後再試（rate limited）";

    /// <summary>
    /// 註冊 ZonWiki 的限流服務（三個具名 policy＋統一的 429 逾限回應）。
    /// 需搭配 <c>app.UseRateLimiter()</c>（置於 <c>UseAuthentication/UseAuthorization</c> 之後，
    /// 使分區函式可讀到已驗證的 <c>user_id</c> 宣告），並在端點以 <c>RequireRateLimiting(policyName)</c> 掛載。
    /// </summary>
    /// <param name="services">服務集合。</param>
    /// <returns>更新後的服務集合（供鏈式呼叫）。</returns>
    public static IServiceCollection AddZonWikiRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            // 全域逾限狀態碼；細節（訊息、Retry-After）在 OnRejected 補齊。
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            // 密碼登入／註冊：以用戶端 IP 分區的固定視窗；不排隊（超過即拒）。
            options.AddPolicy(LoginPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveClientIpKey(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = LoginPermitLimit,
                        Window = LoginWindow,
                        QueueLimit = 0,
                    }));

            // AI 提問／精煉：以 UserId（退回 IP）分區的滑動視窗；不排隊。
            options.AddPolicy(AiPolicy, httpContext =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    partitionKey: ResolveUserPartitionKey(httpContext),
                    factory: _ => new SlidingWindowRateLimiterOptions
                    {
                        PermitLimit = AiPermitLimit,
                        Window = AiWindow,
                        SegmentsPerWindow = AiSegmentsPerWindow,
                        QueueLimit = 0,
                    }));

            // PAT 對外整合端點／權杖產生：以 UserId／權杖分區的令牌桶；允許短暫爆量、長期受限；不排隊。
            options.AddPolicy(PatPolicy, httpContext =>
                RateLimitPartition.GetTokenBucketLimiter(
                    partitionKey: ResolveUserPartitionKey(httpContext),
                    factory: _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = PatTokenLimit,
                        TokensPerPeriod = PatTokensPerPeriod,
                        ReplenishmentPeriod = PatReplenishmentPeriod,
                        AutoReplenishment = true,
                        QueueLimit = 0,
                    }));

            // 附件上傳：以 UserId 分區的令牌桶；允許連貼多張的爆量、長期受限；不排隊。
            options.AddPolicy(UploadPolicy, httpContext =>
                RateLimitPartition.GetTokenBucketLimiter(
                    partitionKey: ResolveUserPartitionKey(httpContext),
                    factory: _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = UploadTokenLimit,
                        TokensPerPeriod = UploadTokensPerPeriod,
                        ReplenishmentPeriod = UploadReplenishmentPeriod,
                        AutoReplenishment = true,
                        QueueLimit = 0,
                    }));

            // 統一逾限回應：429＋Retry-After（可得時）＋明確 JSON 訊息（UTF-8）。
            options.OnRejected = async (context, cancellationToken) =>
            {
                var httpContext = context.HttpContext;
                httpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;

                // 若限流器提供了「多久後可再試」，附上標準的 Retry-After 秒數標頭。
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    var seconds = (int)Math.Ceiling(retryAfter.TotalSeconds);
                    httpContext.Response.Headers.RetryAfter =
                        seconds.ToString(NumberFormatInfo.InvariantInfo);
                }

                httpContext.Response.ContentType = "application/json; charset=utf-8";
                var payload = ApiResponse<object>.Fail(
                    RejectedMessage,
                    StatusCodes.Status429TooManyRequests);

                // WriteAsJsonAsync 預設以 UTF-8 序列化（符合跨界一律 UTF-8 鐵則）。
                await httpContext.Response.WriteAsJsonAsync(payload, cancellationToken);
            };
        });

        return services;
    }

    /// <summary>
    /// 解析「使用者分區鍵」：優先用已驗證的 <c>user_id</c> 宣告（Cookie 或 PAT 驗證後皆會帶），
    /// 沒有時退回用戶端 IP，最後退回固定字串，確保永遠有非 null 的分區鍵。
    /// </summary>
    /// <param name="httpContext">目前的 HTTP 內容。</param>
    /// <returns>非 null 的分區鍵字串。</returns>
    private static string ResolveUserPartitionKey(HttpContext httpContext)
    {
        var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        if (!string.IsNullOrEmpty(userId))
        {
            return $"user:{userId}";
        }

        return ResolveClientIpKey(httpContext);
    }

    /// <summary>
    /// 解析「用戶端 IP 分區鍵」：正式環境走 Cloudflare Tunnel／反向代理，
    /// 直接讀 <c>RemoteIpAddress</c> 會拿到代理 IP，故優先採 <c>CF-Connecting-IP</c>／
    /// <c>X-Forwarded-For</c>（取第一段＝最初來源），皆無時才退回 <c>RemoteIpAddress</c>。
    /// </summary>
    /// <param name="httpContext">目前的 HTTP 內容。</param>
    /// <returns>非 null 的 IP 分區鍵字串。</returns>
    private static string ResolveClientIpKey(HttpContext httpContext)
    {
        // Cloudflare 會帶原始來源 IP 於 CF-Connecting-IP。
        var cloudflareIp = httpContext.Request.Headers["CF-Connecting-IP"].ToString();
        if (!string.IsNullOrWhiteSpace(cloudflareIp))
        {
            return $"ip:{cloudflareIp.Trim()}";
        }

        // 一般反向代理帶 X-Forwarded-For（可能是逗號分隔的鏈，取第一段＝最初來源）。
        var forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            var firstHop = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (firstHop.Length > 0)
            {
                return $"ip:{firstHop[0]}";
            }
        }

        var remoteIp = httpContext.Connection.RemoteIpAddress?.ToString();
        return string.IsNullOrEmpty(remoteIp) ? "ip:unknown" : $"ip:{remoteIp}";
    }
}
