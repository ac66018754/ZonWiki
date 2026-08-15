using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Tts;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="TtsDialogueScriptService"/> 對談腳本服務測試（Phase 3；重用整合基座容器取 DbContext，
/// Fake 供應者短路不查 DB）：合法 turns JSON 解析、講者正規化、圍欄剝除、壞 JSON 降級為單一 A 講者純文字
/// （不 throw）、system prompt 含雙主持人與 JSON 約定。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsDialogueScriptServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsDialogueScriptServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    /// <summary>以指定回覆的 Fake 供應者建立對談腳本服務（Fake→ResolveAsync 短路回定值，不查 DB）。</summary>
    private static TtsDialogueScriptService BuildService(ZonWikiDbContext db, string aiResponse)
    {
        var resolver = new AiModelResolver(
            db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        var factory = new AiProviderFactory(
            new FakeAiProvider(new[] { aiResponse }), db, resolver, new StubHttpClientFactory());
        var configuration = new ConfigurationBuilder().Build();
        return new TtsDialogueScriptService(factory, configuration, NullLogger<TtsDialogueScriptService>.Instance);
    }

    private const string ValidTurnsJson =
        "{\"turns\":[{\"speaker\":\"A\",\"text\":\"歡迎回到節目\"},{\"speaker\":\"B\",\"text\":\"我先整理重點\"}]}";

    [Fact]
    public async Task 合法turns_正確解析講者與文字()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, ValidTurnsJson);

            var turns = await service.GenerateAsync(Guid.NewGuid(), "標題", "隨便的內容", CancellationToken.None);

            turns.Should().HaveCount(2);
            turns[0].Speaker.Should().Be(TtsDialogueTurn.SpeakerA);
            turns[0].Text.Should().Be("歡迎回到節目");
            turns[1].Speaker.Should().Be(TtsDialogueTurn.SpeakerB);
            turns[1].Text.Should().Be("我先整理重點");
        }
    }

    [Fact]
    public async Task 未知講者_正規化為A()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var json = "{\"turns\":[{\"speaker\":\"主持人\",\"text\":\"開場白\"}]}";
            var service = BuildService(db, json);

            var turns = await service.GenerateAsync(Guid.NewGuid(), "標題", "內容", CancellationToken.None);

            turns.Should().ContainSingle();
            turns[0].Speaker.Should().Be(TtsDialogueTurn.SpeakerA);
        }
    }

    [Fact]
    public async Task 壞JSON_降級為單一A講者純文字不throw()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, "這不是 JSON，只是一段散文。");

            var turns = await service.GenerateAsync(
                Guid.NewGuid(), "標題", "# 真實內容\n這段會被朗讀", CancellationToken.None);

            turns.Should().ContainSingle();
            turns[0].Speaker.Should().Be(TtsDialogueTurn.SpeakerA);
            turns[0].Text.Should().Contain("真實內容").And.Contain("這段會被朗讀");
            turns[0].Text.Should().NotContain("#");
        }
    }

    [Fact]
    public async Task 圍欄JSON_StripFence後仍解析()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var fenced = "```json\n" + ValidTurnsJson + "\n```";
            var service = BuildService(db, fenced);

            var turns = await service.GenerateAsync(Guid.NewGuid(), "標題", "內容", CancellationToken.None);

            turns.Should().HaveCount(2);
            turns[0].Text.Should().Be("歡迎回到節目");
        }
    }

    [Fact]
    public void BuildSystemPrompt_含雙主持人與turns約定()
    {
        var prompt = TtsDialogueScriptService.BuildSystemPrompt();

        prompt.Should().Contain("主持人");
        prompt.Should().Contain("A");
        prompt.Should().Contain("B");
        prompt.Should().Contain("turns");
        prompt.Should().Contain("speaker");
    }

    /// <summary>最小 IHttpClientFactory（AiProviderFactory 建構所需，Fake 路徑不會用到）。</summary>
    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
