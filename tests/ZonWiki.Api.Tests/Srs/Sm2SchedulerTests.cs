using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Srs;

namespace ZonWiki.Api.Tests.Srs;

/// <summary>
/// <see cref="Sm2Scheduler"/> 的純函式單元測試（無 DB）：新卡首評、連續 Good 間隔遞增、
/// Again 重置/Lapses、EF 下限、Relearning 復健、四鍵單調、取整規則、評分解析。
/// 鎖定設計書 §3.4 的排程契約與各測試向量。
/// </summary>
public sealed class Sm2SchedulerTests
{
    /// <summary>把一次 <see cref="Sm2Result"/> 餵回成下一次的 <see cref="Sm2State"/>（連續複習用）。</summary>
    private static Sm2State Next(Sm2Result result) =>
        new(result.EasinessFactor, result.Repetitions, result.Lapses, result.IntervalDays, result.State);

    // U1
    [Fact]
    public void NewCard_預設值正確()
    {
        var card = Sm2Scheduler.NewCard();

        card.EasinessFactor.Should().Be(2.5);
        card.Repetitions.Should().Be(0);
        card.Lapses.Should().Be(0);
        card.IntervalDays.Should().Be(0);
        card.State.Should().Be(VocabularyReviewState.New);
    }

    // U2
    [Fact]
    public void 新卡首評Good_畢業且間隔1天()
    {
        var result = Sm2Scheduler.Review(Sm2Scheduler.NewCard(), VocabularyRating.Good);

        result.Repetitions.Should().Be(1);
        result.State.Should().Be(VocabularyReviewState.Review);
        result.IntervalDays.Should().Be(1);
        result.EasinessFactor.Should().Be(2.5);
        result.Lapses.Should().Be(0);
    }

    // U3
    [Fact]
    public void 新卡首評Easy_畢業且間隔4天且EF升()
    {
        var result = Sm2Scheduler.Review(Sm2Scheduler.NewCard(), VocabularyRating.Easy);

        result.IntervalDays.Should().Be(4);
        result.State.Should().Be(VocabularyReviewState.Review);
        result.EasinessFactor.Should().BeApproximately(2.6, 1e-9);
    }

    // U4
    [Fact]
    public void 連續Good_間隔嚴格遞增_1_6_15_38()
    {
        var state = Sm2Scheduler.NewCard();
        var intervals = new List<double>();
        for (var i = 0; i < 4; i++)
        {
            var result = Sm2Scheduler.Review(state, VocabularyRating.Good);
            intervals.Add(result.IntervalDays);
            state = Next(result);
        }

        intervals.Should().Equal(1, 6, 15, 38);
        intervals.Should().BeInAscendingOrder().And.OnlyHaveUniqueItems();
    }

    // U5
    [Fact]
    public void Again重置且Lapses加一_已畢業卡()
    {
        // NewCard→Good→Good ⇒ n=2, State=Review, EF=2.5, I=6
        var state = Next(Sm2Scheduler.Review(Sm2Scheduler.NewCard(), VocabularyRating.Good));
        state = Next(Sm2Scheduler.Review(state, VocabularyRating.Good));

        var result = Sm2Scheduler.Review(state, VocabularyRating.Again);

        result.Lapses.Should().Be(1);
        result.Repetitions.Should().Be(0);
        result.State.Should().Be(VocabularyReviewState.Relearning);
        result.IntervalDays.Should().Be(1);
        result.EasinessFactor.Should().BeApproximately(2.18, 1e-9);
    }

    // U6
    [Fact]
    public void 新卡Again_不計Lapses且進Learning()
    {
        var result = Sm2Scheduler.Review(Sm2Scheduler.NewCard(), VocabularyRating.Again);

        result.Lapses.Should().Be(0);
        result.State.Should().Be(VocabularyReviewState.Learning);
        result.Repetitions.Should().Be(0);
        result.IntervalDays.Should().Be(1);
        result.EasinessFactor.Should().BeLessThan(2.5);
    }

    // U7
    [Fact]
    public void EF下限1點3()
    {
        var state = Sm2Scheduler.NewCard();
        for (var i = 0; i < 6; i++)
        {
            var result = Sm2Scheduler.Review(state, VocabularyRating.Again);
            result.EasinessFactor.Should().BeGreaterThanOrEqualTo(Sm2Scheduler.MinEasinessFactor);
            state = Next(result);
        }

        state.EasinessFactor.Should().Be(Sm2Scheduler.MinEasinessFactor);
    }

    // U8
    [Fact]
    public void Relearning成功_重回Review並重啟間隔階梯()
    {
        // 造 Relearning：Good, Good, Again
        var state = Next(Sm2Scheduler.Review(Sm2Scheduler.NewCard(), VocabularyRating.Good));
        state = Next(Sm2Scheduler.Review(state, VocabularyRating.Good));
        state = Next(Sm2Scheduler.Review(state, VocabularyRating.Again));
        state.State.Should().Be(VocabularyReviewState.Relearning);

        var first = Sm2Scheduler.Review(state, VocabularyRating.Good);
        first.IntervalDays.Should().Be(1);
        first.State.Should().Be(VocabularyReviewState.Review);

        var second = Sm2Scheduler.Review(Next(first), VocabularyRating.Good);
        second.IntervalDays.Should().Be(6);
    }

