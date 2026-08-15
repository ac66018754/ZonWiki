using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 記帳「解析入庫＋保底」端點的整合測試（Ai=Fake）：
/// 成功入庫、降級建 CaptureItem、逾時降級（且 CaptureItem 確實落庫）、
/// PAT 冪等（含並發只建一筆）、名稱式分類自動建立／復活、本月彙總。
///
/// 成功路徑需 AI 回「合法 JSON」——以 <c>WithWebHostBuilder</c> 於 Testing 覆寫 IAiProvider 為
/// 「依請求標頭回定值的腳本化供應者」。為控管 EF 內部服務供應者總數（避免 ManyServiceProvidersCreatedWarning），
/// 只建立**兩個**共用主機（一般預算＋短預算），JSON／延遲皆以每請求標頭控制；不改動整合基座對其它測試的預設 Fake。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseParseHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    /// <summary>共用主機快取（"json"＝一般預算；"timeout"＝1 秒短預算），只建立兩個以壓低內部服務供應者數量。</summary>
    private static readonly ConcurrentDictionary<string, WebApplicationFactory<Program>> HostCache = new();

    /// <summary>回定值 JSON 的請求標頭（base64 編碼，避免特殊字元／換行破壞標頭）。</summary>
    private const string JsonHeader = "X-Test-Ai-Json";

    /// <summary>回應前延遲毫秒數的請求標頭（供逾時／並發測試）。</summary>
    private const string DelayHeader = "X-Test-Ai-Delay-Ms";

    /// <summary>設為 "1" 時供應者直接拋 InvalidOperationException（模擬 ADC 不可用／解析供應者建構失敗）。</summary>
    private const string ThrowHeader = "X-Test-Ai-Throw";

    public ExpenseParseHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private const string GoodJson =
        "{\"reasoning\":\"超商消費\",\"amount\":300,\"currency\":\"TWD\",\"merchant\":\"統一超商\"," +
        "\"items\":[\"書\"],\"category\":\"購物\",\"occurredAt\":\"2026-07-06T04:30:00Z\"," +
        "\"confidence\":0.92,\"needsConfirmation\":false}";

    private WebApplicationFactory<Program> ScriptedHost(bool shortBudget) => HostCache.GetOrAdd(
        shortBudget ? "timeout" : "json",
        _ => _factory.WithWebHostBuilder(builder =>
        {
            if (shortBudget)
            {
                builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["Expense:ParseBudgetSeconds"] = "1" }));
            }

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IAiProvider>();
                services.AddSingleton<IAiProvider>(sp =>
                    new HeaderScriptedAiProvider(sp.GetRequiredService<IHttpContextAccessor>()));
            });
        }));

    /// <summary>建立帶 PAT 的用戶端：以標頭控制 AI 回定值 JSON 與延遲。</summary>
    private HttpClient ScriptedClient(string token, string json, int delayMs = 0, bool shortBudget = false)
    {
        var client = ScriptedHost(shortBudget).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add(JsonHeader, Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
        if (delayMs > 0)
        {
            client.DefaultRequestHeaders.Add(DelayHeader, delayMs.ToString(CultureInfo.InvariantCulture));
        }

        return client;
    }

    private async Task<int> CountCapturesAsync(Guid userId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.CaptureItem.IgnoreQueryFilters()
                .CountAsync(c => c.UserId == userId && c.ValidFlag);
        }
    }

    private async Task<int> CountExpensesAsync(Guid userId, string clientRequestId)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            return await db.Expense.IgnoreQueryFilters()
                .CountAsync(e => e.UserId == userId && e.ClientRequestId == clientRequestId);
        }
    }

    [Fact]
    public async Task PostParse_Fake成功_建Expense並回Stored()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"parse-ok-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "在7-11花300買書" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["stored"]!.GetValue<bool>().Should().BeTrue();
        json["data"]!["deferred"]!.GetValue<bool>().Should().BeFalse();
        json["data"]!["expense"]!["amount"]!.GetValue<decimal>().Should().Be(300m);
        json["data"]!["expense"]!["categoryName"]!.GetValue<string>().Should().Be("購物");
        json["data"]!["expense"]!["source"]!.GetValue<string>().Should().Be("web");
    }

    [Fact]
    public async Task PostParse_解析降級_建CaptureItem並回Deferred()
    {
        // 用整合基座預設 Fake（回中文散文、非 JSON）→ 解析降級。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"parse-degrade-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var before = await CountCapturesAsync(userId);
        var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "亂七八糟一句話" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["deferred"]!.GetValue<bool>().Should().BeTrue();
        json["data"]!["captureItemId"]!.GetValue<string>().Should().NotBeNullOrEmpty();

        (await CountCapturesAsync(userId)).Should().Be(before + 1, "降級應建一筆 CaptureItem");
    }

    [Fact]
    public async Task PostParse_逾時_降級為CaptureItem且確實落庫()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"parse-timeout-{Guid.NewGuid():N}@example.com");
        // 延遲 6 秒 ＋ 1 秒硬預算（短預算主機）→ 解析中途逾時。
        var client = ScriptedClient(token, GoodJson, delayMs: 6000, shortBudget: true);

        // 先預熱分類（種子）讓被計時的解析只卡在 AI 延遲，而非分類寫入。
        (await client.GetAsync("/api/expenses/categories")).EnsureSuccessStatusCode();

        var before = await CountCapturesAsync(userId);
        var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "逾時測試一句話" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["deferred"]!.GetValue<bool>().Should().BeTrue("逾時應降級");
        json["data"]!["captureItemId"]!.GetValue<string>().Should().NotBeNullOrEmpty();

        // 關鍵斷言（審查 HIGH）：逾時後 CaptureItem 必須確實落庫（用未取消的權杖寫入）。
        (await CountCapturesAsync(userId)).Should().Be(before + 1, "逾時保底必須真的持久化 CaptureItem");
    }

    [Fact]
    public async Task PostParse_供應者拋例外_降級為CaptureItem()
    {
        // 模擬 ADC 不可用／解析供應者建構失敗（拋 InvalidOperationException，非 Error 事件）。
        // 設計 §5.3／§1.6：這類「AI 失敗」也必須走保底路（建 CaptureItem），不得回 500。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"parse-throw-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);
        client.DefaultRequestHeaders.Add(ThrowHeader, "1");

        var before = await CountCapturesAsync(userId);
        var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "供應者掛掉一句話" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "供應者拋例外應降級、不得回 500");
        var json = await response.ReadJsonAsync();
        json["data"]!["deferred"]!.GetValue<bool>().Should().BeTrue();
        json["data"]!["captureItemId"]!.GetValue<string>().Should().NotBeNullOrEmpty();
        (await CountCapturesAsync(userId)).Should().Be(before + 1, "供應者失敗保底必須落庫 CaptureItem");
    }

    [Fact]
    public async Task PostAiExpenses_PAT_成功入庫()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"ai-ok-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        var response = await client.PostAsJsonAsync("/api/ai/expenses", new { text = "在7-11花300買書" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["stored"]!.GetValue<bool>().Should().BeTrue();
        json["data"]!["expense"]!["source"]!.GetValue<string>().Should().Be("api");
    }

    [Fact]
    public async Task PostAiExpenses_相同clientRequestId兩次_只建一筆且回同id()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"ai-idem-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);
        var clientRequestId = $"req-{Guid.NewGuid():N}";

        var first = await (await client.PostAsJsonAsync("/api/ai/expenses",
            new { text = "在7-11花300買書", clientRequestId })).ReadJsonAsync();
        var second = await (await client.PostAsJsonAsync("/api/ai/expenses",
            new { text = "在7-11花300買書", clientRequestId })).ReadJsonAsync();

        var firstId = first["data"]!["expense"]!["id"]!.GetValue<string>();
        var secondId = second["data"]!["expense"]!["id"]!.GetValue<string>();
        secondId.Should().Be(firstId, "相同 clientRequestId 重送應回既有結果");

        (await CountExpensesAsync(userId, clientRequestId)).Should().Be(1, "冪等：只應建一筆");
    }

    [Fact]
    public async Task PostAiExpenses_相同clientRequestId並發_只建一筆()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"ai-race-{Guid.NewGuid():N}@example.com");
        var clientRequestId = $"req-{Guid.NewGuid():N}";
        // 兩個用戶端（同一主機）並發送出相同 clientRequestId，各延遲一點以拉高兩者都通過前置查詢的機率。
        var clientA = ScriptedClient(token, GoodJson, delayMs: 150);
        var clientB = ScriptedClient(token, GoodJson, delayMs: 150);

        var body = new { text = "在7-11花300買書", clientRequestId };
        var taskA = clientA.PostAsJsonAsync("/api/ai/expenses", body);
        var taskB = clientB.PostAsJsonAsync("/api/ai/expenses", body);
        var responses = await Task.WhenAll(taskA, taskB);

        foreach (var response in responses)
        {
            response.StatusCode.Should().Be(HttpStatusCode.OK, "並發冪等不得回 500");
        }

        (await CountExpensesAsync(userId, clientRequestId)).Should().Be(1, "並發冪等：仍只建一筆");
    }

    [Fact]
    public async Task PostAiExpenses_名稱式分類不存在_自動建立()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"ai-cat-{Guid.NewGuid():N}@example.com");
        var petJson = GoodJson.Replace("\"category\":\"購物\"", "\"category\":\"寵物\"");
        var client = ScriptedClient(token, petJson);

        var json = await (await client.PostAsJsonAsync("/api/ai/expenses",
            new { text = "買飼料 300" })).ReadJsonAsync();

        json["data"]!["expense"]!["categoryName"]!.GetValue<string>().Should().Be("寵物");

        var cats = await (await client.GetAsync("/api/expenses/categories")).ReadJsonAsync();
        cats["data"]!.AsArray().Select(n => n!["name"]!.GetValue<string>()).Should().Contain("寵物");
    }

    [Fact]
    public async Task PostAiExpenses_名稱式分類撞軟刪列_復活不報錯()
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"ai-revive-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson); // category=購物

        (await client.GetAsync("/api/expenses/categories")).EnsureSuccessStatusCode();
        Guid shoppingId;
        {
            var (scope, db) = _factory.CreateDbScope();
            using (scope)
            {
                var shopping = await db.ExpenseCategory.IgnoreQueryFilters()
                    .FirstAsync(c => c.UserId == userId && c.Name == "購物");
                shoppingId = shopping.Id;
                shopping.ValidFlag = false;
                shopping.DeletedDateTime = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
        }

        var response = await client.PostAsJsonAsync("/api/ai/expenses", new { text = "買東西 300" });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var (scope2, db2) = _factory.CreateDbScope();
        using (scope2)
        {
            var rows = await db2.ExpenseCategory.IgnoreQueryFilters()
                .Where(c => c.UserId == userId && c.Name == "購物")
                .ToListAsync();
            rows.Should().ContainSingle();
            rows[0].Id.Should().Be(shoppingId);
            rows[0].ValidFlag.Should().BeTrue("應復活而非新建");
        }
    }

    [Fact]
    public async Task GetStats_本月_回總額與筆數()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"stats-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        var now = DateTime.UtcNow;
        var thisMonth = now.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var inMonth = new DateTime(now.Year, now.Month, 1, 12, 0, 0, DateTimeKind.Utc).AddDays(1);

        await client.PostAsJsonAsync("/api/expenses",
            new { amount = 100m, merchant = "本月1", occurredDateTime = inMonth.ToString("O") });
        await client.PostAsJsonAsync("/api/expenses",
            new { amount = 250m, merchant = "本月2", occurredDateTime = inMonth.ToString("O") });
        await client.PostAsJsonAsync("/api/expenses",
            new { amount = 999m, merchant = "他月", occurredDateTime = "2020-01-15T00:00:00Z" });

        var json = await (await client.GetAsync($"/api/expenses/stats?month={thisMonth}")).ReadJsonAsync();

        json["data"]!["month"]!.GetValue<string>().Should().Be(thisMonth);
        json["data"]!["count"]!.GetValue<int>().Should().Be(2);
        json["data"]!["total"]!.GetValue<decimal>().Should().Be(350m);
    }

    [Fact]
    public async Task GetStats_指定month_回該月彙總()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"stats2-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);

        await client.PostAsJsonAsync("/api/expenses",
            new { amount = 40m, merchant = "三月", occurredDateTime = "2026-03-10T00:00:00Z" });
        await client.PostAsJsonAsync("/api/expenses",
            new { amount = 60m, merchant = "三月b", occurredDateTime = "2026-03-20T00:00:00Z" });

        var json = await (await client.GetAsync("/api/expenses/stats?month=2026-03")).ReadJsonAsync();

        json["data"]!["count"]!.GetValue<int>().Should().Be(2);
        json["data"]!["total"]!.GetValue<decimal>().Should().Be(100m);
    }

    [Fact]
    public async Task PostParse_文字超過1000字_回400()
    {
        // 修正 #3：解析文字上限 1000 字元（超過在打 AI 前就 400，避免灌爆 LLM／DB）。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"parse-long-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var tooLong = new string('字', 1001);

        var response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = tooLong });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "超過 1000 字元應回 400");
    }

    [Fact]
    public async Task PostAiExpenses_文字超過1000字_回400()
    {
        // 修正 #3：PAT 路（/api/ai/expenses）同樣受 1000 字元上限。
        var (_, token) = await _factory.SeedUserWithTokenAsync($"ai-long-{Guid.NewGuid():N}@example.com");
        var client = _factory.CreateClientWithToken(token);
        var tooLong = new string('字', 1001);

        var response = await client.PostAsJsonAsync("/api/ai/expenses", new { text = tooLong });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "超過 1000 字元應回 400");
    }

    [Fact]
    public async Task PostParse_儲存層失敗_不偽裝成降級且不留CaptureItem()
    {
        // 修正 #6：AI 解析成功、但入庫時發生「非 23505」的儲存例外（此處以超出 numeric(18,2) 的金額觸發 22003 溢位），
        // 應「往外拋」而非降級成 CaptureItem。TestServer 在無例外中介軟體時可能重拋例外或回 500——兩者皆非「200 降級」。
        // 核心不變量：絕不留下降級的 CaptureItem（避免把儲存故障遮蔽成 AI 忙碌）。
        var (userId, token) = await _factory.SeedUserWithTokenAsync($"parse-storefail-{Guid.NewGuid():N}@example.com");
        var overflowJson = GoodJson.Replace("\"amount\":300", "\"amount\":100000000000000000000");
        var client = ScriptedClient(token, overflowJson);

        var before = await CountCapturesAsync(userId);

        HttpResponseMessage? response = null;
        try
        {
            response = await client.PostAsJsonAsync("/api/expenses/parse", new { text = "溢位金額一句話" });
        }
        catch
        {
            // 未處理的儲存例外經 TestServer 重拋，屬預期（正是「不降級、往外拋」的行為）。
        }

        if (response is not null)
        {
            response.StatusCode.Should().NotBe(HttpStatusCode.OK, "儲存層失敗不應偽裝成 200 降級");
        }

        (await CountCapturesAsync(userId)).Should().Be(before, "儲存層失敗不應留下降級 CaptureItem");
    }

    /// <summary>
    /// 依請求標頭回定值的測試供應者：讀 X-Test-Ai-Json（base64 JSON）與 X-Test-Ai-Delay-Ms（延遲），
    /// 無 JSON 標頭時回非 JSON（觸發降級）。非-Fake 供應者→工廠不短路、經 entry-null 退回本供應者。
    /// </summary>
    private sealed class HeaderScriptedAiProvider(IHttpContextAccessor httpContextAccessor) : IAiProvider
    {
        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var response = "這不是 JSON（預設降級）";
            var delayMs = 0;

            var http = httpContextAccessor.HttpContext;
            if (http is not null)
            {
                if (http.Request.Headers.TryGetValue(ThrowHeader, out var throwText) && throwText == "1")
                {
                    // 模擬 ADC 不可用／解析供應者建構失敗：直接拋（非 Error 事件）。
                    throw new InvalidOperationException("模擬供應者無法使用（例如 ADC 不可用）。");
                }

                if (http.Request.Headers.TryGetValue(JsonHeader, out var encoded)
                    && !string.IsNullOrEmpty(encoded))
                {
                    response = Encoding.UTF8.GetString(Convert.FromBase64String(encoded!));
                }

                if (http.Request.Headers.TryGetValue(DelayHeader, out var delayText)
                    && int.TryParse(delayText, out var parsedDelay))
                {
                    delayMs = parsedDelay;
                }
            }

            if (delayMs > 0)
            {
                await Task.Delay(delayMs, cancellationToken);
            }

            yield return new AiStreamEvent(AiStreamEventType.Delta, response);
            yield return new AiStreamEvent(AiStreamEventType.Completed, response);
        }
    }
}
