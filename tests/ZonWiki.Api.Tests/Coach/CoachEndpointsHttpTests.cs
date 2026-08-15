using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <c>/ws/coach</c> 四護欄的「真 HTTP」端點測試（護欄在 WS upgrade 之前判定，故可用純 HTTP GET 驗回應碼）：
/// PAT 拒（S7）、Origin fail-closed（S7）、每日分鐘上限拒開（S1/S9）、跨使用者 resumption 擋（IDOR，S3）、
/// 護欄全過的合法請求走到「需 WebSocket」（400）。REST 場次 CRUD 一併覆蓋。
///
/// 取得 Cookie principal：以 <c>/api/auth/register</c> 註冊（回應即 SignIn 設 Cookie，
/// WebApplicationFactory 預設 client 的 CookieContainer 會保留）。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class CoachEndpointsHttpTests
{
    private const string AllowedOrigin = "http://localhost:3000";

    private readonly ZonWikiApiFactory _factory;

    public CoachEndpointsHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>註冊一位新使用者並取得帶 Cookie 的 client 與其 userId。</summary>
    private async Task<(Guid UserId, HttpClient Client)> NewCookieUserAsync()
    {
        var client = _factory.CreateClient();
        // 每個測試 client 給不同的 X-Forwarded-For：登入／註冊限流以「用戶端 IP」分區，
        // 測試全來自同一 loopback 會共用同一分區而撞 10/分上限；用唯一 IP 分散到各自分區。
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}");
        var account = $"coach-{Guid.NewGuid():N}";
        var response = await client.PostAsJsonAsync(
            "/api/auth/register",
            new { account, password = "password1234", displayName = "教練測試" });
        response.StatusCode.Should().Be(HttpStatusCode.OK, "註冊應成功並設 Cookie");
        var json = (await response.Content.ReadFromJsonAsync<JsonNode>())!;
        var userId = Guid.Parse(json["data"]!["userId"]!.GetValue<string>());
        return (userId, client);
    }

    /// <summary>以 Cookie client 開一場教練場次，回其 Id。</summary>
    private static async Task<Guid> OpenSessionAsync(HttpClient client, string? topic = "small talk")
    {
        var response = await client.PostAsJsonAsync("/api/coach/sessions", new { topic });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = (await response.Content.ReadFromJsonAsync<JsonNode>())!;
        return Guid.Parse(json["data"]!["id"]!.GetValue<string>());
    }

    /// <summary>對 /ws/coach 發一個「非 WS」的 GET（可帶 Origin），驗護欄回應碼。</summary>
    private static async Task<HttpResponseMessage> GetWsAsync(HttpClient client, Guid? sessionId, string? origin)
    {
        var url = sessionId is Guid id ? $"/ws/coach?sessionId={id}" : "/ws/coach";
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
        }

        return await client.SendAsync(request);
    }

    // ── 認證護欄 ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WsCoach_未認證_回401()
    {
        var client = _factory.CreateClient();
        var response = await GetWsAsync(client, Guid.NewGuid(), AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task WsCoach_PAT驗證_明確拒為401()
    {
        // PAT（Bearer）驗證的連線一律拒（一顆外洩 PAT 不得開燒錢教練）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"coach-pat-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var response = await GetWsAsync(client, Guid.NewGuid(), AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── Origin 護欄（fail-closed）────────────────────────────────────────────────────

    [Fact]
    public async Task WsCoach_Origin缺失_回403()
    {
        var (userId, client) = await NewCookieUserAsync();
        var sessionId = await OpenSessionAsync(client);

        var response = await GetWsAsync(client, sessionId, origin: null);
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task WsCoach_Origin不在白名單_回403()
    {
        var (_, client) = await NewCookieUserAsync();
        var sessionId = await OpenSessionAsync(client);

        var response = await GetWsAsync(client, sessionId, "https://evil.example");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── 護欄全過的合法請求（非 WS→400）────────────────────────────────────────────────

    [Fact]
    public async Task WsCoach_護欄全過但非WebSocket_回400()
    {
        var (_, client) = await NewCookieUserAsync();
        var sessionId = await OpenSessionAsync(client);

        var response = await GetWsAsync(client, sessionId, AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "護欄全過但非 WS 握手 → 400（expected websocket）");
    }

    // ── 跨使用者 resumption 擋（IDOR）────────────────────────────────────────────────

    [Fact]
    public async Task WsCoach_他人的sessionId_回404_IDOR()
    {
        var (_, ownerClient) = await NewCookieUserAsync();
        var othersSessionId = await OpenSessionAsync(ownerClient);

        // 另一使用者帶「別人的 sessionId」→ 擁有權驗證擋下（404，不洩漏存在與否）。
        var (_, attackerClient) = await NewCookieUserAsync();
        var response = await GetWsAsync(attackerClient, othersSessionId, AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task WsCoach_未帶sessionId_回400()
    {
        var (_, client) = await NewCookieUserAsync();
        var response = await GetWsAsync(client, sessionId: null, AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── 每日分鐘上限（權威計量）────────────────────────────────────────────────────

    [Fact]
    public async Task WsCoach_每日分鐘上限已達_回429()
    {
        var (userId, client) = await NewCookieUserAsync();
        var sessionId = await OpenSessionAsync(client);

        // 直接種一場「今日已結束、時長 61 分鐘」的場次 → 超過預設每日 60 分鐘上限。
        await SeedEndedUsageAsync(userId, minutes: 61);

        var response = await GetWsAsync(client, sessionId, AllowedOrigin);
        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    // ── REST 場次 CRUD ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task OpenSession_回201並落庫Active()
    {
        var (_, client) = await NewCookieUserAsync();

        var response = await client.PostAsJsonAsync("/api/coach/sessions", new { title = "我的練習", topic = "旅遊" });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = (await response.Content.ReadFromJsonAsync<JsonNode>())!;
        json["data"]!["status"]!.GetValue<string>().Should().Be("active");
        json["data"]!["title"]!.GetValue<string>().Should().Be("我的練習");
    }

    [Fact]
    public async Task ListSessions_只回本人()
    {
        var (_, clientA) = await NewCookieUserAsync();
        var (_, clientB) = await NewCookieUserAsync();
        var idA = await OpenSessionAsync(clientA, "A 的主題");
        await OpenSessionAsync(clientB, "B 的主題");

        var json = (await (await clientA.GetAsync("/api/coach/sessions")).Content.ReadFromJsonAsync<JsonNode>())!;
        var ids = json["data"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        ids.Should().Contain(idA.ToString());
        ids.Should().HaveCount(1, "只回本人場次");
    }

    [Fact]
    public async Task GetSession_他人_回404()
    {
        var (_, ownerClient) = await NewCookieUserAsync();
        var sessionId = await OpenSessionAsync(ownerClient);

        var (_, attackerClient) = await NewCookieUserAsync();
        var response = await attackerClient.GetAsync($"/api/coach/sessions/{sessionId}");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 種子工具 ───────────────────────────────────────────────────────────────────

    /// <summary>種一場今日「已結束、指定時長」的場次（供日分鐘上限測試）。</summary>
    private async Task SeedEndedUsageAsync(Guid userId, int minutes)
    {
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            var now = DateTime.UtcNow;
            var started = now.AddMinutes(-(minutes + 1));
            db.CoachSession.Add(new CoachSession
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Title = "已用量",
                Status = CoachSession.StatusEnded,
                Model = "test-model",
                StartedDateTime = started,
                EndedDateTime = started.AddMinutes(minutes),
                AccumulatedSeconds = minutes * 60,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = true,
            });
            await db.SaveChangesAsync();
        }
    }
}
