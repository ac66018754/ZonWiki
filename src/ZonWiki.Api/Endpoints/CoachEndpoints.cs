using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Coach;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 英文教練（其他功能群 Phase 3・批次 2）端點：<c>/ws/coach</c> Live 代理（四護欄）＋場次 REST。
///
/// 安全（【審修-S7/S3/S2/A5/S1】）：
/// - <c>/ws/coach</c> <b>只接受 Cookie 驗證的 principal，明確拒 PAT</b>（一顆外洩 PAT 不得開燒 Live 音訊的教練）。
/// - 四護欄：Origin fail-closed（缺失／不在白名單一律拒）、建線速率限流、每人 1 併發原子 claim（搶到令舊 Abort）、
///   每日分鐘上限（權威計量）。
/// - <b>跨使用者 resumption 防護（IDOR）</b>：指定既有 sessionId 一律先經 <see cref="CoachSessionService"/>
///   以 IgnoreQueryFilters＋明確 userId 驗擁有權，驗過才載入 handle／開場。
///
/// REST（<see cref="ApiResponse{T}"/>＋ExtractUserId）：開課／清單（含懶惰殭屍修正）／取單場（歷史逐字稿＋糾錯卡）。
/// </summary>
public static class CoachEndpoints
{
    /// <summary>標題長度上限（對齊 DB CoachSession.Title HasMaxLength(200)）。</summary>
    private const int MaxTitleLength = 200;

    /// <summary>主題長度上限（對齊 DB CoachSession.Topic HasMaxLength(200)）。</summary>
    private const int MaxTopicLength = 200;

    /// <summary>
    /// 註冊教練相關端點（WS 代理＋場次 REST）。
    /// </summary>
    /// <param name="app">Web 應用程式。</param>
    public static void MapCoachEndpoints(this WebApplication app)
    {
        // Live 代理（WebSocket）：Cookie 驗證＋四護欄；AllowAnonymous 讓端點自行決定回應碼（而非 fallback 401 挑戰）。
        app.MapGet("/ws/coach", CoachWebSocketHandler).AllowAnonymous();

        // 場次 REST（Cookie 或 PAT 皆可——僅場次 CRUD，燒錢的 Live 音訊只在 /ws/coach）。
        app.MapPost("/api/coach/sessions", OpenSessionHandler);
        app.MapGet("/api/coach/sessions", ListSessionsHandler);
        app.MapGet("/api/coach/sessions/{id:guid}", GetSessionHandler);
    }

    // ── /ws/coach（Live 代理＋四護欄）─────────────────────────────────────────────

