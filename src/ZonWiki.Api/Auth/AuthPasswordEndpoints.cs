using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Auth;

/// <summary>
/// 本機密碼驗證端點：註冊、登入、修改密碼等。
/// </summary>
public static class AuthPasswordEndpoints
{
    /// <summary>
    /// DTO：註冊請求
    /// </summary>
    public sealed record RegisterRequest(
        /// <summary>
        /// 帳號（登入識別字；存於 User_Email 欄位，本系統不要求 email 格式）
        /// </summary>
        string Account,
        /// <summary>
        /// 密碼（最少 8 個字元）
        /// </summary>
        string Password,
        /// <summary>
        /// 顯示名稱
        /// </summary>
        string DisplayName);

    /// <summary>
    /// DTO：登入請求
    /// </summary>
    public sealed record LoginRequest(
        /// <summary>
        /// 帳號（登入識別字）
        /// </summary>
        string Account,
        /// <summary>
        /// 密碼
        /// </summary>
        string Password);

    /// <summary>
    /// DTO：修改密碼請求
    /// </summary>
    public sealed record ChangePasswordRequest(
        /// <summary>
        /// 當前密碼
        /// </summary>
        string CurrentPassword,
        /// <summary>
        /// 新密碼（最少 8 個字元）
        /// </summary>
        string NewPassword);

    /// <summary>
    /// DTO：驗證回應
    /// </summary>
    public sealed record AuthResponse(
        /// <summary>
        /// 使用者 ID
        /// </summary>
        string UserId,
        /// <summary>
        /// 電子郵件
        /// </summary>
        string Email,
        /// <summary>
        /// 顯示名稱
        /// </summary>
        string DisplayName);

    /// <summary>
    /// 對應本機密碼驗證端點。
    /// </summary>
    /// <param name="app">Web 應用程式</param>
    public static void MapAuthPasswordEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth")
            .WithTags("Authentication");

