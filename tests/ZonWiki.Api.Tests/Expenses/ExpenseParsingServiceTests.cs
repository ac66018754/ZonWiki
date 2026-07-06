using System.Runtime.CompilerServices;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Expenses;

/// <summary>
/// <see cref="ExpenseParsingService"/> 的服務測試（真 PostgreSQL，重用整合基座容器）：
/// 合法 JSON 解析各欄、圍欄剝除、confidence 門檻、壞 JSON 降級、Error 事件拋例外、occurredAt 保底、取消傳播、prompt 內容。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class ExpenseParsingServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public ExpenseParsingServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    /// <summary>以指定的預設供應者建立解析服務（Fake→短路回定值；非-Fake→經 entry-null 退回該供應者）。</summary>
    private static ExpenseParsingService BuildService(ZonWikiDbContext db, IAiProvider provider)
    {
        var resolver = new AiModelResolver(
            db, DataProtectionProvider.Create("ZonWikiTests"), NullLogger<AiModelResolver>.Instance);
        var factory = new AiProviderFactory(provider, db, resolver, new StubHttpClientFactory());
        var categoryService = new ExpenseCategoryService(db);
        var configuration = new ConfigurationBuilder().Build();
        return new ExpenseParsingService(
            factory, categoryService, configuration, NullLogger<ExpenseParsingService>.Instance);
    }

    private const string ValidJson =
        "{\"reasoning\":\"在超商買書\",\"amount\":300,\"currency\":\"TWD\",\"merchant\":\"統一超商\"," +
        "\"items\":[\"書\",\"茶葉蛋\"],\"category\":\"購物\",\"occurredAt\":\"2026-07-06T04:30:00Z\"," +
        "\"confidence\":0.92,\"needsConfirmation\":false}";

    [Fact]
    public async Task ParseAsync_合法JSON_正確解析各欄()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, new FakeAiProvider(new[] { ValidJson }));

            var outcome = await service.ParseAsync(userId, "在7-11花300買書", null, null, CancellationToken.None);

            outcome.Success.Should().BeTrue();
            outcome.Amount.Should().Be(300m);
            outcome.Currency.Should().Be("TWD");
            outcome.Merchant.Should().Be("統一超商");
            outcome.CategoryName.Should().Be("購物");
            outcome.ItemsJson.Should().Contain("書");
            outcome.OccurredDateTimeUtc.Kind.Should().Be(DateTimeKind.Utc);
            outcome.OccurredDateTimeUtc.Should().Be(new DateTime(2026, 7, 6, 4, 30, 0, DateTimeKind.Utc));
            outcome.NeedsConfirmation.Should().BeFalse();
        }
    }

    [Fact]
    public async Task ParseAsync_JSON被三重圍欄包住_StripFence後仍解析()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var fenced = "```json\n" + ValidJson + "\n```";
            var service = BuildService(db, new FakeAiProvider(new[] { fenced }));

            var outcome = await service.ParseAsync(userId, "在7-11花300買書", null, null, CancellationToken.None);

            outcome.Success.Should().BeTrue();
            outcome.Amount.Should().Be(300m);
        }
    }

    [Fact]
    public async Task ParseAsync_confidence低於0點7_NeedsConfirmation為true()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var json = ValidJson.Replace("\"confidence\":0.92", "\"confidence\":0.5");
            var service = BuildService(db, new FakeAiProvider(new[] { json }));

            var outcome = await service.ParseAsync(userId, "買東西", null, null, CancellationToken.None);

            outcome.Success.Should().BeTrue();
            outcome.NeedsConfirmation.Should().BeTrue();
        }
    }

    [Fact]
    public async Task ParseAsync_confidence高於0點7_NeedsConfirmation為false()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var json = ValidJson.Replace("\"confidence\":0.92", "\"confidence\":0.95");
            var service = BuildService(db, new FakeAiProvider(new[] { json }));

            var outcome = await service.ParseAsync(userId, "買東西", null, null, CancellationToken.None);

            outcome.NeedsConfirmation.Should().BeFalse();
        }
    }

    [Fact]
    public async Task ParseAsync_壞JSON_回降級結果()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, new FakeAiProvider(new[] { "這不是 JSON，只是一段中文散文。" }));

            var outcome = await service.ParseAsync(userId, "亂七八糟", null, null, CancellationToken.None);

            outcome.Success.Should().BeFalse();
            outcome.NeedsConfirmation.Should().BeTrue();
        }
    }

    [Fact]
    public async Task ParseAsync_occurredAt缺失_保底為UtcNow附近()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var json = "{\"amount\":88,\"currency\":\"TWD\",\"category\":\"餐飲\",\"confidence\":0.9}";
            var service = BuildService(db, new FakeAiProvider(new[] { json }));

            var before = DateTime.UtcNow.AddSeconds(-5);
            var outcome = await service.ParseAsync(userId, "早餐88", null, null, CancellationToken.None);
            var after = DateTime.UtcNow.AddSeconds(5);

            outcome.Success.Should().BeTrue();
            outcome.OccurredDateTimeUtc.Should().BeOnOrAfter(before).And.BeOnOrBefore(after);
            outcome.OccurredDateTimeUtc.Kind.Should().Be(DateTimeKind.Utc);
        }
    }

    [Fact]
    public async Task ParseAsync_provider回Error事件_拋ExpenseParseException()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = BuildService(db, new ErrorAiProvider("AI 端點回報錯誤：boom"));

            var act = async () => await service.ParseAsync(userId, "買東西", null, null, CancellationToken.None);

            await act.Should().ThrowAsync<ExpenseParseException>();
        }
    }

    [Fact]
    public async Task ParseAsync_取消權杖已取消_拋OperationCanceledException()
    {
        var userId = Guid.NewGuid();
        var (scope, db) = NewScope();
        using (scope)
        {
            // 延遲的 Fake，讓已取消的權杖在串流時觸發取消。
            var service = BuildService(db, new FakeAiProvider(new[] { ValidJson }, delayMs: 2000));

            using var cts = new CancellationTokenSource();
            cts.Cancel();

            var act = async () => await service.ParseAsync(userId, "買東西", null, null, cts.Token);

            await act.Should().ThrowAsync<OperationCanceledException>();
        }
    }

    [Fact]
    public void BuildSystemPrompt_含裝置時間與時區與分類enum與fewShot()
    {
        var categories = new[] { "餐飲", "交通", "購物", "娛樂", "日用", "醫療", "訂閱", "其他" };
        var prompt = ExpenseParsingService.BuildSystemPrompt(
            categories, "2026-07-06T12:30:00+08:00", "Asia/Taipei");

        prompt.Should().Contain("2026-07-06T12:30:00+08:00");
        prompt.Should().Contain("Asia/Taipei");
        foreach (var name in categories)
        {
            prompt.Should().Contain(name);
        }
        prompt.Should().Contain("統一超商", "few-shot 應含商家正規化範例");
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
