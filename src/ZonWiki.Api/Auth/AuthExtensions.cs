using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Auth;

public static class AuthExtensions
{
    public const string AuthCookieName = "zonwiki.auth";
    public const string UserIdClaimType = "user_id";

    /// <summary>
    /// 「智慧選擇」policy scheme 名稱：依請求是否帶 Bearer 標頭，分流到 ApiToken 或 Cookie 驗證。
    /// </summary>
    public const string SmartAuthScheme = "ZonWikiSmartAuth";

    /// <summary>
    /// 註冊 ZonWiki 驗證服務：Cookie 驗證一律啟用；Google OAuth 為選擇性加強。
    /// </summary>
    /// <param name="services">服務集合</param>
    /// <param name="configuration">設定物件</param>
    /// <param name="isConfigured">輸出：Google OAuth 是否有效設定</param>
    /// <returns>更新後的服務集合</returns>
    public static IServiceCollection AddZonWikiAuth(
        this IServiceCollection services,
        IConfiguration configuration,
        out bool isConfigured)
    {
        var clientId = configuration["Authentication:Google:ClientId"];
        var clientSecret = configuration["Authentication:Google:ClientSecret"];

        isConfigured = !string.IsNullOrWhiteSpace(clientId)
                       && !string.IsNullOrWhiteSpace(clientSecret);

        var allowedEmails = configuration
            .GetSection("Authentication:AllowedEmails")
            .Get<string[]>() ?? [];

        // 建立驗證服務：Cookie 驗證一律啟用
        var defaultChallengeScheme = isConfigured
            ? GoogleDefaults.AuthenticationScheme
            : CookieAuthenticationDefaults.AuthenticationScheme;

        services
            .AddAuthentication(options =>
            {
                // 預設驗證走「智慧選擇」policy scheme：依請求是否帶 Bearer 標頭，
                // 分流到 ApiToken（外部 AI 助理）或 Cookie（瀏覽器登入）。
                options.DefaultScheme = SmartAuthScheme;
                // 簽入/簽出一律落在 Cookie（瀏覽器登入流程；Google 回呼亦用 Cookie 簽入）。
                options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.DefaultSignOutScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                // Google 為選擇性的 challenge scheme
                options.DefaultChallengeScheme = defaultChallengeScheme;
            })
            // 智慧選擇：帶 "Authorization: Bearer ..." 的請求 → ApiToken 驗證；其餘 → Cookie 驗證。
            .AddPolicyScheme(SmartAuthScheme, "Cookie 或 API 權杖", options =>
            {
                options.ForwardDefaultSelector = context =>
                {
                    string? authorization = context.Request.Headers.Authorization;
                    if (!string.IsNullOrEmpty(authorization)
                        && authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                    {
                        return ApiTokenAuthenticationHandler.SchemeName;
                    }
                    return CookieAuthenticationDefaults.AuthenticationScheme;
                };
            })
            // API 個人存取權杖（PAT）驗證方案。
            .AddScheme<AuthenticationSchemeOptions, ApiTokenAuthenticationHandler>(
                ApiTokenAuthenticationHandler.SchemeName,
                _ => { })
            .AddCookie(options =>
            {
                options.Cookie.Name = AuthCookieName;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.ExpireTimeSpan = TimeSpan.FromDays(30);
                options.SlidingExpiration = true;
                options.Events.OnRedirectToLogin = ctx =>
                {
                    // 返回 JSON 401 而非重導
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = ctx =>
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
            });

        // Google OAuth：若已設定，才額外掛載
        if (isConfigured)
        {
            var authBuilder = services.AddAuthentication();
            authBuilder.AddGoogle(options =>
            {
                options.ClientId = clientId!;
                options.ClientSecret = clientSecret!;
                options.CallbackPath = "/signin-google";
                options.SaveTokens = false;
                options.Scope.Add("openid");
                options.Scope.Add("email");
                options.Scope.Add("profile");

                options.Events.OnTicketReceived = async ctx =>
                {
                    var principal = ctx.Principal
                        ?? throw new InvalidOperationException("Principal missing on Google ticket.");

                    var sub = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                    var email = principal.FindFirst(ClaimTypes.Email)?.Value;
                    var name = principal.FindFirst(ClaimTypes.Name)?.Value;
                    var picture = principal.FindFirst("picture")?.Value;

                    if (string.IsNullOrEmpty(sub) || string.IsNullOrEmpty(email))
                    {
                        ctx.Fail("Missing required Google claims (sub or email).");
                        return;
                    }

                    if (allowedEmails.Length > 0
                        && !allowedEmails.Contains(email, StringComparer.OrdinalIgnoreCase))
                    {
                        ctx.Fail($"Email {email} is not in the allowed list.");
                        return;
                    }

                    var provisioning = ctx.HttpContext.RequestServices
                        .GetRequiredService<UserProvisioningService>();

                    var user = await provisioning.EnsureUserAsync(
                        googleSub: sub,
                        email: email,
                        displayName: name ?? email,
                        avatarUrl: picture,
                        cancellationToken: ctx.HttpContext.RequestAborted);

                    if (principal.Identity is ClaimsIdentity identity)
                    {
                        identity.AddClaim(new Claim(UserIdClaimType, user.Id.ToString()));
                    }
                };
            });
        }

        // 授權：一律啟用
        services.AddAuthorization(options =>
        {
            // 預設原則：要求認證
            options.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
        });

        return services;
    }

    /// <summary>
    /// 對應 ZonWiki 驗證端點：
    /// - /api/auth/register (POST) — 本機帳號註冊
    /// - /api/auth/login (POST) — 本機帳號登入
    /// - /api/auth/logout (POST) — 登出
    /// - /api/auth/change-password (POST) — 修改密碼
    /// - /api/me (GET) — 取得當前使用者
    /// - /api/auth/login (GET) — OAuth 登入（若已設定）
    ///
    /// 所有端點前綴可透過 AllowAnonymous 豁免授權檢查。
    /// </summary>
    public static void MapZonWikiAuthEndpoints(this WebApplication app, bool isConfigured)
    {
        // 登出端點：一律可用
        app.MapPost("/api/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { success = true });
        }).AllowAnonymous();

        // 取得當前使用者：一律可用。
        // 除了 claims（userId / email / displayName），另從 DB 取使用者偏好
        // （時區 timeZone、顯示模式 displayMode），讓前端所有時間顯示能依使用者選定的時區換算
        // （時區為空字串＝跟隨裝置預設）。
        app.MapGet("/api/me", async (
            HttpContext http,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (http.User.Identity?.IsAuthenticated != true)
            {
                return Results.Json(
                    new { success = false, error = "Not authenticated", statusCode = 401 },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            var userId = http.User.FindFirst(UserIdClaimType)?.Value;
            var email = http.User.FindFirst(ClaimTypes.Email)?.Value;
            var name = http.User.FindFirst(ClaimTypes.Name)?.Value;

            // 已驗證但 user_id claim 缺失/格式錯誤 → 視為無效工作階段，回 401（讓前端導回登入）。
            if (!Guid.TryParse(userId, out var userGuid))
            {
                return Results.Json(
                    new { success = false, error = "Invalid session", statusCode = 401 },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            // 從 DB 取使用者偏好（時區 / 顯示模式）；明確檢查 ValidFlag，排除已軟刪除（刪帳號）的使用者。
            try
            {
                var prefs = await db.User
                    .Where(u => u.Id == userGuid && u.ValidFlag)
                    .Select(u => new { u.TimeZone, u.DisplayMode })
                    .FirstOrDefaultAsync(ct);

                // 找不到（不存在或已刪帳號）→ 回 401，不靜默回預設值掩蓋已登出狀態。
                if (prefs is null)
                {
                    return Results.Json(
                        new { success = false, error = "User account not found", statusCode = 401 },
                        statusCode: StatusCodes.Status401Unauthorized);
                }

                return Results.Ok(new
                {
                    success = true,
                    data = new
                    {
                        userId,
                        email,
                        displayName = name,
                        timeZone = prefs.TimeZone,
                        displayMode = prefs.DisplayMode,
                    }
                });
            }
            catch
            {
                // DB 暫時不可用：回 503，前端會視為「暫時性錯誤、你仍在登入狀態」，不誤踢登出。
                return Results.Json(
                    new { success = false, error = "Service temporarily unavailable", statusCode = 503 },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        }).AllowAnonymous();

        // Google OAuth 登入（若已設定）
        if (isConfigured)
        {
            app.MapGet("/api/auth/login", (string? returnUrl) =>
            {
                var redirect = string.IsNullOrEmpty(returnUrl) ? "/" : returnUrl;
                var props = new AuthenticationProperties { RedirectUri = redirect };
                return Results.Challenge(props, [GoogleDefaults.AuthenticationScheme]);
            }).AllowAnonymous();
        }
    }
}
