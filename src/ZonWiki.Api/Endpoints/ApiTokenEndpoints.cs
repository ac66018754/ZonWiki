using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// API 個人存取權杖（PAT）管理端點：列出 / 產生 / 撤銷「我的權杖」。
/// 這些端點由「已登入的瀏覽器」呼叫（Cookie 驗證），讓使用者在個人頁自助管理權杖。
/// 安全：明碼權杖只在「產生當下」回傳一次；之後資料庫只存雜湊、無法還原。撤銷＝軟刪除。
/// </summary>
public static class ApiTokenEndpoints
{
    /// <summary>
    /// 建立權杖的請求。
    /// </summary>
    /// <param name="Name">權杖名稱（辨識用途，例如 "Claude Code"）。</param>
    /// <param name="ExpiresInDays">幾天後過期（可空＝永不過期）。</param>
    public sealed record CreateApiTokenRequest(
        string Name,
        int? ExpiresInDays);

    /// <summary>
    /// 權杖資訊（清單用；<b>不含</b>明碼權杖與雜湊）。
    /// </summary>
    /// <param name="Id">權杖識別碼。</param>
    /// <param name="Name">名稱。</param>
    /// <param name="TokenPrefix">明碼前綴（辨識用，例如 "zwk_Ab12cd"）。</param>
    /// <param name="CreatedDateTime">建立時間（UTC）。</param>
    /// <param name="LastUsedDateTime">最後使用時間（UTC，可空＝尚未使用）。</param>
    /// <param name="ExpiresDateTime">到期時間（UTC，可空＝永不過期）。</param>
    /// <param name="Scopes">權限範圍（資訊性）。</param>
    public sealed record ApiTokenDto(
        Guid Id,
        string Name,
        string TokenPrefix,
        DateTime CreatedDateTime,
        DateTime? LastUsedDateTime,
        DateTime? ExpiresDateTime,
        string Scopes);

    /// <summary>
    /// 產生權杖的回應：<b>明碼權杖（只回傳這一次）</b> + 權杖資訊。
    /// </summary>
    /// <param name="Token">完整明碼權杖（請立即複製保存；離開頁面後無法再取得）。</param>
    /// <param name="Info">權杖資訊。</param>
    public sealed record CreatedApiTokenDto(
        string Token,
        ApiTokenDto Info);

    /// <summary>
    /// 註冊權杖管理端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapApiTokenEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出我的權杖（不含明碼/雜湊）。
        app.MapGet("/api/me/tokens", async (
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(
                    ApiResponse<List<ApiTokenDto>>.Fail("Authentication required", 401),
                    statusCode: 401);
            }

            // 全域查詢過濾已限定「本人 + 有效」；依建立時間新到舊排序。
            var tokens = await db.ApiToken
                .OrderByDescending(t => t.CreatedDateTime)
                .Select(t => new ApiTokenDto(
                    t.Id,
                    t.Name,
                    t.TokenPrefix,
                    t.CreatedDateTime,
                    t.LastUsedDateTime,
                    t.ExpiresDateTime,
                    t.Scopes))
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<ApiTokenDto>>.Ok(tokens));
        });

        // 產生新權杖。回傳的 Token 為明碼、只會出現這一次。
        app.MapPost("/api/me/tokens", async (
            CreateApiTokenRequest request,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(
                    ApiResponse<CreatedApiTokenDto>.Fail("Authentication required", 401),
                    statusCode: 401);
            }

            var name = (request.Name ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return Results.Json(
                    ApiResponse<CreatedApiTokenDto>.Fail("權杖名稱為必填", 400),
                    statusCode: 400);
            }
            if (name.Length > 128)
            {
                return Results.Json(
                    ApiResponse<CreatedApiTokenDto>.Fail("權杖名稱過長（上限 128 字）", 400),
                    statusCode: 400);
            }
            if (request.ExpiresInDays is int days && days <= 0)
            {
                return Results.Json(
                    ApiResponse<CreatedApiTokenDto>.Fail("到期天數需為正整數，或留空表示永不過期", 400),
                    statusCode: 400);
            }

            try
            {
                // 產生明碼權杖 + 雜湊 + 顯示前綴。明碼不落地（只在回應回傳一次）。
                var (plainToken, hash, prefix) = ApiTokenGenerator.Generate();

                var userKey = currentUser.UserId.ToString();
                var entity = new ApiToken
                {
                    UserId = currentUser.UserId,
                    Name = name,
                    TokenHash = hash,
                    TokenPrefix = prefix,
                    ExpiresDateTime = request.ExpiresInDays is int d
                        ? DateTime.UtcNow.AddDays(d)
                        : null,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                };

                db.ApiToken.Add(entity);
                await db.SaveChangesAsync(ct);

                var info = new ApiTokenDto(
                    entity.Id,
                    entity.Name,
                    entity.TokenPrefix,
                    entity.CreatedDateTime,
                    entity.LastUsedDateTime,
                    entity.ExpiresDateTime,
                    entity.Scopes);

                return Results.Ok(ApiResponse<CreatedApiTokenDto>.Ok(
                    new CreatedApiTokenDto(plainToken, info)));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to create API token (userId={UserId})", currentUser.UserId);
                return Results.StatusCode(500);
            }
        });

        // 撤銷權杖（軟刪除）。冪等：找不到也回成功。
        app.MapDelete("/api/me/tokens/{id:guid}", async (
            Guid id,
            ICurrentUser currentUser,
            ZonWikiDbContext db,
            ILogger<object> logger,
            CancellationToken ct) =>
        {
            if (currentUser.UserId == Guid.Empty)
            {
                return Results.Json(
                    ApiResponse<object>.Fail("Authentication required", 401),
                    statusCode: 401);
            }

            try
            {
                // 全域過濾已限定本人 + 有效。
                var token = await db.ApiToken.FirstOrDefaultAsync(t => t.Id == id, ct);
                if (token is not null)
                {
                    token.ValidFlag = false;
                    token.DeletedDateTime = DateTime.UtcNow;
                    token.UpdatedUser = currentUser.UserId.ToString();
                    await db.SaveChangesAsync(ct);
                }

                return Results.Ok(ApiResponse<object>.Ok(new { id }));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to revoke API token (userId={UserId}, tokenId={TokenId})",
                    currentUser.UserId, id);
                return Results.StatusCode(500);
            }
        });
    }
}
