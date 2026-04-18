using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using ZonWiki.Infrastructure.Auth;

namespace ZonWiki.Api.Auth;

public static class AuthExtensions
{
    public const string AuthCookieName = "zonwiki.auth";
    public const string UserIdClaimType = "user_id";

    public static IServiceCollection AddZonWikiAuth(
        this IServiceCollection services,
        IConfiguration configuration,
        out bool isConfigured)
    {
        var clientId = configuration["Authentication:Google:ClientId"];
        var clientSecret = configuration["Authentication:Google:ClientSecret"];

        isConfigured = !string.IsNullOrWhiteSpace(clientId)
                       && !string.IsNullOrWhiteSpace(clientSecret);

        if (!isConfigured)
        {
            return services;
        }

        var allowedEmails = configuration
            .GetSection("Authentication:AllowedEmails")
            .Get<string[]>() ?? [];

        services
            .AddAuthentication(options =>
            {
                options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = GoogleDefaults.AuthenticationScheme;
            })
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
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = ctx =>
                {
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
            })
            .AddGoogle(options =>
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

        services.AddAuthorization();

        return services;
    }

    public static void MapZonWikiAuthEndpoints(this WebApplication app, bool isConfigured)
    {
        if (!isConfigured)
        {
            app.MapGet("/api/auth/login", () =>
                Results.Json(new
                {
                    success = false,
                    error = "Google OAuth is not configured. Set Authentication:Google:ClientId and ClientSecret in user secrets or appsettings.",
                    statusCode = 503
                }, statusCode: StatusCodes.Status503ServiceUnavailable));

            app.MapGet("/api/me", () =>
                Results.Json(new
                {
                    success = false,
                    error = "Auth not configured",
                    statusCode = 401
                }, statusCode: StatusCodes.Status401Unauthorized));
            return;
        }

        app.MapGet("/api/auth/login", (string? returnUrl) =>
        {
            var redirect = string.IsNullOrEmpty(returnUrl) ? "/" : returnUrl;
            var props = new AuthenticationProperties { RedirectUri = redirect };
            return Results.Challenge(props, [GoogleDefaults.AuthenticationScheme]);
        });

        app.MapPost("/api/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { success = true });
        });

        app.MapGet("/api/me", (HttpContext http) =>
        {
            if (http.User.Identity?.IsAuthenticated != true)
            {
                return Results.Json(new
                {
                    success = false,
                    error = "Not authenticated",
                    statusCode = 401
                }, statusCode: StatusCodes.Status401Unauthorized);
            }

            var userId = http.User.FindFirst(UserIdClaimType)?.Value;
            var email = http.User.FindFirst(ClaimTypes.Email)?.Value;
            var name = http.User.FindFirst(ClaimTypes.Name)?.Value;

            return Results.Ok(new
            {
                success = true,
                data = new { userId, email, displayName = name }
            });
        });
    }
}
