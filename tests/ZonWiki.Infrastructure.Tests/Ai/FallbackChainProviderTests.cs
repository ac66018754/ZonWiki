using FluentAssertions;
using ZonWiki.Infrastructure.Ai;
using static ZonWiki.Infrastructure.Tests.Ai.ScriptedAiProvider;

namespace ZonWiki.Infrastructure.Tests.Ai;

/// <summary>
/// <see cref="FallbackChainProvider"/> 的單元測試：成功/重試/換家/全敗/空白/例外/取消/階段事件序/逐 link 模型。
/// </summary>
public sealed class FallbackChainProviderTests
{
    /// <summary>收集串流出的所有事件（測試用）。取消會向上拋。</summary>
    private static async Task<List<AiStreamEvent>> CollectAsync(
        IAiProvider provider, CancellationToken ct = default)
    {
        var events = new List<AiStreamEvent>();
        await foreach (var evt in provider.StreamAsync("問題", cancellationToken: ct))
        {
            events.Add(evt);
        }
        return events;
    }

    private static ChainLink Link(string label, IAiProvider p, string? model = null) => new(label, p, model);

    [Fact]
    public async Task 第一家成功_只嘗試一次_轉發結果且不碰後面()
    {
        // Arrange
        var first = Succeeds("第一家答案", "第一", "家", "答案");
        var second = Succeeds("不該被呼叫");
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        first.CallCount.Should().Be(1);
        second.CallCount.Should().Be(0, "第一家成功就不該碰第二家");
        events.Should().ContainSingle(e => e.Type == AiStreamEventType.Completed)
            .Which.Text.Should().Be("第一家答案");
        events.Where(e => e.Type == AiStreamEventType.Delta).Select(e => e.Text)
            .Should().Equal("第一", "家", "答案");
        // 第一個事件是 AttemptStart。
        events[0].Type.Should().Be(AiStreamEventType.Stage);
        events[0].StageKind.Should().Be(AiStageKind.AttemptStart);
        events.Should().NotContain(e => e.Type == AiStreamEventType.Error);
    }

