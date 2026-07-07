using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ZonWiki.Api.Coach;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 全站教練花費熔斷計量器（其他功能群 Phase 3・計費斷路，【審修-S1/S2】）。
///
/// 職責：以 Vertex Live 回報的 usageMetadata token 累計「全站」每日／每月花費（估算美元）並持久化到
/// <see cref="CoachBudgetLedger"/>；跨過門檻（<see cref="CoachOptions.GlobalDailyBudget"/>／
/// <see cref="CoachOptions.GlobalMonthlyBudget"/>）→ 回報「停開新課」。
///
/// 生命週期與併發：註冊為 <b>singleton</b>（跨請求／跨場次累計），以 <see cref="CoachDbContextFactory"/>
/// 建<b>短命 DbContext</b> 寫入（不吊在任何請求 scope，【審修-A2】）；花費累計走<b>伺服器端原子遞增</b>
/// 故正確性不依賴鎖，<see cref="SemaphoreSlim"/> 僅序列化 daily／monthly 成對寫入；首建撞唯一索引（23505）改走原子遞增。
/// <see cref="CoachBudgetLedger"/> 非 IUserOwned，短命 context 無使用者過濾即可直接讀寫全站計量列。
/// </summary>
public sealed class CoachBudgetService
{
    /// <summary>
    /// token→美元的估算單價（每百萬 token 美元）。native-audio Live 定價會隨方案／輸入輸出模態變動，
    /// 此為<b>粗估</b>用於熔斷保守估計；權威帳單以 GCP 為準（見鐵則 #13：不捏造精確數字，標明為估算）。
    /// </summary>
    public const decimal EstimatedUsdPerMillionTokens = 12.0m;

    private readonly CoachDbContextFactory _dbFactory;
    private readonly CoachOptions _options;
    private readonly ILogger<CoachBudgetService> _logger;

