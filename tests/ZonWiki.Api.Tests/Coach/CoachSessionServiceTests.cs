using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;
using ZonWiki.Api.Coach;
using ZonWiki.Api.Services;
using ZonWiki.Api.Tests.Integration;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="CoachSessionService"/> 護欄服務測試（Phase 3 批次 1；真 PostgreSQL，重用整合基座容器）：
/// 開課寫 StartedDateTime、擁有權隔離、懶惰殭屍修正、每日分鐘計量（含 ended 精確／active 以 now 計入／
/// MinBilledMinutes 最小顆粒／跨日排除）、每日上限判定、每人 1 併發原子 claim（兩「分頁」同時只 1 過）。
///
/// 每測試各自 DI scope 取 DbContext（CurrentUserId 為 Guid.Empty → 不套全域過濾）；服務內一律以明確 UserId
/// ＋IgnoreQueryFilters 查詢，故行為確定。各測試用獨立 userId，靜態併發槽不互相干擾。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class CoachSessionServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public CoachSessionServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private (IServiceScope Scope, ZonWikiDbContext Db) NewScope()
    {
        var scope = _factory.Services.CreateScope();
        return (scope, scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>());
    }

    private static IOptions<CoachOptions> Options(CoachOptions? overrides = null)
        => Microsoft.Extensions.Options.Options.Create(overrides ?? new CoachOptions());

    /// <summary>直接種一場教練場次（可指定時間欄位）；回其 Id。UpdatedDateTime 以 ExecuteUpdate 回填（繞稽核）。</summary>
    private async Task<Guid> SeedSessionAsync(
        Guid userId,
        string status,
        DateTime startedUtc,
        DateTime? endedUtc,
        DateTime? updatedUtc = null)
    {
        var (scope, db) = NewScope();
        using (scope)
        {
            var now = DateTime.UtcNow;
            var session = new CoachSession
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Title = "測試場次",
                Status = status,
                Model = "test-model",
                StartedDateTime = startedUtc,
                EndedDateTime = endedUtc,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = true,
            };
            db.CoachSession.Add(session);
            await db.SaveChangesAsync();

            if (updatedUtc is not null)
            {
                await db.CoachSession.IgnoreQueryFilters()
                    .Where(s => s.Id == session.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedDateTime, updatedUtc.Value));
            }

            return session.Id;
        }
    }

    // ── 開課 ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OpenSession_寫StartedDateTime且Status為active()
    {
        var userId = Guid.NewGuid();
        var before = DateTime.UtcNow.AddSeconds(-1);
        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());

            var session = await service.OpenSessionAsync(userId, "我的練習", "旅遊英文", CancellationToken.None);

            session.Status.Should().Be(CoachSession.StatusActive);
            session.StartedDateTime.Should().BeAfter(before);
            session.EndedDateTime.Should().BeNull();
            session.Topic.Should().Be("旅遊英文");
            session.Model.Should().Be(new CoachOptions().Model);
        }
    }

    // ── 擁有權隔離 ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task 擁有權隔離_他人查不到場次()
    {
        var owner = Guid.NewGuid();
        var stranger = Guid.NewGuid();
        var id = await SeedSessionAsync(owner, CoachSession.StatusActive, DateTime.UtcNow, null);

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());

            (await service.FindSessionAsync(owner, id, CancellationToken.None)).Should().NotBeNull();
            (await service.FindSessionAsync(stranger, id, CancellationToken.None)).Should().BeNull();
            (await service.GetSessionWithTranscriptAsync(stranger, id, CancellationToken.None)).Should().BeNull();
        }
    }

    // ── 懶惰殭屍修正 ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task 懶惰殭屍修正_逾時active於清單時標記ended()
    {
        var userId = Guid.NewGuid();
        var started = DateTime.UtcNow.AddHours(-3);
        // active 且 UpdatedDateTime 為 3 小時前（超過 2 小時門檻）。
        var id = await SeedSessionAsync(
            userId, CoachSession.StatusActive, started, null, updatedUtc: DateTime.UtcNow.AddHours(-3));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());

            var list = await service.ListSessionsAsync(userId, CancellationToken.None);

            list.Should().ContainSingle();
            var fixedRow = await db.CoachSession.IgnoreQueryFilters().AsNoTracking().FirstAsync(s => s.Id == id);
            fixedRow.Status.Should().Be(CoachSession.StatusEnded, "逾時 active 應被懶惰修正為 ended");
            fixedRow.EndedDateTime.Should().NotBeNull();
        }
    }

    [Fact]
    public async Task 懶惰殭屍修正_近期active不受影響()
    {
        var userId = Guid.NewGuid();
        var id = await SeedSessionAsync(
            userId, CoachSession.StatusActive, DateTime.UtcNow.AddMinutes(-5), null,
            updatedUtc: DateTime.UtcNow.AddMinutes(-5));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());
            await service.ListSessionsAsync(userId, CancellationToken.None);

            var row = await db.CoachSession.IgnoreQueryFilters().AsNoTracking().FirstAsync(s => s.Id == id);
            row.Status.Should().Be(CoachSession.StatusActive, "5 分鐘前活動的 active 不應被修正");
        }
    }

    // ── 每日分鐘計量 ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task 日分鐘計量_ended場次精確加總()
    {
        var userId = Guid.NewGuid();
        var start = DateTime.UtcNow; // 今日
        await SeedSessionAsync(userId, CoachSession.StatusEnded, start, start.AddSeconds(300));
        await SeedSessionAsync(userId, CoachSession.StatusEnded, start, start.AddSeconds(200));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options(new CoachOptions { MinBilledMinutes = 1 }));
            var used = await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);
            used.Should().Be(500, "300 + 200 秒（皆 > 最小顆粒 60 秒）");
        }
    }

    [Fact]
    public async Task 日分鐘計量_未收尾active以now保守計入()
    {
        var userId = Guid.NewGuid();
        await SeedSessionAsync(userId, CoachSession.StatusActive, DateTime.UtcNow.AddSeconds(-200), null);

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options(new CoachOptions { MinBilledMinutes = 1 }));
            var used = await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);
            used.Should().BeInRange(200, 260, "active 場以 now 保守計入（約 200 秒，允許測試耗時緩衝）");
        }
    }

    [Fact]
    public async Task 日分鐘計量_最小計費顆粒下限()
    {
        var userId = Guid.NewGuid();
        var start = DateTime.UtcNow;
        // 只跑 10 秒的短場 → 應被最小顆粒 1 分鐘（60 秒）拉高。
        await SeedSessionAsync(userId, CoachSession.StatusEnded, start, start.AddSeconds(10));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options(new CoachOptions { MinBilledMinutes = 1 }));
            var used = await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);
            used.Should().Be(60, "10 秒短場應被最小計費顆粒（60 秒）拉高");
        }
    }

    [Fact]
    public async Task 日分鐘計量_跨午夜active只計今日交集不含昨日()
    {
        // 昨日 23:30 開場、仍 active（近期活動、非殭屍）→ 今日交集＝[今日00:00, now)，不含昨日的 30 分。
        // 用「active→終點取 now」而非固定時鐘終點，避免早於某時刻跑測試時終點落在未來造成不穩定。
        var userId = Guid.NewGuid();
        var todayStart = DateTime.UtcNow.Date;
        var startedYesterday = todayStart.AddMinutes(-30); // 昨日 23:30 UTC
        await SeedSessionAsync(userId, CoachSession.StatusActive, startedYesterday, null); // updatedUtc=null→now→非殭屍

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options(new CoachOptions { MinBilledMinutes = 0 }));
            var used = await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);

            var todaySoFar = (long)(DateTime.UtcNow - todayStart).TotalSeconds;
            used.Should().BeLessThanOrEqualTo(todaySoFar + 2, "應裁切到今日交集起點（不含昨日 30 分）");
            used.Should().BeGreaterThan(todaySoFar - 30, "應約等於今日已過秒數（now − 今日00:00）");
        }
    }

    [Fact]
    public async Task 日分鐘計量_讀路徑對殭屍active自我修復()
    {
        // 開場後客戶端當掉（active、UpdatedDateTime 為 3 小時前＝殭屍）→ 讀路徑（GetDailyUsedSecondsAsync）
        // 應先觸發殭屍修正把它收尾，避免以 now 一路累加而虛增用量、把使用者鎖死。以「Status→ended」做決定性驗證。
        var userId = Guid.NewGuid();
        var id = await SeedSessionAsync(
            userId, CoachSession.StatusActive, DateTime.UtcNow.AddHours(-10), null,
            updatedUtc: DateTime.UtcNow.AddHours(-3));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());
            await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);

            var row = await db.CoachSession.IgnoreQueryFilters().AsNoTracking().FirstAsync(s => s.Id == id);
            row.Status.Should().Be(CoachSession.StatusEnded, "讀路徑應觸發殭屍修正，不讓死場以 now 累加");
            row.EndedDateTime.Should().NotBeNull();
        }
    }

    [Fact]
    public async Task 日分鐘計量_跨日場次不計入今日()
    {
        var userId = Guid.NewGuid();
        var twoDaysAgo = DateTime.UtcNow.AddDays(-2);
        await SeedSessionAsync(userId, CoachSession.StatusEnded, twoDaysAgo, twoDaysAgo.AddSeconds(300));

        var (scope, db) = NewScope();
        using (scope)
        {
            var service = new CoachSessionService(db, Options());
            var used = await service.GetDailyUsedSecondsAsync(userId, CancellationToken.None);
            used.Should().Be(0, "兩天前開場的場次不計入今日用量");
        }
    }

    [Fact]
    public async Task 每日上限_達門檻回true()
    {
        var userId = Guid.NewGuid();
        var start = DateTime.UtcNow;
        await SeedSessionAsync(userId, CoachSession.StatusEnded, start, start.AddSeconds(300));

        var (scope, db) = NewScope();
        using (scope)
        {
            // 上限 1 分鐘（60 秒）；已用 300 秒 → 達上限。
            var service = new CoachSessionService(db, Options(new CoachOptions { DailyMinuteLimit = 1 }));
            (await service.IsDailyLimitReachedAsync(userId, CancellationToken.None)).Should().BeTrue();
        }
    }

    // ── 每人 1 併發原子 claim ─────────────────────────────────────────────────────

    [Fact]
    public async Task 併發claim_兩分頁同時只1過()
    {
        var userId = Guid.NewGuid();
        var connA = Guid.NewGuid();
        var connB = Guid.NewGuid();

        var results = await Task.WhenAll(
            Task.Run(() => CoachSessionService.ClaimConcurrencySlot(userId, connA)),
            Task.Run(() => CoachSessionService.ClaimConcurrencySlot(userId, connB)));

        // 兩者皆接受（新連線一律勝出），但只有「第一個搶到空槽」的 Displaced 為 null；另一個頂替它。
        results.Count(r => r.DisplacedConnectionId is null).Should().Be(1, "恰一個搶到空槽（另一個頂替之）");
        results.Should().OnlyContain(r => r.Accepted);

        // 最終只有一顆作用中連線（兩者之一）。
        var active = CoachSessionService.GetActiveConnection(userId);
        active.Should().NotBeNull();
        new[] { connA, connB }.Should().Contain(active!.Value);

        // 收尾：由擁有者釋放，回到無作用中連線。
        CoachSessionService.ReleaseConcurrencySlot(userId, active.Value).Should().BeTrue();
        CoachSessionService.GetActiveConnection(userId).Should().BeNull();
    }

    [Fact]
    public void 釋放併發槽_只有擁有者能釋放()
    {
        var userId = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var stranger = Guid.NewGuid();

        CoachSessionService.ClaimConcurrencySlot(userId, owner);

        // 非擁有者釋放 → false，槽不動。
        CoachSessionService.ReleaseConcurrencySlot(userId, stranger).Should().BeFalse();
        CoachSessionService.GetActiveConnection(userId).Should().Be(owner);

        // 擁有者釋放 → true。
        CoachSessionService.ReleaseConcurrencySlot(userId, owner).Should().BeTrue();
        CoachSessionService.GetActiveConnection(userId).Should().BeNull();
    }
}
