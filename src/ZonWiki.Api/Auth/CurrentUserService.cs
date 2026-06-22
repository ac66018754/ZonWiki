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
}
