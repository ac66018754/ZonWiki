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
/// <see cref="TtsScriptService"/> 口語稿服務測試（重用整合基座容器取 DbContext；Fake 供應者短路不查 DB）：
/// 合法 segments JSON 解析、圍欄剝除、壞 JSON 降級為純文字（不 throw）、system prompt 含 §6.4 六規則。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class TtsScriptServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public TtsScriptServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    /// <summary>以指定回覆的 Fake 供應者建立口語稿服務（Fake→ResolveAsync 短路回定值，不查 DB）。</summary>
    private static TtsScriptService BuildService(ZonWikiDbContext db, string aiResponse)
    {
        var resolver = new AiModelResolver(
            db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        var factory = new AiProviderFactory(
            new FakeAiProvider(new[] { aiResponse }), db, resolver, new StubHttpClientFactory());
        var configuration = new ConfigurationBuilder().Build();
        return new TtsScriptService(factory, configuration, NullLogger<TtsScriptService>.Instance);
    }

    private const string ValidSegmentsJson =
        "{\"segments\":[{\"kind\":\"heading\",\"text\":\"第一節\"},{\"kind\":\"speech\",\"text\":\"這是內容\"}]}";

    [Fact]
    public async Task U8_合法segments_正確解析heading與speech()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, ValidSegmentsJson);

            var segments = await service.GenerateAsync(Guid.NewGuid(), "標題", "隨便的內容", CancellationToken.None);

            segments.Should().HaveCount(2);
            segments[0].IsHeading.Should().BeTrue();
            segments[0].Text.Should().Be("第一節");
            segments[1].Kind.Should().Be(TtsScriptSegment.SpeechKind);
            segments[1].Text.Should().Be("這是內容");
        }
    }

    [Fact]
    public async Task U9_壞JSON_降級為單一純文字speech不throw()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, "這不是 JSON，只是一段散文。");

            var segments = await service.GenerateAsync(
                Guid.NewGuid(), "標題", "# 真實內容\n這段會被朗讀", CancellationToken.None);

            segments.Should().ContainSingle();
            segments[0].Kind.Should().Be(TtsScriptSegment.SpeechKind);
            // 降級後 Markdown 記號被移除，但原文內容保留。
            segments[0].Text.Should().Contain("真實內容").And.Contain("這段會被朗讀");
            segments[0].Text.Should().NotContain("#");
        }
    }

    [Fact]
    public async Task U10_圍欄JSON_StripFence後仍解析()
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var fenced = "```json\n" + ValidSegmentsJson + "\n```";
            var service = BuildService(db, fenced);

            var segments = await service.GenerateAsync(Guid.NewGuid(), "標題", "內容", CancellationToken.None);

            segments.Should().HaveCount(2);
            segments[0].Text.Should().Be("第一節");
        }
    }

    [Fact]
    public void U11_BuildSystemPrompt_含六規則與JSON約定()
    {
        var prompt = TtsScriptService.BuildSystemPrompt();

        prompt.Should().Contain("表格");
        prompt.Should().Contain("程式碼");
        prompt.Should().Contain("圖片");
        prompt.Should().Contain("標題");
        prompt.Should().Contain("清單");
        prompt.Should().Contain("連結");
        prompt.Should().Contain("JSON");
        prompt.Should().Contain("segments");
        prompt.Should().Contain("heading");
        prompt.Should().Contain("speech");
    }

    /// <summary>最小 IHttpClientFactory（AiProviderFactory 建構所需，Fake 路徑不會用到）。</summary>
    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