    /// <summary>序列化 daily／monthly 兩列的成對寫入（正確性已由伺服器端原子遞增保證，此鎖僅為成對一致性）。</summary>
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    /// <summary>
    /// 建立花費熔斷計量器。
    /// </summary>
    /// <param name="dbFactory">
    /// 教練專用短命 DbContext 工廠（<b>刻意用具體型別而非泛型 <c>IDbContextFactory&lt;&gt;</c></b>——
    /// 該工廠建出的 context 無使用者隔離過濾，只該用於全站計量表，故不對外暴露泛型介面避免誤用）。
    /// </param>
    /// <param name="options">教練子系統設定（含全站每日／每月預算門檻）。</param>
    /// <param name="logger">記錄器。</param>
    public CoachBudgetService(
        CoachDbContextFactory dbFactory,
        IOptions<CoachOptions> options,
        ILogger<CoachBudgetService> logger)
    {
        _dbFactory = dbFactory;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// 累計一筆 usageMetadata 的 token 用量到「今日」與「本月」兩列（估算花費同步累加）。
    /// </summary>
    /// <param name="totalTokens">本次回報的總 token 數（usageMetadata.totalTokenCount；&lt;=0 直接略過）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    public async Task AccumulateAsync(long totalTokens, CancellationToken cancellationToken)
    {
        if (totalTokens <= 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        var addedCost = totalTokens / 1_000_000m * EstimatedUsdPerMillionTokens;

        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await UpsertAndAccumulateAsync(
                CoachBudgetLedger.ScopeDaily, DailyPeriodKey(now), totalTokens, addedCost, cancellationToken);
            await UpsertAndAccumulateAsync(
                CoachBudgetLedger.ScopeMonthly, MonthlyPeriodKey(now), totalTokens, addedCost, cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>
    /// 全站花費是否已跨過每日或每月門檻（跨過即應「停開新課」）。
    /// 門檻 &lt;=0 視為「不設限（停用熔斷）」；讀失敗一律保守回 false（不因計量器故障而全站鎖死）。
    /// </summary>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>已達或超過任一門檻時為 true。</returns>
    public async Task<bool> IsOverBudgetAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        try
        {
            await using var db = _dbFactory.CreateDbContext();

            if (_options.GlobalDailyBudget > 0)
            {
                var dailyCost = await GetCostAsync(db, CoachBudgetLedger.ScopeDaily, DailyPeriodKey(now), cancellationToken);
                if (dailyCost >= _options.GlobalDailyBudget)
                {
                    return true;
                }
            }

            if (_options.GlobalMonthlyBudget > 0)
            {
                var monthlyCost = await GetCostAsync(db, CoachBudgetLedger.ScopeMonthly, MonthlyPeriodKey(now), cancellationToken);
                if (monthlyCost >= _options.GlobalMonthlyBudget)
                {
                    return true;
                }
            }

            return false;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // 計量器讀取故障不應讓全站鎖死（熔斷是保護，不是單點故障源）；記錄後保守放行。
            _logger.LogWarning(exception, "教練花費熔斷讀取失敗，保守放行（不因計量器故障鎖死全站）。");
            return false;
        }
    }

    /// <summary>取某期間列目前的累計估算花費（列不存在回 0）。</summary>
    private static async Task<decimal> GetCostAsync(
        ZonWikiDbContext db,
        string scope,
        string periodKey,
        CancellationToken cancellationToken)
    {
        var row = await db.CoachBudgetLedger.AsNoTracking()
            .FirstOrDefaultAsync(l => l.Scope == scope && l.PeriodKey == periodKey, cancellationToken);
        return row?.EstimatedCostUsd ?? 0m;
    }

    /// <summary>
    /// 對某期間列 upsert 並累加。以短命 context 執行，全程<b>伺服器端原子遞增</b>
    /// （<c>SET TokenCount = TokenCount + n</c>，非讀進記憶體再回寫），故正確性不依賴 in-process 鎖，
    /// 即使日後多實例並發也不會 lost update（低估花費對熔斷保護而言是最危險的失敗模式）。
    /// 先原子遞增既有列（受影響 0 表示列不存在）→ 才首建；首建撞唯一索引即改回原子遞增。
    /// </summary>
    private async Task UpsertAndAccumulateAsync(
        string scope,
        string periodKey,
        long addedTokens,
        decimal addedCost,
        CancellationToken cancellationToken)
    {
        await using var db = _dbFactory.CreateDbContext();

        // 1) 先嘗試對既有列做伺服器端原子遞增。
        if (await AtomicIncrementAsync(db, scope, periodKey, addedTokens, addedCost, cancellationToken) > 0)
        {
            return;
        }

        // 2) 列不存在 → 首建（短命 context 無稽核攔截器 → 手動補齊六稽核欄，時間 UTC）。
        var now = DateTime.UtcNow;
        var fresh = new CoachBudgetLedger
        {
            Id = Guid.NewGuid(),
            Scope = scope,
            PeriodKey = periodKey,
            TokenCount = addedTokens,
            EstimatedCostUsd = addedCost,
            CreatedDateTime = now,
            UpdatedDateTime = now,
            CreatedUser = "system",
            UpdatedUser = "system",
            ValidFlag = true,
        };
        db.CoachBudgetLedger.Add(fresh);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // 並發首建撞 (Scope, PeriodKey) 唯一索引：卸掉本次新列，改對既有列原子遞增。
            db.Entry(fresh).State = EntityState.Detached;
            await AtomicIncrementAsync(db, scope, periodKey, addedTokens, addedCost, cancellationToken);
        }
    }

    /// <summary>對 (scope, periodKey) 列做伺服器端原子遞增；回傳受影響列數（0＝列不存在）。</summary>
    private static Task<int> AtomicIncrementAsync(
        ZonWikiDbContext db,
        string scope,
        string periodKey,
        long addedTokens,
        decimal addedCost,
        CancellationToken cancellationToken)
        => db.CoachBudgetLedger
            .Where(l => l.Scope == scope && l.PeriodKey == periodKey)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(l => l.TokenCount, l => l.TokenCount + addedTokens)
                    .SetProperty(l => l.EstimatedCostUsd, l => l.EstimatedCostUsd + addedCost)
                    .SetProperty(l => l.UpdatedDateTime, DateTime.UtcNow)
                    .SetProperty(l => l.UpdatedUser, "system"),
                cancellationToken);

    /// <summary>今日期間鍵（UTC，"yyyy-MM-dd"）。</summary>
    private static string DailyPeriodKey(DateTime nowUtc)
        => nowUtc.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>本月期間鍵（UTC，"yyyy-MM"）。</summary>
    private static string MonthlyPeriodKey(DateTime nowUtc)
        => nowUtc.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。</summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is DbException { SqlState: "23505" };
}