    [Fact]
    public async Task 第一家失敗一次後第二次成功_共兩次_兩個階段事件()
    {
        // Arrange：同一家、第一次 Error、第二次成功。
        var first = new ScriptedAiProvider(
            new Attempt(Array.Empty<string>(), Outcome.Error, "暫時失敗"),
            new Attempt(new[] { "成功" }, Outcome.Completed, "成功"));
        var chain = new FallbackChainProvider(new[] { Link("A", first) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        first.CallCount.Should().Be(2);
        events.Count(e => e.Type == AiStreamEventType.Stage && e.StageKind == AiStageKind.AttemptStart).Should().Be(2);
        events.Count(e => e.Type == AiStreamEventType.Stage && e.StageKind == AiStageKind.AttemptFailed).Should().Be(1);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
        events.Last().Text.Should().Be("成功");
    }

    [Fact]
    public async Task 第一家兩次皆失敗_換第二家成功_共三次()
    {
        // Arrange
        var first = new ScriptedAiProvider(
            new Attempt(Array.Empty<string>(), Outcome.Error, "壞了1"),
            new Attempt(Array.Empty<string>(), Outcome.Throw, "壞了2"));
        var second = Succeeds("第二家救援");
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        first.CallCount.Should().Be(2);
        second.CallCount.Should().Be(1);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
        events.Last().Text.Should().Be("第二家救援");
        // 應有 3 個 AttemptStart（A1, A2, B1）與 2 個 AttemptFailed（A1, A2）。
        events.Count(e => e.StageKind == AiStageKind.AttemptStart).Should().Be(3);
        events.Count(e => e.StageKind == AiStageKind.AttemptFailed).Should().Be(2);
    }

    [Fact]
    public async Task 三家各兩次全失敗_最終Error_含六次摘要與六個AttemptStart()
    {
        // Arrange：三家、每家兩次都失敗（共 6 次）。
        ScriptedAiProvider AlwaysFail(string tag) => new(
            new Attempt(Array.Empty<string>(), Outcome.Error, $"{tag}-1"),
            new Attempt(Array.Empty<string>(), Outcome.Error, $"{tag}-2"));
        var a = AlwaysFail("A");
        var b = AlwaysFail("B");
        var c = AlwaysFail("C");
        var chain = new FallbackChainProvider(new[] { Link("A", a), Link("B", b), Link("C", c) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        (a.CallCount + b.CallCount + c.CallCount).Should().Be(6);
        events.Count(e => e.StageKind == AiStageKind.AttemptStart).Should().Be(6);
        events.Count(e => e.StageKind == AiStageKind.AttemptFailed).Should().Be(6);
        var final = events.Last();
        final.Type.Should().Be(AiStreamEventType.Error);
        final.Text.Should().Contain("6 次");
        events.Should().NotContain(e => e.Type == AiStreamEventType.Completed);
    }

    [Fact]
    public async Task 空白回應且無Delta_視為失敗_觸發換家()
    {
        // Arrange：第一家 Completed("   ") 無 Delta → 失敗；第二家成功。
        var first = new ScriptedAiProvider(
            new Attempt(Array.Empty<string>(), Outcome.EmptyCompleted, "   "),
            new Attempt(Array.Empty<string>(), Outcome.EmptyCompleted, ""));
        var second = Succeeds("救援");
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        first.CallCount.Should().Be(2, "兩次都空白都算失敗");
        second.CallCount.Should().Be(1);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
        events.Last().Text.Should().Be("救援");
    }

    [Fact]
    public async Task 串過非空白Delta但Completed為空_視為成功_不換家()
    {
        // Arrange：吐了非空白 Delta，但 Completed 文字為空（有些供應者只在 Delta 帶內容）。
        var first = new ScriptedAiProvider(
            new Attempt(new[] { "有", "內容" }, Outcome.EmptyCompleted, ""));
        var second = Succeeds("不該被呼叫");
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        second.CallCount.Should().Be(0, "已串出非空白 Delta 即視為成功");
        events.Should().NotContain(e => e.Type == AiStreamEventType.Error);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
        events.Where(e => e.Type == AiStreamEventType.Delta).Select(e => e.Text).Should().Equal("有", "內容");
    }

    [Fact]
    public async Task 串流中拋例外_視為失敗_換下一家()
    {
        // Arrange
        var first = new ScriptedAiProvider(
            new Attempt(new[] { "一半" }, Outcome.Throw, "炸了"),
            new Attempt(new[] { "再一半" }, Outcome.Throw, "又炸了"));
        var second = Succeeds("穩了");
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) });

        // Act
        var events = await CollectAsync(chain);

        // Assert
        first.CallCount.Should().Be(2);
        second.CallCount.Should().Be(1);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
        events.Last().Text.Should().Be("穩了");
        events.Count(e => e.StageKind == AiStageKind.AttemptFailed).Should().Be(2);
    }

    [Fact]
    public async Task 外部取消_立即停止_轉拋OperationCanceledException()
    {
        // Arrange：預先取消的權杖；第一家會吐 Delta（其中會檢查取消）。
        var first = new ScriptedAiProvider(new Attempt(new[] { "一", "二" }, Outcome.Completed, "全"));
        var chain = new FallbackChainProvider(new[] { Link("A", first) });
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act + Assert
        var act = async () => await CollectAsync(chain, cts.Token);
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task 階段事件序正確_AttemptStart在Delta之前_失敗後才換家()
    {
        // Arrange
        var first = new ScriptedAiProvider(
            new Attempt(new[] { "x" }, Outcome.Error, "敗"));
        var second = Succeeds("好", "好");
        // 用每家只試一次，序列才是 A1→換 B1（驗證 attemptsPerProvider 可調）。
        var chain = new FallbackChainProvider(new[] { Link("A", first), Link("B", second) }, attemptsPerProvider: 1);

        // Act
        var events = await CollectAsync(chain);

        // Assert：序列應為 AttemptStart(A1) → Delta(x) → AttemptFailed(A1) → AttemptStart(B1) → Delta(好) → Completed。
        var kinds = events.Select(e => (e.Type, e.StageKind)).ToList();
        kinds[0].Should().Be((AiStreamEventType.Stage, AiStageKind.AttemptStart));
        kinds[1].Should().Be((AiStreamEventType.Delta, (string?)null));
        kinds[2].Should().Be((AiStreamEventType.Stage, AiStageKind.AttemptFailed));
        kinds[3].Should().Be((AiStreamEventType.Stage, AiStageKind.AttemptStart));
        events[3].ProviderLabel.Should().Be("B");
        events[3].AttemptInChain.Should().Be(2);
        events.Last().Type.Should().Be(AiStreamEventType.Completed);
    }

    [Fact]
    public async Task 逐link帶對應模型()
    {
        // Arrange
        var first = new ScriptedAiProvider(new Attempt(Array.Empty<string>(), Outcome.Error, "x"));
        var second = Succeeds("ok");
        var chain = new FallbackChainProvider(new[]
        {
            Link("A", first, model: "sonnet"),
            Link("B", second, model: "gemini-2.0-flash-lite"),
        });

        // Act
        await CollectAsync(chain);

        // Assert
        first.ReceivedModels.Should().AllBe("sonnet");
        second.ReceivedModels.Should().ContainSingle().Which.Should().Be("gemini-2.0-flash-lite");
    }

    [Fact]
    public void 建構子_空清單_拋ArgumentException()
    {
        var act = () => new FallbackChainProvider(Array.Empty<ChainLink>());
        act.Should().Throw<ArgumentException>();
    }
}

/// <summary>
/// <see cref="AiErrorSanitizer"/> 去敏測試：金鑰與路徑不得外洩。
/// </summary>
public sealed class AiErrorSanitizerTests
{
    [Theory]
    [InlineData("401 Unauthorized: Bearer sk-abc123DEF456ghi", "sk-abc123DEF456ghi")]
    [InlineData("invalid key=AQ.Ab8RN6I3HJYhHhdq", "AQ.Ab8RN6I3HJYhHhdq")]
    [InlineData("bad token AIzaSyD1234567890abcdef", "AIzaSyD1234567890abcdef")]
    public void 遮蔽金鑰樣式(string raw, string secretFragment)
    {
        var safe = AiErrorSanitizer.Sanitize(raw);
        safe.Should().NotContain(secretFragment);
    }

    [Fact]
    public void 遮蔽絕對路徑()
    {
        AiErrorSanitizer.Sanitize(@"file not found at C:\Users\User\.claude\secret.json")
            .Should().NotContain(@"C:\Users\User");
        AiErrorSanitizer.Sanitize("read /home/User/.claude/.credentials.json failed")
            .Should().NotContain("/home/User/.claude");
    }

    [Fact]
    public void 只取第一行且截斷()
    {
        var safe = AiErrorSanitizer.Sanitize("第一行錯誤\n第二行堆疊\n第三行");
        safe.Should().Be("第一行錯誤");
    }

    [Fact]
    public void 空訊息回未知錯誤()
    {
        AiErrorSanitizer.Sanitize(null).Should().Be("未知錯誤");
        AiErrorSanitizer.Sanitize("   ").Should().Be("未知錯誤");
    }
}
