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
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 單字庫「AI 補釋義」端點（/api/ai/vocabulary，PAT）整合測試：
/// 成功補釋義、壞 JSON 降級（word 仍入庫）、供應者拋例外降級、逾時降級、既有釋義不被覆蓋、
/// 同字復活、word 超長 400、無 Token 401。
///
/// 成功路徑需 AI 回「合法五欄 JSON」——以 <c>WithWebHostBuilder</c> 於 Testing 覆寫 IAiProvider 為
/// 「依請求標頭回定值的腳本化供應者」（照 ExpenseParseHttpTests 手法，只換 JSON 為五欄釋義）。
/// 只建立兩個共用主機（一般預算＋短預算）以壓低內部服務供應者數量。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyAiHttpTests
{
    private readonly ZonWikiApiFactory _factory;

    private static readonly ConcurrentDictionary<string, WebApplicationFactory<Program>> HostCache = new();

    private const string JsonHeader = "X-Test-Ai-Json";
    private const string DelayHeader = "X-Test-Ai-Delay-Ms";
    private const string ThrowHeader = "X-Test-Ai-Throw";

    public VocabularyAiHttpTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private const string GoodJson =
        "{\"phonetic\":\"/rɪˈzɪliənt/\",\"partOfSpeech\":\"adjective\"," +
        "\"definitionEn\":\"able to recover quickly\",\"definitionZh\":\"有韌性的\"," +
        "\"exampleSentence\":\"She is resilient.\"}";

    private WebApplicationFactory<Program> ScriptedHost(bool shortBudget) => HostCache.GetOrAdd(
        shortBudget ? "vocab-timeout" : "vocab-json",
        _ => _factory.WithWebHostBuilder(builder =>
        {
            if (shortBudget)
            {
                builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["Vocabulary:EnrichBudgetSeconds"] = "1" }));
            }

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IAiProvider>();
                services.AddSingleton<IAiProvider>(sp =>
                    new HeaderScriptedAiProvider(sp.GetRequiredService<IHttpContextAccessor>()));
            });
        }));

    private HttpClient ScriptedClient(string token, string? json, int delayMs = 0, bool shortBudget = false, bool throwProvider = false)
    {
        var client = ScriptedHost(shortBudget).CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (json is not null)
        {
            client.DefaultRequestHeaders.Add(JsonHeader, Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
        }

        if (delayMs > 0)
        {
            client.DefaultRequestHeaders.Add(DelayHeader, delayMs.ToString(CultureInfo.InvariantCulture));
        }

        if (throwProvider)
        {
            client.DefaultRequestHeaders.Add(ThrowHeader, "1");
        }

        return client;
    }

    /// <summary>
    /// 種使用者＋PAT＋一筆本人的 ClaudeCli「vertex-gemini-lite」列：讓補釋義的 ResolveAsync 命中本人列
    /// （own 勝 shared）並經 ClaudeCli 分支回退到覆寫的腳本化供應者，使測試不受其它測試在共用 DB
    /// 種的 shared 模型列干擾（測試隔離）。
    /// </summary>
    private async Task<(Guid UserId, string Token)> SeedAiUserAsync(string email)
    {
        var (userId, token) = await _factory.SeedUserWithTokenAsync(email);
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            db.AiModel.Add(new AiModel
            {
                UserId = userId,
                Key = VocabularyEnrichmentService.DefaultVertexModelKey,
                Label = "test-claude",
                Provider = "ClaudeCli",
                Kind = "chat",
                Enabled = true,
                ModelId = "sonnet",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }

        return (userId, token);
    }

    private async Task<(string? DefinitionZh, int Count)> ReadWordAsync(Guid userId, string word)
    {
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var rows = await db.VocabularyWord.IgnoreQueryFilters()
                .Where(v => v.UserId == userId && v.Word == word).ToListAsync();
            return (rows.FirstOrDefault()?.DefinitionZh, rows.Count);
        }
    }

    // A1
    [Fact]
    public async Task PostAiVocabulary_成功_upsert並補釋義()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-ok-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "resilient", context = "she stayed resilient" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.ReadJsonAsync();
        json["data"]!["enriched"]!.GetValue<bool>().Should().BeTrue();
        json["data"]!["card"]!["definitionZh"]!.GetValue<string>().Should().Be("有韌性的");
        json["data"]!["card"]!["partOfSpeech"]!.GetValue<string>().Should().Be("adjective");

        var (definitionZh, count) = await ReadWordAsync(userId, "resilient");
        count.Should().Be(1);
        definitionZh.Should().Be("有韌性的");
    }

    // A2
    [Fact]
    public async Task PostAiVocabulary_壞JSON_word仍入庫且Enriched為false()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-bad-{Guid.NewGuid():N}@example.com");
        // 不帶 JSON 標頭 → 供應者回散文（非 JSON）→ 降級。
        var client = ScriptedClient(token, json: null);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "gibberish" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "壞 JSON 應降級、不得回 500");
        var json = await response.ReadJsonAsync();
        json["data"]!["enriched"]!.GetValue<bool>().Should().BeFalse();

        var (definitionZh, count) = await ReadWordAsync(userId, "gibberish");
        count.Should().Be(1, "word 仍須入庫");
        definitionZh.Should().BeNull();
    }

    // A3
    [Fact]
    public async Task PostAiVocabulary_供應者拋例外_降級不500()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-throw-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson, throwProvider: true);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "throwword" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "供應者拋例外（ADC 不可用）應降級、不得回 500");
        var json = await response.ReadJsonAsync();
        json["data"]!["enriched"]!.GetValue<bool>().Should().BeFalse();

        (await ReadWordAsync(userId, "throwword")).Count.Should().Be(1);
    }

    // A4
    [Fact]
    public async Task PostAiVocabulary_逾時_降級不500且word落庫()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-timeout-{Guid.NewGuid():N}@example.com");
        // 延遲 6 秒 ＋ 1 秒硬預算（短預算主機）→ 補釋義中途逾時。
        var client = ScriptedClient(token, GoodJson, delayMs: 6000, shortBudget: true);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "slowword" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "逾時應降級");
        var json = await response.ReadJsonAsync();
        json["data"]!["enriched"]!.GetValue<bool>().Should().BeFalse();

        (await ReadWordAsync(userId, "slowword")).Count.Should().Be(1, "逾時保底：word 必須落庫");
    }

    // A5
    [Fact]
    public async Task PostAiVocabulary_既有非空釋義不被覆蓋()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-keep-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        // 先手動建含 DefinitionZh 的卡。
        (await client.PostAsJsonAsync("/api/vocabulary", new { word = "preserve", definitionZh = "使用者原本的釋義" }))
            .StatusCode.Should().Be(HttpStatusCode.Created);

        // AI 回不同 DefinitionZh。
        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "preserve" });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var (definitionZh, count) = await ReadWordAsync(userId, "preserve");
        count.Should().Be(1);
        definitionZh.Should().Be("使用者原本的釋義", "既有非空釋義不應被 AI 覆蓋");

        // 但原本為空的 partOfSpeech 應被補上。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var card = await db.VocabularyWord.IgnoreQueryFilters().FirstAsync(v => v.UserId == userId && v.Word == "preserve");
            card.PartOfSpeech.Should().Be("adjective", "原本為空的欄位應被補上");
        }
    }

    // A6
    [Fact]
    public async Task PostAiVocabulary_同字重送_復活不重複()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-revive-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        var first = await (await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "reborn" })).ReadJsonAsync();
        var firstId = Guid.Parse(first["data"]!["card"]!["id"]!.GetValue<string>());

        // 軟刪除。
        (await client.DeleteAsync($"/api/vocabulary/{firstId}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        // AI 再送同字 → 復活同一列。
        var second = await (await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "reborn" })).ReadJsonAsync();
        Guid.Parse(second["data"]!["card"]!["id"]!.GetValue<string>()).Should().Be(firstId);

        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var rows = await db.VocabularyWord.IgnoreQueryFilters()
                .Where(v => v.UserId == userId && v.Word == "reborn").ToListAsync();
            rows.Should().ContainSingle();
            rows[0].ValidFlag.Should().BeTrue("復活而非新建");
        }
    }

    // A7
    [Fact]
    public async Task PostAiVocabulary_word超長_回400()
    {
        var (_, token) = await _factory.SeedUserWithTokenAsync($"vocab-ai-long-{Guid.NewGuid():N}@example.com");
        var client = ScriptedClient(token, GoodJson);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = new string('a', 201) });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // A9（審查 #2：LLM 輸出超長 → varchar(128)/varchar(64) 觸發 22001 → 未攔截 500）
    // AI 回超長 phonetic/partOfSpeech，須降級（200＋Enriched=false）、絕不 500，超長欄位不入庫。
    [Fact]
    public async Task PostAiVocabulary_超長phonetic與partOfSpeech_降級不500且超長欄位不入庫()
    {
        var (userId, token) = await SeedAiUserAsync($"vocab-ai-toolong-{Guid.NewGuid():N}@example.com");

        // 只回超長 phonetic（>128）＋超長 partOfSpeech（>64），無其它可填欄位（模擬被 prompt injection 吐超長值）。
        var longJson =
            "{\"phonetic\":\"" + new string('x', 200) + "\"," +
            "\"partOfSpeech\":\"" + new string('y', 100) + "\"}";
        var client = ScriptedClient(token, longJson);

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "overflowai" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "超長 LLM 輸出必須降級，絕不回 500");
        var json = await response.ReadJsonAsync();
        json["data"]!["enriched"]!.GetValue<bool>().Should().BeFalse("超長欄位被跳過、無其它可填 → 未補釋義");

        // word 仍入庫；超長欄位（超過 DB 上限）不落庫。
        var (scope, db) = _factory.CreateDbScope();
        using (scope)
        {
            var card = await db.VocabularyWord.IgnoreQueryFilters()
                .FirstAsync(v => v.UserId == userId && v.Word == "overflowai");
            card.Phonetic.Should().BeNull("超長音標應被跳過，不入庫");
            card.PartOfSpeech.Should().BeNull("超長詞性應被跳過，不入庫");
        }
    }

    // A8
    [Fact]
    public async Task PostAiVocabulary_無Token_回401()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ai/vocabulary", new { word = "anon" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// 依請求標頭回定值的測試供應者：讀 X-Test-Ai-Json（base64 JSON）與 X-Test-Ai-Delay-Ms（延遲），
    /// X-Test-Ai-Throw=1 時直接拋（模擬 ADC 不可用）；無 JSON 標頭時回非 JSON（觸發降級）。
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
                    throw new InvalidOperationException("模擬供應者無法使用（例如 ADC 不可用）。");
                }

                if (http.Request.Headers.TryGetValue(JsonHeader, out var encoded) && !string.IsNullOrEmpty(encoded))
                {
                    response = Encoding.UTF8.GetString(Convert.FromBase64String(encoded!));
                }

                if (http.Request.Headers.TryGetValue(DelayHeader, out var delayText) && int.TryParse(delayText, out var parsedDelay))
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
