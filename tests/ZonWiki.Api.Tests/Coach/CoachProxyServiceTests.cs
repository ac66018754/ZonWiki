using System.Diagnostics;
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
using ZonWiki.Infrastructure.Coach;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="CoachProxyService"/> 橋接整合測試（真 PostgreSQL＋FakeCoachLiveClientFactory＋假瀏覽器通道）：
/// 會話生命週期（逐字稿落地→下課摘要）、goAway 重連帶 handle、resumption 持久化、孤兒回收真 Abort、
/// toolCall add_vocabulary 真入庫＋show_correction 寫 CorrectionJson、計費斷路（budget／max_session）真斷。
///
/// 以「直接建構 proxy＋注入 fake」驅動——比透過真 WS 握手更能精確驗證三不變式與 DB 落地。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class CoachProxyServiceTests
{
    private readonly ZonWikiApiFactory _factory;

    public CoachProxyServiceTests(ZonWikiApiFactory factory)
    {
        _factory = factory;
    }

    private CoachProxyService NewProxy(FakeCoachLiveClientFactory liveFactory, CoachOptions? options = null)
        => new(
            liveFactory,
            _factory.Services.GetRequiredService<IServiceScopeFactory>(),
            _factory.Services.GetRequiredService<CoachBudgetService>(),
            Options.Create(options ?? new CoachOptions()),
            NullLogger<CoachProxyService>.Instance);

    private async Task<Guid> SeedActiveSessionAsync(Guid userId, DateTime startedUtc, string? topic = "small talk")
    {
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            var now = DateTime.UtcNow;
            var session = new CoachSession
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Title = "測試場次",
                Topic = topic,
                Status = CoachSession.StatusActive,
                Model = "test-model",
                StartedDateTime = startedUtc,
                AccumulatedSeconds = 0,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userId.ToString(),
                UpdatedUser = userId.ToString(),
                ValidFlag = true,
            };
            db.CoachSession.Add(session);
            await db.SaveChangesAsync();
            return session.Id;
        }
    }

    private async Task<CoachSession> GetSessionAsync(Guid sessionId)
    {
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            return await db.CoachSession.IgnoreQueryFilters().AsNoTracking().FirstAsync(s => s.Id == sessionId);
        }
    }

    private async Task<List<CoachMessage>> GetMessagesAsync(Guid sessionId)
    {
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            return await db.CoachMessage.IgnoreQueryFilters().AsNoTracking()
                .Where(m => m.CoachSessionId == sessionId)
                .OrderBy(m => m.SeqNo)
                .ToListAsync();
        }
    }

    private static async Task<FakeCoachLiveClient> WaitForClientAsync(FakeCoachLiveClientFactory factory, int index)
    {
        await WaitUntilAsync(() => Task.FromResult(factory.Created.Count > index), $"client[{index}] 建立");
        return factory.Created[index];
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition, string because, int timeoutMs = 8000)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.ElapsedMilliseconds < timeoutMs)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(40);
        }

        throw new TimeoutException($"逾時等待：{because}");
    }

    // ── 會話生命週期 ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task 生命週期_逐字稿落地與下課收尾()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), "small talk", DateTime.UtcNow, 0, CancellationToken.None);

        var client = await WaitForClientAsync(liveFactory, 0);

        // 一回合：使用者說 hello、教練回 hi there、turnComplete → 落地 2 則。
        client.Emit(new CoachUserTranscriptEvent("hello"));
        client.Emit(new CoachAssistantTranscriptEvent("hi there"));
        client.Emit(new CoachTurnCompleteEvent());

        await WaitUntilAsync(async () => (await GetMessagesAsync(sessionId)).Count >= 2, "兩則逐字稿落地");

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));

        var messages = await GetMessagesAsync(sessionId);
        messages.Should().HaveCount(2);
        messages[0].Role.Should().Be(CoachMessage.RoleUser);
        messages[0].Content.Should().Be("hello");
        messages[0].SeqNo.Should().Be(1);
        messages[1].Role.Should().Be(CoachMessage.RoleAssistant);
        messages[1].Content.Should().Be("hi there");
        messages[1].SeqNo.Should().Be(2);

        var session = await GetSessionAsync(sessionId);
        session.Status.Should().Be(CoachSession.StatusEnded);
        session.EndedDateTime.Should().NotBeNull();

        browser.HasSentType("ready").Should().BeTrue();
        browser.HasSentType("ended").Should().BeTrue();
    }

    // ── goAway → 重連第二顆帶 handle ＋ resumption 持久化 ────────────────────────────

    [Fact]
    public async Task 重連_goAway後第二顆client的setup帶DB內handle()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory, new CoachOptions { ReconnectBaseMs = 10, MaxReconnectAttempts = 3 });
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);

        var client0 = await WaitForClientAsync(liveFactory, 0);

        // 伺服器滾動下發 handle → proxy 持久化到 DB。
        client0.Emit(new CoachSessionResumptionUpdateEvent("handle-abc", Resumable: true));
        await WaitUntilAsync(
            async () => (await GetSessionAsync(sessionId)).ResumptionHandle == "handle-abc",
            "handle 持久化到 DB");

        // goAway → 重連 → 建第二顆 client，setup 帶 DB 內 handle。
        client0.Emit(new CoachGoAwayEvent("2s"));

        var client1 = await WaitForClientAsync(liveFactory, 1);
        client1.ConnectedHandle.Should().Be("handle-abc", "重連的 setup 必須帶伺服器 DB 內的 handle");
        browser.HasSentType("reconnecting").Should().BeTrue();

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
    }

    // ── 孤兒回收真 Abort ───────────────────────────────────────────────────────────

    [Fact]
    public async Task 孤兒回收_瀏覽器閒置逾寬限_真Abort且Status為ended()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory, new CoachOptions { OrphanGraceSeconds = 1 });
        var browser = new FakeCoachClientChannel();

        // 瀏覽器完全不送任何訊框（含關閉）→ 應於寬限後被孤兒回收。
        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);

        var client = await WaitForClientAsync(liveFactory, 0);

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        client.AbortCount.Should().BeGreaterThan(0, "孤兒回收必須真的 Abort Vertex 連線（S1/S2）");
        var session = await GetSessionAsync(sessionId);
        session.Status.Should().Be(CoachSession.StatusEnded);
        session.EndedDateTime.Should().NotBeNull();
        browser.HasSentType("fatal").Should().BeTrue();
    }

    // ── toolCall add_vocabulary 真入庫 ＋ show_correction 寫 CorrectionJson ─────────────

    [Fact]
    public async Task toolCall_addVocabulary真入庫且設SourceCoachSessionId()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        client.Emit(new CoachToolCallEvent(new[]
        {
            new CoachToolCall("fc1", "add_vocabulary", "{\"word\":\"Serendipity\",\"context_sentence\":\"what a serendipity\"}"),
        }));

        // 入庫分兩次 SaveChanges（先 upsert 建卡、再設 SourceCoachSessionId）；等到來源場次已寫入再驗，
        // 避免讀到「卡已存在但來源尚未寫」的中間態。
        await WaitUntilAsync(
            async () => (await GetVocabAsync(userId, "serendipity"))?.SourceCoachSessionId == sessionId,
            "單字入庫且設好來源場次");

        var word = await GetVocabAsync(userId, "serendipity");
        word.Should().NotBeNull();
        word!.SourceCoachSessionId.Should().Be(sessionId);

        // toolResponse 以 WHEN_IDLE 回覆、前端收到 vocab_added。
        client.ToolResponses.Should().Contain(r => r.Name == "add_vocabulary" && r.Scheduling == "WHEN_IDLE");
        browser.HasSentType("vocab_added").Should().BeTrue();

        browser.CloseIncoming();
        // 【對抗復審-#8】收尾現在會 join 背景補釋義任務（有逾時），故放寬等待上限吸收其（含真 Vertex 呼叫）耗時。
        await run.WaitAsync(TimeSpan.FromSeconds(40));
    }

    [Fact]
    public async Task toolCall_showCorrection寫入assistant訊息的CorrectionJson()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        client.Emit(new CoachToolCallEvent(new[]
        {
            new CoachToolCall(
                "fc2",
                "show_correction",
                "{\"original\":\"I has a apple\",\"corrected\":\"I have an apple\",\"explanation_zh\":\"主詞用 have\"}"),
        }));
        client.Emit(new CoachAssistantTranscriptEvent("You should say I have an apple."));
        client.Emit(new CoachTurnCompleteEvent());

        await WaitUntilAsync(
            async () => (await GetMessagesAsync(sessionId)).Any(m => m.CorrectionJson != null),
            "糾錯卡寫入 assistant CoachMessage");

        var messages = await GetMessagesAsync(sessionId);
        var assistant = messages.First(m => m.CorrectionJson != null);
        assistant.Role.Should().Be(CoachMessage.RoleAssistant);
        assistant.CorrectionJson.Should().Contain("I have an apple");
        browser.HasSentType("correction").Should().BeTrue();

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
    }

    // ── 踢舊：被頂替的舊 proxy 不得收尾 session（新連線接手擁有它）──────────────────────

    [Fact]
    public async Task 踢舊_被displaced的舊proxy不收尾session且真Abort()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();
        var connectionId = Guid.NewGuid();

        var run = proxy.RunAsync(browser, userId, sessionId, connectionId, null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        // 模擬「同場」新連線頂替本連線（新連線 sessionId 與舊場相同）→ 令舊 proxy 立即釋放但不收尾。
        CoachProxyService.SignalDisplaced(connectionId, sessionId).Should().BeTrue();

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        client.AbortCount.Should().BeGreaterThan(0, "踢舊必須真的 Abort 舊 Vertex 連線");
        var session = await GetSessionAsync(sessionId);
        session.Status.Should().Be(
            CoachSession.StatusActive,
            "同場交棒的舊 proxy 不得把 session 收尾為 ended（新連線接手擁有它）");
        session.EndedDateTime.Should().BeNull();
    }

    // ── 跨場踢舊：被頂替的舊場（不同 session）仍須正常收尾＋釋放預算（【對抗復審-#3】）────────────
    [Fact]
    public async Task 踢舊_跨場_被displaced的舊proxy仍收尾舊場()
    {
        var userId = Guid.NewGuid();
        var oldSessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        // 頂替的新連線是「不同場次」（使用者在舊場仍活著時去連另一場）。
        var newSessionId = Guid.NewGuid();
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();
        var connectionId = Guid.NewGuid();

        var run = proxy.RunAsync(browser, userId, oldSessionId, connectionId, null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        // 跨場踢舊：新連線 sessionId 與舊場不同 → 舊場必須正常收尾（避免停在 active 吃幻影分鐘＋預算洩漏）。
        CoachProxyService.SignalDisplaced(connectionId, newSessionId).Should().BeTrue();

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        client.AbortCount.Should().BeGreaterThan(0, "踢舊必須真的 Abort 舊 Vertex 連線");
        var session = await GetSessionAsync(oldSessionId);
        session.Status.Should().Be(
            CoachSession.StatusEnded,
            "跨場踢舊時舊場必須正常收尾為 ended（否則以 now 累加幻影分鐘、SessionBudgets 洩漏）");
        session.EndedDateTime.Should().NotBeNull();
    }

    // ── 回合定案：turnComplete 送出明確 turn_end 訊號（【對抗復審-#4】文字模式多回合分泡）──────────
    [Fact]
    public async Task 回合定案_turnComplete送出turn_end定案訊號()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        client.Emit(new CoachAssistantTranscriptEvent("Great question!"));
        client.Emit(new CoachTurnCompleteEvent());

        await WaitUntilAsync(() => Task.FromResult(browser.HasSentType("turn_end")), "turnComplete 送出 turn_end");

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));

        browser.HasSentType("turn_end").Should().BeTrue(
            "turnComplete 必須送出明確的 turn_end 定案訊號，前端才能在文字模式多回合正確分泡（#4）");
    }

    // ── 強制終止：未 turnComplete 的當前回合逐字稿仍須落地（【對抗復審-#5】）──────────────────────
    [Fact]
    public async Task 強制終止_未turnComplete的當前回合逐字稿仍落地()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        // 累積一個「未 turnComplete」的回合，接著以 usage 觸發全站花費熔斷強制終止（不經 turnComplete）。
        // usage 與前兩則同走 pump2 單讀者、依序處理，故 Terminate 時 StringBuilder 內已含這兩段逐字稿。
        client.Emit(new CoachUserTranscriptEvent("this sentence never turn-completed"));
        client.Emit(new CoachAssistantTranscriptEvent("neither did my reply"));
        client.Emit(new CoachUsageMeteredEvent(1_000_000));

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        var messages = await GetMessagesAsync(sessionId);
        messages.Should().HaveCount(2, "強制終止時未 turnComplete 的當前回合逐字稿仍應落地（#5）");
        messages.Should().Contain(
            m => m.Role == CoachMessage.RoleUser && m.Content == "this sentence never turn-completed");
        var assistant = messages.First(m => m.Role == CoachMessage.RoleAssistant);
        assistant.Content.Should().Be("neither did my reply");
        assistant.InterruptedFlag.Should().BeTrue("被強制終止的當前回合以 interrupted 標記落地");
    }

    // ── barge-in 近似截點閉環：前端 barge_in 回報 → 落地到被打斷的 assistant（【對抗復審-#7】）────────
    [Fact]
    public async Task bargeIn_前端回報近似截點_落地到被打斷的assistant訊息()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        client.Emit(new CoachAssistantTranscriptEvent("This is a long reply that got cut off"));

        // 前端 barge_in（走 pump1）＋隨後一則 ping：等 pong 回來即證明 barge_in 已被 pump1 消費（同一單讀者依序），
        // 才在 pump2 送 interrupted＋turnComplete，讓 _pendingApproxCut 的寫入確定先於落地（消除跨泵競爭，使測試決定性）。
        browser.PushIncoming("{\"type\":\"barge_in\",\"approxCutChars\":10}");
        browser.PushIncoming("{\"type\":\"ping\"}");
        await WaitUntilAsync(() => Task.FromResult(browser.HasSentType("pong")), "barge_in 已被 pump1 消費");

        client.Emit(new CoachInterruptedEvent());
        client.Emit(new CoachTurnCompleteEvent());

        await WaitUntilAsync(
            async () => (await GetMessagesAsync(sessionId)).Any(m => m.Role == CoachMessage.RoleAssistant),
            "被打斷的 assistant 訊息落地");

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));

        var assistant = (await GetMessagesAsync(sessionId)).First(m => m.Role == CoachMessage.RoleAssistant);
        assistant.InterruptedFlag.Should().BeTrue();
        assistant.ApproxCutChars.Should().Be(10, "barge_in 回報的近似截點應落地到被打斷的訊息（#7）");
    }

    // ── 計費斷路真斷 ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task 計費斷路_單場硬時長到點_真Abort()
    {
        var userId = Guid.NewGuid();
        // 開場時間為 2 分鐘前、MaxSessionMinutes=1 → 一啟動即到點。
        var startedUtc = DateTime.UtcNow.AddMinutes(-2);
        var sessionId = await SeedActiveSessionAsync(userId, startedUtc);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory, new CoachOptions { MaxSessionMinutes = 1 });
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, startedUtc, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        client.AbortCount.Should().BeGreaterThan(0, "單場硬時長到點必須真的 Abort Vertex 連線");
        (await GetSessionAsync(sessionId)).Status.Should().Be(CoachSession.StatusEnded);
        browser.SentOfType("fatal").Should().Contain(
            e => e.GetProperty("reason").GetString() == "max_session");
    }

    [Fact]
    public async Task 計費斷路_全站花費熔斷_usage觸發即真Abort()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        // 一次灌爆全站每日預算（預設 $5；1,000,000 tokens × $12/M = $12 > $5）→ 立即熔斷。
        client.Emit(new CoachUsageMeteredEvent(1_000_000));

        await run.WaitAsync(TimeSpan.FromSeconds(15));

        client.AbortCount.Should().BeGreaterThan(0, "全站花費熔斷必須真的 Abort Vertex 連線");
        (await GetSessionAsync(sessionId)).Status.Should().Be(CoachSession.StatusEnded);
        browser.SentOfType("fatal").Should().Contain(e => e.GetProperty("reason").GetString() == "budget");
    }

    // ── 前端無麥克風 smoke：{type:text} 走文字回合 ──────────────────────────────────

    [Fact]
    public async Task 文字回合_前端text訊框轉為Vertex文字回合()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        browser.PushIncoming("{\"type\":\"text\",\"text\":\"How do I say hello?\"}");

        await WaitUntilAsync(() => Task.FromResult(client.SentText.Contains("How do I say hello?")), "文字回合送到 Vertex");

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
    }

    // ── accept 競態自我終止：仍完整收尾舊場（【對抗復審-#8 CRITICAL】）──────────────────────────
    [Fact]
    public async Task accept競態_併發槽已被他連線持有_自我終止仍完整收尾舊場()
    {
        var userId = Guid.NewGuid();
        // 開場時間為 1 分鐘前 → 收尾應落地 >0 的 AccumulatedSeconds（證明「幻影分鐘」已被落地、不再空轉累加）。
        var startedUtc = DateTime.UtcNow.AddMinutes(-1);
        var sessionId = await SeedActiveSessionAsync(userId, startedUtc);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var thisConnectionId = Guid.NewGuid();
        var otherConnectionId = Guid.NewGuid();

        try
        {
            // 模擬「accept 期間已被另一連線搶佔併發槽」：GetActiveConnection(userId) 回傳的持有者 != 本連線
            // → 觸發 RunAsync 開頭的 accept 競態自我終止分支（此分支繞過 SignalDisplaced）。
            CoachSessionService.ClaimConcurrencySlot(userId, otherConnectionId);

            var run = proxy.RunAsync(
                browser, userId, sessionId, thisConnectionId, null, startedUtc, 0, CancellationToken.None);

            await run.WaitAsync(TimeSpan.FromSeconds(15));

            // accept 競態自我終止（displaced）仍須「完整收尾」：因無法得知頂替者所屬場次，保守當跨場踢舊處理，
            // 標 ended＋落地 AccumulatedSeconds。修前此分支繞過 SignalDisplaced，_displacedByDifferentSession
            // 維持 false → FinishAsync 誤判同場交棒略過收尾 → 舊場停在 active 以 now 累加幻影分鐘＋預算洩漏（#8）。
            var session = await GetSessionAsync(sessionId);
            session.Status.Should().Be(
                CoachSession.StatusEnded,
                "accept 競態自我終止仍須收尾為 ended（否則以 now 累加幻影分鐘、SessionBudgets 洩漏）");
            session.EndedDateTime.Should().NotBeNull();
            session.AccumulatedSeconds.Should().BeGreaterThan(0, "收尾必須落地 AccumulatedSeconds（幻影分鐘已封頂）");

            // 未曾連上 Vertex（accept 競態在建 client 前就自我終止）。
            liveFactory.Created.Should().BeEmpty();
            browser.HasSentType("fatal").Should().BeTrue();
        }
        finally
        {
            // 清理靜態併發槽（userId 雖唯一，仍守序不留殘留狀態）。
            CoachSessionService.ReleaseConcurrencySlot(userId, otherConnectionId);
        }
    }

    // ── 入站超限：回 rejected 訊框、不靜默丟棄（【對抗復審-#8 HIGH】）─────────────────────────────
    [Fact]
    public async Task 入站文字過長_回rejected訊框且不轉Vertex()
    {
        var userId = Guid.NewGuid();
        var sessionId = await SeedActiveSessionAsync(userId, DateTime.UtcNow);
        var liveFactory = new FakeCoachLiveClientFactory();
        var proxy = NewProxy(liveFactory);
        var browser = new FakeCoachClientChannel();

        var run = proxy.RunAsync(browser, userId, sessionId, Guid.NewGuid(), null, DateTime.UtcNow, 0, CancellationToken.None);
        var client = await WaitForClientAsync(liveFactory, 0);

        // 單則文字上限為 2000 字元；送 2001 個 'a'（純 ASCII，無需跳脫）即超限。
        var tooLong = new string('a', 2001);
        browser.PushIncoming($"{{\"type\":\"text\",\"text\":\"{tooLong}\"}}");

        // 後端超限應回 rejected 訊框（reason=text_too_long），而非靜默丟棄。
        await WaitUntilAsync(
            () => Task.FromResult(
                browser.SentOfType("rejected").Any(e => e.GetProperty("reason").GetString() == "text_too_long")),
            "超長文字回 rejected");

        // 且不得把該超長回合轉給 Vertex（計費放大防護）。
        client.SentText.Should().NotContain(tooLong, "超長文字不得轉給 Vertex");

        browser.CloseIncoming();
        await run.WaitAsync(TimeSpan.FromSeconds(15));
    }

    // ── 小工具 ─────────────────────────────────────────────────────────────────────

    private async Task<bool> VocabExistsAsync(Guid userId, string word) => await GetVocabAsync(userId, word) is not null;

    private async Task<VocabularyWord?> GetVocabAsync(Guid userId, string word)
    {
        var scope = _factory.Services.CreateScope();
        using (scope)
        {
            var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
            return await db.VocabularyWord.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(v => v.UserId == userId && v.Word == word && v.ValidFlag);
        }
    }
}
