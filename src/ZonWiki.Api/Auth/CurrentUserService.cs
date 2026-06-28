using System.Security.Claims;
using ZonWiki.Domain.Common;

namespace ZonWiki.Api.Auth;

/// <summary>
/// 從 HttpContext 擷取目前登入使用者的身分資訊。
/// 由於 HttpContextAccessor 是 scoped，此服務也是 scoped，
/// 與 HTTP 請求的生命週期相同。
/// </summary>
public sealed class CurrentUserService : ICurrentUser
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    /// <summary>
    /// 建構式。
    /// </summary>
    /// <param name="httpContextAccessor">用於存取 HttpContext 的服務。</param>
    public CurrentUserService(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
    }

    /// <inheritdoc />
    public Guid UserId
    {
        get
        {
            var context = _httpContextAccessor.HttpContext;
            if (context?.User.Identity?.IsAuthenticated != true)
            {
                return Guid.Empty;
            }

            var userIdClaim = context.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Guid.Empty;
            }

            return userId;
        }
    }

    /// <inheritdoc />
    public string? Email
    {
        get
        {
            var context = _httpContextAccessor.HttpContext;
            if (context?.User.Identity?.IsAuthenticated != true)
            {
                return null;
            }

            return context.User.FindFirst(ClaimTypes.Email)?.Value;
        }
    }

    /// <inheritdoc />
    public bool IsAuthenticated
    {
        get
        {
            var context = _httpContextAccessor.HttpContext;
            return context?.User.Identity?.IsAuthenticated ?? false;
        }
    }

    /// <inheritdoc />
    public string Source
    {
        get
        {
            var context = _httpContextAccessor.HttpContext;
            if (context?.User.Identity?.IsAuthenticated != true)
            {
                return "web";
            }

            // 由 API 權杖驗證的請求帶有 auth_method=api_token 與 token_name 宣告；
            // 以權杖名稱作為來源（例如 "Claude Code"），讓活動紀錄能分辨是哪個 AI 操作。
            var authMethod = context.User.FindFirst("auth_method")?.Value;
            if (string.Equals(authMethod, "api_token", StringComparison.Ordinal))
            {
                var tokenName = context.User.FindFirst("token_name")?.Value;
                return string.IsNullOrWhiteSpace(tokenName) ? "api" : tokenName;
            }

            return "web";
        }
    }
}
