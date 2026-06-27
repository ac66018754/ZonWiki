using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Auth;

/// <summary>
/// API 個人存取權杖（PAT）的驗證處理常式（Bearer 權杖）。
///
/// 流程：讀 <c>Authorization: Bearer &lt;token&gt;</c> → 把權杖雜湊 → 依雜湊查 <see cref="Domain.Entities.ApiToken"/>
/// → 檢查有效（ValidFlag）與未過期 → 建立帶 <c>user_id</c> 宣告的身分 → 該請求即以此使用者身分執行。
///
/// 關鍵實作（避免「使用者隔離模型鎖死」陷阱）：
/// 本系統把目前使用者 Id 以常數烤進 EF 模型、並依使用者快取（<see cref="UserModelCacheKeyFactory"/>）；
/// 一個 DbContext 實例的模型在「第一次查詢」時即固定。驗證權杖發生在「使用者身分尚未設定」之時
/// （此刻 CurrentUserId 為 <see cref="Guid.Empty"/>），若直接用「請求範圍」的 DbContext 查詢，會把該 context
/// 的模型鎖死在 Guid.Empty → 之後端點查不到任何資料。
/// 因此這裡<b>另開一個子服務範圍（child scope）</b>取一個獨立 DbContext 做權杖查找（並 IgnoreQueryFilters），
/// 用完即棄；請求範圍的 DbContext 維持「乾淨、未被查詢」，待端點執行（此時身分已設定）才首次查詢、鎖定正確使用者。
/// 「最終防線」具現化攔截器在 CurrentUserId 為空時放行，故此處查找不會被誤擋。
/// </summary>
public sealed class ApiTokenAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    /// <summary>
    /// 此驗證方案（scheme）的名稱。供 AuthExtensions 的 policy scheme 選擇器轉發到此處理常式。
    /// </summary>
    public const string SchemeName = "ApiToken";

    /// <summary>
    /// Bearer 權杖前綴（標頭格式 <c>Authorization: Bearer &lt;token&gt;</c>）。
    /// </summary>
    private const string BearerPrefix = "Bearer ";

    /// <summary>
    /// 「最後使用時間」更新節流：距上次更新超過此間隔才再寫一次，避免每個請求都寫 DB。
    /// </summary>
    private static readonly TimeSpan LastUsedThrottle = TimeSpan.FromMinutes(5);

    /// <summary>
    /// 建立權杖驗證處理常式。
    /// </summary>
    /// <param name="options">驗證方案選項監視器。</param>
    /// <param name="logger">記錄器工廠。</param>
    /// <param name="encoder">URL 編碼器。</param>
    public ApiTokenAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    /// <summary>
    /// 驗證請求中的 Bearer 權杖。
    /// </summary>
    /// <returns>
    /// 成功時回傳帶 <c>user_id</c> 等宣告的 <see cref="AuthenticateResult"/>；
    /// 無 Bearer 標頭時回 <see cref="AuthenticateResult.NoResult"/>；權杖無效/過期時回 <see cref="AuthenticateResult.Fail(string)"/>。
    /// </returns>
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // 1. 取出 Authorization 標頭並確認是 Bearer。
        string? authorization = Request.Headers.Authorization;
        if (string.IsNullOrWhiteSpace(authorization)
            || !authorization.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            // 沒有帶 Bearer 權杖 → 不是本方案要處理的請求（交由其它方案 / 視為未驗證）。
            return AuthenticateResult.NoResult();
        }

        var token = authorization[BearerPrefix.Length..].Trim();
        if (string.IsNullOrEmpty(token))
        {
            return AuthenticateResult.Fail("Empty bearer token.");
        }

        var tokenHash = ApiTokenGenerator.ComputeHash(token);

        // 2. 以「子服務範圍」取獨立 DbContext 查找權杖（避免鎖死請求範圍 DbContext 的使用者模型）。
        using var scope = Context.RequestServices.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();

        try
        {
            // 此時尚無使用者身分（CurrentUserId 為空）；必須 IgnoreQueryFilters 才看得到任何權杖列。
            var apiToken = await db.ApiToken
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(t => t.TokenHash == tokenHash && t.ValidFlag, Context.RequestAborted);

            if (apiToken is null)
            {
                return AuthenticateResult.Fail("Invalid API token.");
            }

            // 3. 到期檢查。
            if (apiToken.ExpiresDateTime is DateTime expiresAt && expiresAt <= DateTime.UtcNow)
            {
                return AuthenticateResult.Fail("API token has expired.");
            }

            // 4. 載入使用者基本資料（email / 顯示名稱）以填入宣告；同時確認帳號仍有效。
            var user = await db.User
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(u => u.Id == apiToken.UserId && u.ValidFlag, Context.RequestAborted);

            if (user is null)
            {
                // 權杖存在但帳號已刪除/停用 → 視為無效。
                return AuthenticateResult.Fail("Owning account is no longer active.");
            }

            // 5. 更新「最後使用時間」（節流；最佳努力、失敗不影響驗證結果）。
            await TryUpdateLastUsedAsync(db, apiToken, Context.RequestAborted);

            // 6. 建立身分（與 Cookie 登入相同的宣告，讓既有端點/服務無感共用）。
            var claims = new List<Claim>
            {
                new(AuthExtensions.UserIdClaimType, user.Id.ToString()),
                new(ClaimTypes.Email, user.Email),
                new(ClaimTypes.Name, user.DisplayName),
                // 標記此身分來自 API 權杖（供日後稽核/限制用）。
                new("auth_method", "api_token"),
            };

            var identity = new ClaimsIdentity(claims, SchemeName);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, SchemeName);

            return AuthenticateResult.Success(ticket);
        }
        catch (OperationCanceledException)
        {
            // 請求中止：不視為驗證失敗事件，回 NoResult 讓管線自然結束。
            return AuthenticateResult.NoResult();
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "API token 驗證時發生未預期錯誤。");
            return AuthenticateResult.Fail("API token validation error.");
        }
    }

    /// <summary>
    /// 節流更新權杖的「最後使用時間」：距上次更新超過門檻才寫一次。
    /// 最佳努力——任何錯誤都吞掉，不可影響驗證流程。
    /// </summary>
    /// <param name="db">子範圍的資料庫內容。</param>
    /// <param name="apiToken">已查到的權杖實體。</param>
    /// <param name="ct">取消權杖。</param>
    private static async Task TryUpdateLastUsedAsync(
        ZonWikiDbContext db,
        Domain.Entities.ApiToken apiToken,
        CancellationToken ct)
    {
        try
        {
            var now = DateTime.UtcNow;
            if (apiToken.LastUsedDateTime is DateTime last && now - last < LastUsedThrottle)
            {
                return; // 太近，跳過以免每個請求都寫 DB。
            }

            apiToken.LastUsedDateTime = now;
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            // 刻意吞掉：最後使用時間只是輔助資訊，更新失敗不應讓 API 呼叫驗證失敗。
        }
    }
}
