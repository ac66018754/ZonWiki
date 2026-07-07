using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;
using ZonWiki.Api.Coach;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="CoachBudgetService"/> 全站花費熔斷測試（Phase 3 批次 1；真 PostgreSQL，重用整合基座容器）：
/// usageMetadata token 累計到今日／本月列、跨每日門檻、跨每月門檻、門檻內不熔斷、門檻 &lt;=0 停用熔斷。
///
/// 注意：CoachBudgetLedger 為<b>全站</b>（非 IUserOwned）計量帳，今日／本月各一列，跨測試共享。
/// 本集合內僅本類別碰此表且方法循序執行，故每測試開頭<b>先重置今日／本月列為 0</b> 以確保決定性。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class CoachBudgetServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public CoachBudgetServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>以 DI 的短命工廠（具體型別）＋自訂設定建立花費計量器。</summary>
    private CoachBudgetService BuildService(CoachOptions options)
    {
        var dbFactory = _factory.Services.GetRequiredService<CoachDbContextFactory>();
        return new CoachBudgetService(
            dbFactory, Microsoft.Extensions.Options.Options.Create(options), NullLogger<CoachBudgetService>.Instance);
    }

    /// <summary>重置今日／本月計量列為 0（決定性前置）。</summary>
    private async Task ResetCurrentPeriodsAsync()
    {
        var now = DateTime.UtcNow;
        var dailyKey = now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var monthlyKey = now.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);

        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            await db.CoachBudgetLedger
                .Where(l =>
                    (l.Scope == CoachBudgetLedger.ScopeDaily && l.PeriodKey == dailyKey)
                    || (l.Scope == CoachBudgetLedger.ScopeMonthly && l.PeriodKey == monthlyKey))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.TokenCount, 0L)
                    .SetProperty(x => x.EstimatedCostUsd, 0m));
        }
    }

    private async Task<(long DailyTokens, long MonthlyTokens)> ReadCurrentTokensAsync()
    {
        var now = DateTime.UtcNow;
        var dailyKey = now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var monthlyKey = now.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            var daily = await db.CoachBudgetLedger.AsNoTracking()
                .Where(l => l.Scope == CoachBudgetLedger.ScopeDaily && l.PeriodKey == dailyKey)
                .Select(l => (long?)l.TokenCount).FirstOrDefaultAsync() ?? 0;
            var monthly = await db.CoachBudgetLedger.AsNoTracking()
                .Where(l => l.Scope == CoachBudgetLedger.ScopeMonthly && l.PeriodKey == monthlyKey)
                .Select(l => (long?)l.TokenCount).FirstOrDefaultAsync() ?? 0;
            return (daily, monthly);
        }
    }

    [Fact]
    public async Task Accumulate_同步累計今日與本月token()
    {
        await ResetCurrentPeriodsAsync();
        var service = BuildService(new CoachOptions { GlobalDailyBudget = 1000m, GlobalMonthlyBudget = 1000m });

        await service.AccumulateAsync(50_000, CancellationToken.None);
        await service.AccumulateAsync(30_000, CancellationToken.None);

        var (daily, monthly) = await ReadCurrentTokensAsync();
        daily.Should().Be(80_000);
        monthly.Should().Be(80_000);
    }

    [Fact]
    public async Task IsOverBudget_門檻內回false()
    {
        await ResetCurrentPeriodsAsync();
        var service = BuildService(new CoachOptions { GlobalDailyBudget = 1000m, GlobalMonthlyBudget = 1000m });

        await service.AccumulateAsync(10_000, CancellationToken.None); // 成本約 0.12 USD

        (await service.IsOverBudgetAsync(CancellationToken.None)).Should().BeFalse();
    }

    [Fact]
    public async Task IsOverBudget_跨每日門檻回true()
    {
        await ResetCurrentPeriodsAsync();
        // 每日上限 1 USD、每月很高。100000 token ≈ 1.2 USD → 跨每日門檻。
        var service = BuildService(new CoachOptions { GlobalDailyBudget = 1.0m, GlobalMonthlyBudget = 1000m });

        (await service.IsOverBudgetAsync(CancellationToken.None)).Should().BeFalse("累計前應在門檻內");
        await service.AccumulateAsync(100_000, CancellationToken.None);
        (await service.IsOverBudgetAsync(CancellationToken.None)).Should().BeTrue("跨每日花費門檻應熔斷");
    }

    [Fact]
    public async Task IsOverBudget_跨每月門檻回true()
    {
        await ResetCurrentPeriodsAsync();
        var service = BuildService(new CoachOptions { GlobalDailyBudget = 1000m, GlobalMonthlyBudget = 1.0m });

        await service.AccumulateAsync(100_000, CancellationToken.None);
        (await service.IsOverBudgetAsync(CancellationToken.None)).Should().BeTrue("跨每月花費門檻應熔斷");
    }

    [Fact]
    public async Task IsOverBudget_門檻為0視為停用熔斷()
    {
        await ResetCurrentPeriodsAsync();
        var service = BuildService(new CoachOptions { GlobalDailyBudget = 0m, GlobalMonthlyBudget = 0m });

        await service.AccumulateAsync(1_000_000, CancellationToken.None); // 大量花費
        (await service.IsOverBudgetAsync(CancellationToken.None)).Should().BeFalse("門檻 <=0 停用熔斷");
    }
}