    // U9
    [Fact]
    public void 成熟卡四鍵單調_HardLtGoodLtEasy()
    {
        var mature = new Sm2State(2.5, Repetitions: 2, Lapses: 0, IntervalDays: 15, VocabularyReviewState.Review);

        var preview = Sm2Scheduler.PreviewIntervals(mature);

        preview[VocabularyRating.Again].Should().Be(1);
        preview[VocabularyRating.Hard].Should().Be(18);
        preview[VocabularyRating.Good].Should().Be(38);
        preview[VocabularyRating.Easy].Should().Be(49);
        preview[VocabularyRating.Hard].Should().BeLessThan(preview[VocabularyRating.Good]);
        preview[VocabularyRating.Good].Should().BeLessThan(preview[VocabularyRating.Easy]);
    }

    // U10
    [Fact]
    public void Hard略降EF_Good不變EF_Easy升EF()
    {
        var mature = new Sm2State(2.5, Repetitions: 2, Lapses: 0, IntervalDays: 15, VocabularyReviewState.Review);

        Sm2Scheduler.Review(mature, VocabularyRating.Hard).EasinessFactor.Should().BeLessThan(2.5);
        Sm2Scheduler.Review(mature, VocabularyRating.Good).EasinessFactor.Should().Be(2.5);
        Sm2Scheduler.Review(mature, VocabularyRating.Easy).EasinessFactor.Should().BeGreaterThan(2.5);
    }

    // U11
    [Theory]
    [InlineData("Again", VocabularyRating.Again)]
    [InlineData("HARD", VocabularyRating.Hard)]
    [InlineData("good", VocabularyRating.Good)]
    [InlineData("  Easy  ", VocabularyRating.Easy)]
    public void ParseRating_合法四值不分大小寫(string raw, VocabularyRating expected)
    {
        Sm2Scheduler.ParseRating(raw).Should().Be(expected);
    }

    // U12
    [Fact]
    public void ParseRating_非法字串拋例外()
    {
        var act = () => Sm2Scheduler.ParseRating("xxx");
        act.Should().Throw<ArgumentException>();
    }

    // U13
    [Fact]
    public void 間隔取整且下限1()
    {
        // EF 接近下限、I 很小的成熟卡；Good 仍應回整數且 ≥1。
        var state = new Sm2State(Sm2Scheduler.MinEasinessFactor, Repetitions: 2, Lapses: 0, IntervalDays: 1, VocabularyReviewState.Review);

        var result = Sm2Scheduler.Review(state, VocabularyRating.Good);

        result.IntervalDays.Should().Be(Math.Round(result.IntervalDays));
        result.IntervalDays.Should().BeGreaterThanOrEqualTo(1);
    }

    // U13b（審查 LOW：鎖死 MidpointRounding.AwayFromZero）
    [Fact]
    public void 間隔取整_半數邊界_遠離零進位()
    {
        // I=5, EF=2.5, n≥2 ⇒ Good = round(5×2.5)=round(12.5)。
        // AwayFromZero ⇒ 13（ToEven 會得 12，用此向量鎖死進位模式）。
        var state = new Sm2State(2.5, Repetitions: 2, Lapses: 0, IntervalDays: 5, VocabularyReviewState.Review);

        var result = Sm2Scheduler.Review(state, VocabularyRating.Good);

        result.IntervalDays.Should().Be(13);
    }

    // U14（審查 #1：SM-2 無間隔上限 → now.AddDays(interval) 溢位 500）
    // 極大間隔的成熟卡連續 Easy，間隔恆被夾在上限（不再無限暴衝）。
    [Fact]
    public void 成熟卡連續Easy_間隔被夾在上限()
    {
        // 造一張間隔已很大的成熟卡（模擬多次 Easy 後的狀態；未夾上限時再 Easy 會算出千萬天）。
        var state = new Sm2State(3.0, Repetitions: 10, Lapses: 0, IntervalDays: 2_000_000, VocabularyReviewState.Review);

        for (var i = 0; i < 5; i++)
        {
            var result = Sm2Scheduler.Review(state, VocabularyRating.Easy);
            result.IntervalDays.Should().BeLessThanOrEqualTo(
                Sm2Scheduler.MaxIntervalDays,
                "間隔必須被夾在上限，避免 now.AddDays(interval) 溢位成 500");
            state = Next(result);
        }

        state.IntervalDays.Should().Be(Sm2Scheduler.MaxIntervalDays, "超過上限的間隔應被夾住為上限");
    }

    // U15（審查 #1）——從新卡連按多次 Easy，間隔最終收斂到上限且全程不超限。
    [Fact]
    public void 新卡連按多次Easy_間隔收斂到上限且全程不超限()
    {
        var state = Sm2Scheduler.NewCard();
        var maxSeen = 0.0;

        for (var i = 0; i < 20; i++)
        {
            var result = Sm2Scheduler.Review(state, VocabularyRating.Easy);
            result.IntervalDays.Should().BeLessThanOrEqualTo(Sm2Scheduler.MaxIntervalDays);
            maxSeen = Math.Max(maxSeen, result.IntervalDays);
            state = Next(result);
        }

        maxSeen.Should().Be(Sm2Scheduler.MaxIntervalDays, "連按夠多次 Easy 後應觸及上限");
    }

    // 補：預覽＝實際（審查 HIGH 的核心不變量——共用計算路徑）
    [Fact]
    public void 預覽間隔_等於實際複習結果()
    {
        var state = new Sm2State(2.36, Repetitions: 3, Lapses: 1, IntervalDays: 20, VocabularyReviewState.Review);
        var preview = Sm2Scheduler.PreviewIntervals(state);

        foreach (var rating in new[] { VocabularyRating.Again, VocabularyRating.Hard, VocabularyRating.Good, VocabularyRating.Easy })
        {
            var actual = Sm2Scheduler.Review(state, rating).IntervalDays;
            preview[rating].Should().Be(actual, "預覽必須與實際排程走同一段計算");
        }
    }
}