    /// <summary>
    /// 教練 Live WebSocket 端點。依序：Cookie 驗證（拒 PAT）→Origin→建線限流→擁有權（IDOR 防護）→日分鐘上限
    /// →（是 WS 才）併發 claim→Accept→橋接。任一護欄不過即回對應 HTTP 碼、不 Accept。
    /// </summary>
    private static async Task CoachWebSocketHandler(
        HttpContext http,
        CoachSessionService sessionService,
        IOptions<CoachOptions> optionsAccessor,
        ILoggerFactory loggerFactory,
        Guid? sessionId)
    {
        var logger = loggerFactory.CreateLogger("ZonWiki.Api.Endpoints.CoachEndpoints");
        var options = optionsAccessor.Value;

        // 1) 認證收斂：只接受 Cookie 驗證的 principal，明確拒 PAT。
        var userId = ExtractUserId(http);
        var isCookieAuth = string.Equals(
            http.User.Identity?.AuthenticationType,
            CookieAuthenticationDefaults.AuthenticationScheme,
            StringComparison.Ordinal);
        if (userId == Guid.Empty || !isCookieAuth)
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        // 2) Origin fail-closed：缺失／空／不在白名單一律拒（prod 缺省空陣列＝拒所有）。
        var origin = http.Request.Headers.Origin.ToString();
        if (string.IsNullOrWhiteSpace(origin)
            || options.AllowedOrigins is null
            || !options.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            http.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        // 3) 建線速率限流（每 user 與每 IP 各自每分鐘 N 次；任一超限即拒，含 IP 分區以防多帳號同源放大）。
        var clientIpKey = ResolveClientIpKey(http);
        if (!CoachConnectRateLimiter.TryAcquire($"user:{userId}", options.ConnectRateLimitPerMinute)
            || !CoachConnectRateLimiter.TryAcquire(clientIpKey, options.ConnectRateLimitPerMinute))
        {
            http.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            return;
        }

        // 4) 擁有權（IDOR 防護）：必須指定既有 sessionId 且屬本人。
        if (sessionId is not Guid requestedSessionId)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var session = await sessionService.FindSessionAsync(userId, requestedSessionId, http.RequestAborted);
        if (session is null)
        {
            // 不存在／非本人／已軟刪：一律 404（不洩漏是否存在）。
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (string.Equals(session.Status, CoachSession.StatusEnded, StringComparison.Ordinal))
        {
            // 已結束的場次不可再開 Live。
            http.Response.StatusCode = StatusCodes.Status409Conflict;
            return;
        }

        // 5) 每日分鐘上限（權威計量）。
        if (await sessionService.IsDailyLimitReachedAsync(userId, http.RequestAborted))
        {
            http.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            return;
        }

        // 6) 必須是 WebSocket 握手（護欄皆過但非 WS→400；讓護欄可用純 HTTP 測試而不誤佔併發槽）。
        if (!http.WebSockets.IsWebSocketRequest)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        // 7) 每人 1 併發原子 claim（搶到令舊 proxy 立即釋放 Vertex 連線）。
        var connectionId = Guid.NewGuid();
        var claim = CoachSessionService.ClaimConcurrencySlot(userId, connectionId);
        if (claim.DisplacedConnectionId is Guid displaced)
        {
            // 帶入本次（新）連線的 sessionId：舊 proxy 據此判斷同場交棒（略過收尾）或跨場踢舊（正常收尾舊場）。
            CoachProxyService.SignalDisplaced(displaced, requestedSessionId);
        }

        // 8) Accept→橋接（proxy 為 transient，內部以短命 scope 做 DB 寫入，不吊 DbContext 於連線壽命）。
        try
        {
            using var webSocket = await http.WebSockets.AcceptWebSocketAsync();
            var proxy = http.RequestServices.GetRequiredService<CoachProxyService>();
            var channel = new WebSocketCoachClientChannel(webSocket);
            await proxy.RunAsync(
                channel,
                userId,
                requestedSessionId,
                connectionId,
                session.Topic,
                session.StartedDateTime,
                session.AccumulatedSeconds,
                http.RequestAborted);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "教練 WS 橋接未預期結束（session={SessionId}）。", requestedSessionId);
        }
        finally
        {
            // 只在仍是本連線擁有者時釋放（避免已被踢舊的連線誤刪新擁有者的槽）。
            CoachSessionService.ReleaseConcurrencySlot(userId, connectionId);
        }
    }

    // ── REST：開課／清單／取單場 ─────────────────────────────────────────────────

    /// <summary>開一場新的教練對話（開場即寫 StartedDateTime）。</summary>
    private static async Task<IResult> OpenSessionHandler(
        HttpContext http,
        CoachSessionService sessionService,
        OpenCoachSessionRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var title = request.Title?.Trim();
        if (title is { Length: > MaxTitleLength })
        {
            return Results.Json(
                ApiResponse<CoachSessionDto>.Fail($"標題過長，請縮短到 {MaxTitleLength} 字元以內", 400), statusCode: 400);
        }

        var topic = request.Topic?.Trim();
        if (topic is { Length: > MaxTopicLength })
        {
            return Results.Json(
                ApiResponse<CoachSessionDto>.Fail($"主題過長，請縮短到 {MaxTopicLength} 字元以內", 400), statusCode: 400);
        }

        var session = await sessionService.OpenSessionAsync(userId, title, topic, ct);
        return Results.Created(
            $"/api/coach/sessions/{session.Id}",
            ApiResponse<CoachSessionDto>.Ok(ToDto(session)));
    }

    /// <summary>列出本人有效的教練場次（近期在前；含懶惰殭屍修正）。</summary>
    private static async Task<IResult> ListSessionsHandler(
        HttpContext http,
        CoachSessionService sessionService,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var sessions = await sessionService.ListSessionsAsync(userId, ct);
        var dtos = sessions.Select(ToDto).ToList();
        return Results.Ok(ApiResponse<List<CoachSessionDto>>.Ok(dtos, new { total = dtos.Count }));
    }

    /// <summary>取本人單一場次的歷史逐字稿（場次＋依 SeqNo 遞增的訊息＋糾錯卡）。</summary>
    private static async Task<IResult> GetSessionHandler(
        HttpContext http,
        CoachSessionService sessionService,
        Guid id,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var result = await sessionService.GetSessionWithTranscriptAsync(userId, id, ct);
        if (result is null)
        {
            return Results.Json(ApiResponse<CoachSessionDetailDto>.Fail("場次不存在", 404), statusCode: 404);
        }

        var (session, messages) = result.Value;
        var detail = new CoachSessionDetailDto(
            ToDto(session),
            messages.Select(m => new CoachMessageDto(
                m.Id, m.Role, m.Content, m.CorrectionJson, m.SeqNo, m.InterruptedFlag, m.ApproxCutChars,
                m.CreatedDateTime)).ToList());

        return Results.Ok(ApiResponse<CoachSessionDetailDto>.Ok(detail));
    }

    // ── 共用 ─────────────────────────────────────────────────────────────────────

    /// <summary>教練場次 → 摘要 DTO。</summary>
    private static CoachSessionDto ToDto(CoachSession session) => new(
        session.Id,
        session.Title,
        session.Topic,
        session.Status,
        session.SummaryText,
        session.StartedDateTime,
        session.EndedDateTime,
        session.AccumulatedSeconds,
        session.CreatedDateTime);

    /// <summary>
    /// 解析用戶端 IP 分區鍵（正式走 Cloudflare／反向代理，優先 CF-Connecting-IP／X-Forwarded-For 第一段，
    /// 皆無才用 RemoteIpAddress）。與 RateLimitingExtensions 同慣例。
    /// </summary>
    private static string ResolveClientIpKey(HttpContext http)
    {
        var cloudflareIp = http.Request.Headers["CF-Connecting-IP"].ToString();
        if (!string.IsNullOrWhiteSpace(cloudflareIp))
        {
            return $"ip:{cloudflareIp.Trim()}";
        }

        var forwardedFor = http.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            var firstHop = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (firstHop.Length > 0)
            {
                return $"ip:{firstHop[0]}";
            }
        }

        var remoteIp = http.Connection.RemoteIpAddress?.ToString();
        return string.IsNullOrEmpty(remoteIp) ? "ip:unknown" : $"ip:{remoteIp}";
    }

