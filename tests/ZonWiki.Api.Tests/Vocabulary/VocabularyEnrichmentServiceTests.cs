using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Vocabulary;

/// <summary>
/// <see cref="VocabularyEnrichmentService"/> 的服務測試（真 PostgreSQL，重用整合基座容器）：
/// 合法 JSON 解析五欄、圍欄剝除、壞 JSON 降級、Error 事件拋例外、prompt 內容。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class VocabularyEnrichmentServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public VocabularyEnrichmentServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    /// <summary>
    /// 以指定的預設供應者建立補釋義服務（Fake→短路回定值；非-Fake→由 <paramref name="vertexModelKey"/> 對應的
    /// 本人 ClaudeCli 列讓 ResolveAsync 回退到該預設供應者）。
    /// </summary>
    private static VocabularyEnrichmentService BuildService(
        ZonWikiDbContext db,
        IAiProvider provider,
        string? vertexModelKey = null)
    {
        var resolver = new AiModelResolver(
            db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        var factory = new AiProviderFactory(provider, db, resolver, new StubHttpClientFactory());
        var settings = new Dictionary<string, string?>();
        if (vertexModelKey is not null)
        {
            settings[VocabularyEnrichmentService.VertexModelKeyConfigKey] = vertexModelKey;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new VocabularyEnrichmentService(
            factory, configuration, NullLogger<VocabularyEnrichmentService>.Instance);
    }

    /// <summary>
    /// 為使用者種一筆本人的 ClaudeCli AiModel 列（指定 Key）。用途：讓 ResolveAsync 命中「本人列」（own 勝 shared）
    /// 並經 ClaudeCli 分支回退到注入的預設供應者，使測試不受其它測試在共用 DB 種的 shared 模型列干擾（測試隔離）。
    /// </summary>
    private static async Task SeedClaudeModelAsync(ZonWikiDbContext db, Guid userId, string key)
    {
        db.AiModel.Add(new AiModel
        {
            UserId = userId,
            Key = key,
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

    private const string ValidJson =
        "{\"phonetic\":\"/rɪˈzɪliənt/\",\"partOfSpeech\":\"adjective\"," +
        "\"definitionEn\":\"able to recover quickly\",\"definitionZh\":\"有韌性的\"," +
        "\"exampleSentence\":\"She is resilient.\"}";

    [Fact]
    public async Task EnrichAsync_合法JSON_正確解析五欄()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, new FakeAiProvider(new[] { ValidJson }));

            var outcome = await service.EnrichAsync(userId, "resilient", "in a sentence", CancellationToken.None);

            outcome.Success.Should().BeTrue();
            outcome.Phonetic.Should().Be("/rɪˈzɪliənt/");
            outcome.PartOfSpeech.Should().Be("adjective");
            outcome.DefinitionEn.Should().Be("able to recover quickly");
            outcome.DefinitionZh.Should().Be("有韌性的");
            outcome.ExampleSentence.Should().Be("She is resilient.");
        }
    }

    [Fact]
    public async Task EnrichAsync_圍欄JSON_StripFence後仍解析()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var fenced = "```json\n" + ValidJson + "\n```";
            var service = BuildService(db, new FakeAiProvider(new[] { fenced }));

            var outcome = await service.EnrichAsync(userId, "resilient", null, CancellationToken.None);

            outcome.Success.Should().BeTrue();
            outcome.DefinitionZh.Should().Be("有韌性的");
        }
    }

    [Fact]
    public async Task EnrichAsync_壞JSON_回降級()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, new FakeAiProvider(new[] { "這不是 JSON，只是一段中文散文。" }));

            var outcome = await service.EnrichAsync(userId, "亂七八糟", null, CancellationToken.None);

            outcome.Success.Should().BeFalse();
            outcome.DefinitionZh.Should().BeNull();
            outcome.Phonetic.Should().BeNull();
        }
    }

    [Fact]
    public async Task EnrichAsync_provider回Error事件_拋VocabularyEnrichException()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            // 種一筆本人 ClaudeCli 列 ＋ 指定模型鍵，讓 ResolveAsync 確定回退到 ErrorAiProvider（測試隔離）。
            var key = $"vocab-error-{Guid.NewGuid():N}";
            await SeedClaudeModelAsync(db, userId, key);
            var service = BuildService(db, new ErrorAiProvider("AI 端點回報錯誤：boom"), vertexModelKey: key);

            var act = async () => await service.EnrichAsync(userId, "resilient", null, CancellationToken.None);

            await act.Should().ThrowAsync<VocabularyEnrichException>();
        }
    }

    [Fact]
    public void BuildSystemPrompt_含word與context與JSON約定與五欄鍵名()
    {
        var prompt = VocabularyEnrichmentService.BuildSystemPrompt("resilient", "in a sentence");

        prompt.Should().Contain("resilient");
        prompt.Should().Contain("in a sentence");
        prompt.Should().Contain("JSON");
        prompt.Should().Contain("phonetic");
        prompt.Should().Contain("partOfSpeech");
        prompt.Should().Contain("definitionEn");
        prompt.Should().Contain("definitionZh");
        prompt.Should().Contain("exampleSentence");
    }

    /// <summary>吐一個 Error 事件的測試供應者（非-Fake，讓工廠不短路、經 entry-null 退回本供應者）。</summary>
    private sealed class ErrorAiProvider(string message) : IAiProvider
    {
        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield return new AiStreamEvent(AiStreamEventType.Error, message);
        }
    }

    /// <summary>最小 IHttpClientFactory。</summary>
    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
