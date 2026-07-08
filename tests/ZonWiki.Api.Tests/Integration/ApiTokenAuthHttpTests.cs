using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// PAT（個人存取權杖）驗證的「真 HTTP」整合測試（審查 #45 / #46）。
///
/// 覆蓋：權杖驗證成功／失敗、過期、撤銷、跨使用者拒絕，以及關鍵寫入端點的
/// 401（未驗證）/404（跨使用者或不存在）/400（輸入驗證）負面案例，
/// 全程走真實 <see cref="Api.Auth.ApiTokenAuthenticationHandler"/> 驗證路徑。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ApiTokenAuthHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>
    /// 注入共用的整合測試基座。
    /// </summary>
    /// <param name="factory">整合測試基座。</param>
    public ApiTokenAuthHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// 有效權杖：可通過驗證存取受保護端點（GET /api/tasks → 200）。
    /// </summary>
    [Fact]
    public async Task ValidToken_AccessesProtectedEndpoint_Returns200()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"valid-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.GetAsync("/api/tasks");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    /// <summary>
    /// 無憑證：存取受保護端點 → 401。
    /// </summary>
    [Fact]
    public async Task NoToken_AccessesProtectedEndpoint_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/tasks");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 亂數/偽造權杖：雜湊比對不到任何權杖列 → 驗證失敗 → 401。
    /// </summary>
    [Fact]
    public async Task InvalidToken_Returns401()
    {
        var client = _factory.CreateClientWithToken("zwk_this_is_not_a_real_token");

        var response = await client.GetAsync("/api/tasks");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 過期權杖：ExpiresDateTime 在過去 → 驗證失敗 → 401。
    /// </summary>
    [Fact]
    public async Task ExpiredToken_Returns401()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(
            $"expired-{Guid.NewGuid():N}@example.com",
            tokenExpiresAt: DateTime.UtcNow.AddMinutes(-5));
        var client = _factory.CreateClientWithToken(token);

        var response = await client.GetAsync("/api/tasks");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 已撤銷權杖（軟刪除 ValidFlag=false）：驗證只接受有效權杖 → 401。
    /// </summary>
    [Fact]
    public async Task RevokedToken_Returns401()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync(
            $"revoked-{Guid.NewGuid():N}@example.com",
            tokenValid: false);
        var client = _factory.CreateClientWithToken(token);

        var response = await client.GetAsync("/api/tasks");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 跨使用者：以 A 的權杖讀取 B 的卡片 → 404（資源對 A 不可見，隔離生效）。
    /// </summary>
    [Fact]
    public async Task CrossUser_ReadingAnothersTask_Returns404()
    {
        var (_, tokenA) = await _factory.SeedUserWithTokenAsync($"a-{Guid.NewGuid():N}@example.com");
        var (_, tokenB) = await _factory.SeedUserWithTokenAsync($"b-{Guid.NewGuid():N}@example.com");
        var clientA = _factory.CreateClientWithToken(tokenA);
        var clientB = _factory.CreateClientWithToken(tokenB);

        // B 建立一張卡片，A 嘗試讀取。
        var taskId = await clientB.CreateTaskAsync("B 的卡片");
        var response = await clientA.GetAsync($"/api/tasks/{taskId}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// 端到端（產生→使用）：以 PAT 呼叫 POST /api/me/tokens 產生一把新權杖，
    /// 再用「新權杖」通過驗證存取受保護端點。驗證產生／雜湊／驗證整條鏈路。
    /// </summary>
    [Fact]
    public async Task GeneratedToken_CanAuthenticateSubsequentRequests()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"gen-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        // Act：產生一把新權杖。
        var createResponse = await client.PostAsJsonAsync("/api/me/tokens",
            new { name = "第二把權杖", expiresInDays = (int?)null });
        createResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var newToken = (await createResponse.ReadJsonAsync())["data"]!["token"]!.GetValue<string>();
        newToken.Should().StartWith("zwk_");

        // Assert：新權杖可用於後續請求。
        var newClient = _factory.CreateClientWithToken(newToken);
        var protectedResponse = await newClient.GetAsync("/api/tasks");
        protectedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    /// <summary>
    /// 負面（400）：產生權杖時名稱為空白 → 400。
    /// </summary>
    [Fact]
    public async Task CreateToken_BlankName_Returns400()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"blank-name-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync("/api/me/tokens",
            new { name = "   ", expiresInDays = (int?)null });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// 負面（400）：產生權杖時到期天數為非正整數 → 400。
    /// </summary>
    [Fact]
    public async Task CreateToken_NonPositiveExpiry_Returns400()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"bad-expiry-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await client.PostAsJsonAsync("/api/me/tokens",
            new { name = "合法名稱", expiresInDays = 0 });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