    /// <summary>自 HttpContext 取使用者 Id（Cookie 或 PAT 皆帶 user_id 宣告）；缺失回 Guid.Empty。</summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return !string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId)
            ? userId
            : Guid.Empty;
    }

    /// <summary>統一 401 回應。</summary>
    private static IResult Unauthorized()
        => Results.Json(ApiResponse<object>.Fail("Invalid user identity", 401), statusCode: 401);
}

/// <summary>開課請求（標題／主題皆可空）。</summary>
/// <param name="Title">場次標題（空白則以主題／時間自動命名）。</param>
/// <param name="Topic">主題（可空）。</param>
public sealed record OpenCoachSessionRequest(string? Title, string? Topic);

/// <summary>教練場次摘要 DTO（清單／開課回傳）。</summary>
/// <param name="Id">場次 Id。</param>
/// <param name="Title">標題。</param>
/// <param name="Topic">主題（可空）。</param>
/// <param name="Status">狀態（active／ended）。</param>
/// <param name="SummaryText">課末摘要（可空）。</param>
/// <param name="StartedDateTime">開場時間（UTC）。</param>
/// <param name="EndedDateTime">收尾時間（UTC；可空）。</param>
/// <param name="AccumulatedSeconds">累計秒數。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record CoachSessionDto(
    Guid Id,
    string Title,
    string? Topic,
    string Status,
    string? SummaryText,
    DateTime StartedDateTime,
    DateTime? EndedDateTime,
    int AccumulatedSeconds,
    DateTime CreatedDateTime);

/// <summary>單一逐字稿訊息 DTO。</summary>
/// <param name="Id">訊息 Id。</param>
/// <param name="Role">角色（user／assistant）。</param>
/// <param name="Content">逐字稿內容。</param>
/// <param name="CorrectionJson">糾錯卡 JSON（可空）。</param>
/// <param name="SeqNo">本場序號。</param>
/// <param name="InterruptedFlag">是否被打斷。</param>
/// <param name="ApproxCutChars">近似截點（可空）。</param>
/// <param name="CreatedDateTime">建立時間（UTC）。</param>
public sealed record CoachMessageDto(
    Guid Id,
    string Role,
    string Content,
    string? CorrectionJson,
    int SeqNo,
    bool InterruptedFlag,
    int? ApproxCutChars,
    DateTime CreatedDateTime);

/// <summary>單一場次詳情 DTO（場次＋逐字稿清單）。</summary>
/// <param name="Session">場次摘要。</param>
/// <param name="Messages">逐字稿訊息（依 SeqNo 遞增）。</param>
public sealed record CoachSessionDetailDto(
    CoachSessionDto Session,
    IReadOnlyList<CoachMessageDto> Messages);
