using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Testcontainers.PostgreSql;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// <see cref="AiProviderFactory.ResolveChainAsync"/> 的整合測試（真 PostgreSQL）：
/// 驗證後援鏈依「①Claude ②Google AI Studio ③banana」順序組裝、缺設定自動略過、測試模式短路為單一 Fake。
/// </summary>
public sealed class AiProviderFactoryChainTests : IAsyncLifetime
{
    private PostgreSqlContainer? _container;
    private DbContextOptions<ZonWikiDbContext>? _dbOptions;

    private const string GoogleOpenAiEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai";

    public async Task InitializeAsync()
    {
        _container = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
        await _container.StartAsync();

        _dbOptions = new DbContextOptionsBuilder<ZonWikiDbContext>()
            .UseNpgsql(_container.GetConnectionString())
            .ReplaceService<Microsoft.EntityFrameworkCore.Infrastructure.IModelCacheKeyFactory,
                UserModelCacheKeyFactory>()
            .AddInterceptors(new UserIsolationMaterializationInterceptor())
            .Options;

        await using var ctx = new ZonWikiDbContext(_dbOptions, null);
        await ctx.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (_container is not null)
        {
            await _container.StopAsync();
            await _container.DisposeAsync();
        }
    }

    /// <summary>建立工廠（_default 為非-Fake 的空供應者，避免短路；金鑰用短明碼直通）。</summary>
    private AiProviderFactory CreateFactory(ZonWikiDbContext db, IAiProvider? defaultProvider = null)
    {
        var resolver = new AiModelResolver(db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        return new AiProviderFactory(defaultProvider ?? new NoopProvider(), db, resolver, new StubHttpClientFactory());
    }

    private static AiModel SharedOpenAi(string key, string label) => new()
    {
        UserId = AiProviderFactory.SharedModelUserId,
        Key = key,
        Label = label,
        Provider = "OpenAiCompatible",
        Kind = "chat",
        Enabled = true,
        ModelId = "gemini-2.0-flash-lite",
        BaseUrl = GoogleOpenAiEndpoint,
        ApiKeyEncrypted = "plain-test-key", // 短 ASCII → AiModelResolver 直通為明碼
        CreatedUser = "test",
        UpdatedUser = "test",
    };

    [Fact]
    public async Task ResolveChainAsync_有banana與aistudio_依序組成三家鏈()
    {
        // Arrange
        await using var seed = new ZonWikiDbContext(_dbOptions!, null);
        seed.AiModel.Add(SharedOpenAi(AiProviderFactory.SharedAiStudioModelKey, "AIStudio"));
        seed.AiModel.Add(SharedOpenAi(AiProviderFactory.SharedDefaultModelKey, "banana"));
        await seed.SaveChangesAsync();

        await using var db = new ZonWikiDbContext(_dbOptions!, null);
        var factory = CreateFactory(db);

        // Act
        var resolved = await factory.ResolveChainAsync();

        // Assert
        resolved.Provider.Should().BeOfType<FallbackChainProvider>();
        ((FallbackChainProvider)resolved.Provider).ProviderLabels
            .Should().Equal(AiProviderFactory.ClaudeLinkLabel, "Google AI Studio", "banana");
        resolved.SupportsResume.Should().BeFalse();
    }

    [Fact]
    public async Task ResolveChainAsync_缺aistudio_鏈為Claude與banana()
    {
        // Arrange：只有 banana。
        await using var seed = new ZonWikiDbContext(_dbOptions!, null);
        seed.AiModel.Add(SharedOpenAi(AiProviderFactory.SharedDefaultModelKey, "banana"));
        await seed.SaveChangesAsync();

        await using var db = new ZonWikiDbContext(_dbOptions!, null);
        var factory = CreateFactory(db);

        // Act
        var resolved = await factory.ResolveChainAsync();

        // Assert
        ((FallbackChainProvider)resolved.Provider).ProviderLabels
            .Should().Equal(AiProviderFactory.ClaudeLinkLabel, "banana");
    }

    [Fact]
    public async Task ResolveChainAsync_aistudio停用_自動略過()
    {
        // Arrange：aistudio Enabled=false。
        await using var seed = new ZonWikiDbContext(_dbOptions!, null);
        var disabled = SharedOpenAi(AiProviderFactory.SharedAiStudioModelKey, "AIStudio");
        disabled.Enabled = false;
        seed.AiModel.Add(disabled);
        seed.AiModel.Add(SharedOpenAi(AiProviderFactory.SharedDefaultModelKey, "banana"));
        await seed.SaveChangesAsync();

        await using var db = new ZonWikiDbContext(_dbOptions!, null);
        var factory = CreateFactory(db);

        // Act
        var resolved = await factory.ResolveChainAsync();

        // Assert：停用的 aistudio 不在鏈內。
        ((FallbackChainProvider)resolved.Provider).ProviderLabels
            .Should().Equal(AiProviderFactory.ClaudeLinkLabel, "banana");
    }

    [Fact]
    public async Task ResolveChainAsync_無任何共用模型_僅Claude一家()
    {
        await using var db = new ZonWikiDbContext(_dbOptions!, null);
        var factory = CreateFactory(db);

        var resolved = await factory.ResolveChainAsync();

        ((FallbackChainProvider)resolved.Provider).ProviderLabels
            .Should().Equal(AiProviderFactory.ClaudeLinkLabel);
    }

    [Fact]
    public async Task ResolveChainAsync_測試模式_短路為單一Fake()
    {
        await using var db = new ZonWikiDbContext(_dbOptions!, null);
        var fake = new FakeAiProvider();
        var factory = CreateFactory(db, fake);

        var resolved = await factory.ResolveChainAsync();

        resolved.Provider.Should().BeSameAs(fake);
        resolved.Provider.Should().NotBeOfType<FallbackChainProvider>();
    }

    /// <summary>非-Fake 的空供應者，僅用於讓 ResolveChainAsync 不短路（StreamAsync 不會在本測試被呼叫）。</summary>
    private sealed class NoopProvider : IAiProvider
    {
        public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
            string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield break;
        }
    }

    /// <summary>最小 IHttpClientFactory（ResolveChainAsync 只建構供應者、不發 HTTP）。</summary>
    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
