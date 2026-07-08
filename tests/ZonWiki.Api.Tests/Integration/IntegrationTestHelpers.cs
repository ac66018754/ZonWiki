using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 整合測試共用工具：以「真實資料庫種子 + 真實 PAT Bearer 驗證」驅動端點測試。
///
/// 設計取捨：這些測試不繞過驗證管線，而是實際產生一把 PAT（個人存取權杖）寫進資料庫，
/// 再以 <c>Authorization: Bearer &lt;token&gt;</c> 呼叫端點——因此連 <see cref="Api.Auth.ApiTokenAuthenticationHandler"/>
/// 的真實驗證路徑（雜湊比對、到期/撤銷檢查、使用者隔離）也一併被覆蓋，最貼近正式環境行為。
/// </summary>
public static class IntegrationTestHelpers
{
    /// <summary>
    /// 以「不帶 HttpContext」的服務範圍取一個 <see cref="ZonWikiDbContext"/>。
    /// 此時 <c>CurrentUserId</c> 為 <see cref="Guid.Empty"/>，使用者隔離最終防線會放行，
    /// 適合做測試資料的種子與驗證讀取（讀取時搭配 <c>IgnoreQueryFilters()</c>）。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    /// <returns>服務範圍與其中的資料庫內容（呼叫端負責 dispose scope）。</returns>
    public static (IServiceScope Scope, ZonWikiDbContext Db) CreateDbScope(this ZonWikiApiFactory factory)
    {
        var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
        return (scope, db);
    }

    /// <summary>
    /// 種子：建立一位使用者，並為其產生一把 PAT。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    /// <param name="email">使用者 Email（測試辨識用；需唯一）。</param>
    /// <param name="tokenExpiresAt">權杖到期時間（UTC，null＝永不過期）。用於過期測試傳入過去時間。</param>
    /// <param name="tokenValid">權杖是否有效（false＝模擬已撤銷／軟刪除）。</param>
    /// <returns>建立的使用者 Id 與該把權杖的「明碼字串」（供設定 Bearer 標頭）。</returns>
    public static async Task<(Guid UserId, string Token)> SeedUserWithTokenAsync(
        this ZonWikiApiFactory factory,
        string email,
        DateTime? tokenExpiresAt = null,
        bool tokenValid = true)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            db.User.Add(new User
            {
                Id = userId,
                Email = email,
                DisplayName = email,
                GoogleSub = "sub-" + Guid.NewGuid().ToString("N"),
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "test",
                UpdatedUser = "test",
                ValidFlag = true,
            });

            // 產生真實明碼權杖 + SHA-256 雜湊；資料庫只存雜湊（與正式流程一致）。
            var (token, hash, prefix) = ApiTokenGenerator.Generate();
            db.ApiToken.Add(new ApiToken
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = "integration-test-token",
                TokenHash = hash,
                TokenPrefix = prefix,
                ExpiresDateTime = tokenExpiresAt,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = "test",
                UpdatedUser = "test",
                // 撤銷＝軟刪除（ValidFlag=false）；驗證處理常式只接受 ValidFlag=true 者。
                ValidFlag = tokenValid,
                DeletedDateTime = tokenValid ? null : now,
            });

            await db.SaveChangesAsync();
            return (userId, token);
        }
    }

    /// <summary>
    /// 建立一個「已帶 Bearer 權杖」的 <see cref="HttpClient"/>。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    /// <param name="token">明碼權杖字串。</param>
    /// <returns>設定好 Authorization 標頭的用戶端。</returns>
    public static HttpClient CreateClientWithToken(this ZonWikiApiFactory factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// 直接自資料庫讀取一張任務卡片（略過全域過濾），供驗證 DTO 未暴露的欄位（例如 CompletedDateTime）。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    /// <param name="taskId">任務卡片 Id。</param>
    /// <returns>任務卡片實體（找不到為 null）。</returns>
    public static async Task<TaskCard?> GetTaskCardFromDbAsync(this ZonWikiApiFactory factory, Guid taskId)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            return await db.TaskCard
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == taskId);
        }
    }

    /// <summary>
    /// 以 PAT 用戶端建立一張任務卡片，回傳新卡片 Id（透過真實 POST /api/tasks）。
    /// </summary>
    /// <param name="client">已帶 Bearer 權杖的用戶端。</param>
    /// <param name="title">卡片標題。</param>
    /// <param name="status">初始狀態（預設 "todo"）。</param>
    /// <returns>新卡片 Id。</returns>
    public static async Task<Guid> CreateTaskAsync(this HttpClient client, string title, string status = "todo")
    {
        var response = await client.PostAsJsonAsync("/api/tasks", new { title, status });
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonNode>();
        return Guid.Parse(json!["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>
    /// 讀取回應主體為 <see cref="JsonNode"/>（camelCase；API 統一以 <c>{ success, data, error, statusCode }</c> 封裝）。
    /// </summary>
    /// <param name="response">HTTP 回應。</param>
    /// <returns>解析後的 JSON 節點。</returns>
    public static async Task<JsonNode> ReadJsonAsync(this HttpResponseMessage response)
    {
        var node = await response.Content.ReadFromJsonAsync<JsonNode>(
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return node!;
    }
}