        group.MapPost("/register", RegisterAsync)
            .WithName("Register")
            .WithOpenApi()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status409Conflict)
            .AllowAnonymous();

        group.MapPost("/login", LoginAsync)
            .WithName("Login")
            .WithOpenApi()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .AllowAnonymous();

        group.MapPost("/change-password", ChangePasswordAsync)
            .WithName("ChangePassword")
            .WithOpenApi()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .RequireAuthorization();
    }

    /// <summary>
    /// 使用者註冊端點。
    /// </summary>
    /// <param name="request">註冊請求（email、password、displayName）</param>
    /// <param name="db">資料庫上下文</param>
    /// <param name="http">HTTP 內容</param>
    /// <param name="ct">取消權杖</param>
    /// <returns>成功時返回 200 及使用者資訊；email 已存在時返回 409；驗證失敗時返回 400</returns>
    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        ZonWikiDbContext db,
        HttpContext http,
        CancellationToken ct)
    {
        // 驗證輸入（本系統以「帳號」登入，不需要 email、不需要驗證碼）
        var account = (request.Account ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(account))
        {
            return Results.BadRequest(new
            {
                success = false,
                error = "帳號為必填",
                statusCode = 400
            });
        }

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
        {
            return Results.BadRequest(new
            {
                success = false,
                error = "密碼至少需要 8 個字元",
                statusCode = 400
            });
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            return Results.BadRequest(new
            {
                success = false,
                error = "顯示名稱為必填",
                statusCode = 400
            });
        }

        // 檢查帳號是否已存在（只看「有效」帳號；已刪除的可重新註冊）。帳號存於 User_Email 欄位。
        var existingUser = await db.User
            .FirstOrDefaultAsync(u => u.Email == account && u.ValidFlag, ct);

        if (existingUser is not null)
        {
            return Results.Json(
                new { success = false, error = "此帳號已被註冊", statusCode = 409 },
                statusCode: StatusCodes.Status409Conflict);
        }

        // 建立新使用者
        var passwordHasher = new PasswordHasher<User>();
        var newUser = new User
        {
            GoogleSub = null, // 本機帳號無 Google 身分；用 null（非 ""）以免唯一索引衝突
            Email = account, // 帳號存於 Email 欄位（本系統不要求 email 格式）
            DisplayName = request.DisplayName,
            AvatarUrl = null,
            TimeZone = string.Empty,
            DisplayMode = "warmpaper",
        };

        // 密碼雜湊
        newUser.PasswordHash = passwordHasher.HashPassword(newUser, request.Password);

        db.User.Add(newUser);
        await db.SaveChangesAsync(ct);

        // 登入：建立 Cookie
        await SignInUserAsync(http, newUser);

        return Results.Ok(new
        {
            success = true,
            data = new AuthResponse(
                UserId: newUser.Id.ToString(),
                Email: newUser.Email,
                DisplayName: newUser.DisplayName)
        });
    }

    /// <summary>
    /// 使用者登入端點。
    /// </summary>
    /// <param name="request">登入請求（email、password）</param>
    /// <param name="db">資料庫上下文</param>
    /// <param name="http">HTTP 內容</param>
    /// <param name="ct">取消權杖</param>
    /// <returns>成功時返回 200 及使用者資訊；憑證不正確時返回 401</returns>
    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        ZonWikiDbContext db,
        HttpContext http,
        CancellationToken ct)
    {
        var account = (request.Account ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(account) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Unauthorized();
        }

        // 查詢使用者（以帳號＝User_Email 欄位比對；只接受「有效」帳號，已刪除的帳號不可登入）
        var user = await db.User
            .FirstOrDefaultAsync(u => u.Email == account && u.ValidFlag, ct);

        if (user is null || string.IsNullOrEmpty(user.PasswordHash))
        {
            // 帳號不存在或未設定密碼
            return Results.Unauthorized();
        }

        // 驗證密碼
        var passwordHasher = new PasswordHasher<User>();
        var verificationResult = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);

        if (verificationResult == PasswordVerificationResult.Failed)
        {
            return Results.Unauthorized();
        }

        // 登入：建立 Cookie
        await SignInUserAsync(http, user);

        return Results.Ok(new
        {
            success = true,
            data = new AuthResponse(
                UserId: user.Id.ToString(),
                Email: user.Email,
                DisplayName: user.DisplayName)
        });
    }

    /// <summary>
    /// 修改密碼端點（需要認證）。
    /// </summary>
    /// <param name="request">修改密碼請求</param>
    /// <param name="db">資料庫上下文</param>
    /// <param name="http">HTTP 內容</param>
    /// <param name="ct">取消權杖</param>
    /// <returns>成功時返回 200；驗證失敗時返回 401</returns>
    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        ZonWikiDbContext db,
        HttpContext http,
        CancellationToken ct)
    {
        // 取得當前使用者
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return Results.Unauthorized();
        }

        // 查詢使用者（不受 EF global filter 限制，因為是當前認證使用者）
        var user = await db.User.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user is null || string.IsNullOrEmpty(user.PasswordHash))
        {
            return Results.Unauthorized();
        }

        // 驗證當前密碼
        var passwordHasher = new PasswordHasher<User>();
        var verificationResult = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword);

        if (verificationResult == PasswordVerificationResult.Failed)
        {
            return Results.Unauthorized();
        }

        // 驗證新密碼
        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
        {
            return Results.BadRequest(new
            {
                success = false,
                error = "New password must be at least 8 characters",
                statusCode = 400
            });
        }

        // 設定新密碼雜湊
        user.PasswordHash = passwordHasher.HashPassword(user, request.NewPassword);
        user.UpdatedDateTime = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);

        return Results.Ok(new { success = true });
    }

    /// <summary>
    /// 幫助方法：簽入使用者（建立驗證 Cookie）。
    /// </summary>
    /// <param name="http">HTTP 內容</param>
    /// <param name="user">使用者實體</param>
    internal static async Task SignInUserAsync(HttpContext http, User user)
    {
        var claims = new List<Claim>
        {
            new(AuthExtensions.UserIdClaimType, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName),
        };

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);

        await http.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddDays(30),
            });
    }
}
