using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Recurrence;

namespace ZonWiki.Api.Tests.Common;

/// <summary>
/// <see cref="RecurrenceRuleExpander"/> 的單元測試（#17 重複規則展開）。
///
/// 純函式邏輯（不碰資料庫）：鎖定「每日／每週 BYDAY／每月 BYMONTHDAY／每年、INTERVAL、COUNT、UNTIL、
/// 只展開到上界（不預先產生未來）、不支援規則安全回空」等行為契約。
/// </summary>
public sealed class RecurrenceRuleExpanderTests
{
    /// <summary>建立指定年月日時分的 UTC 時間（測試可讀性輔助）。</summary>
    private static DateTime Utc(int year, int month, int day, int hour = 9, int minute = 0) =>
        new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void Expand_Daily_ProducesOneOccurrencePerDayUpToUntil()
    {
        // Arrange
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 1, 5);

        // Act
        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY", anchor, until);

        // Assert：含錨點共 5 天（1/1..1/5）。
        occurrences.Should().HaveCount(5);
        occurrences.First().Should().Be(anchor);
        occurrences.Last().Should().Be(Utc(2026, 1, 5));
        occurrences.Should().OnlyContain(o => o.Kind == DateTimeKind.Utc);
    }

    [Fact]
    public void Expand_DailyWithInterval_SkipsDays()
    {
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 1, 10);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY;INTERVAL=3", anchor, until);

        // 1/1, 1/4, 1/7, 1/10
        occurrences.Should().Equal(
            Utc(2026, 1, 1), Utc(2026, 1, 4), Utc(2026, 1, 7), Utc(2026, 1, 10));
    }

    [Fact]
    public void Expand_DoesNotGenerateBeyondUntil()
    {
        // 上界即「現在」→ 不預先產生未來發生（#17 需求：不無限、不預產未來）。
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 1, 3, hour: 12);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY", anchor, until);

        occurrences.Should().Equal(Utc(2026, 1, 1), Utc(2026, 1, 2), Utc(2026, 1, 3));
    }

    [Fact]
    public void Expand_WeeklyWithByDay_MatchesSelectedWeekdays()
    {
        // 2026-01-01 是週四；每週一、三、五。
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 1, 12);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=WEEKLY;BYDAY=MO,WE,FR", anchor, until);

        // 錨點週四不在清單；其後 1/2(五) 1/5(一) 1/7(三) 1/9(五) 1/12(一)
        occurrences.Should().Equal(
            Utc(2026, 1, 2),
            Utc(2026, 1, 5),
            Utc(2026, 1, 7),
            Utc(2026, 1, 9),
            Utc(2026, 1, 12));
    }

    [Fact]
    public void Expand_MonthlyWithByMonthDay_UsesGivenDays()
    {
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 3, 31);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=MONTHLY;BYMONTHDAY=1,15", anchor, until);

        occurrences.Should().Equal(
            Utc(2026, 1, 1), Utc(2026, 1, 15),
            Utc(2026, 2, 1), Utc(2026, 2, 15),
            Utc(2026, 3, 1), Utc(2026, 3, 15));
    }

    [Fact]
    public void Expand_MonthlyDefaultDay_SkipsMonthsMissingThatDay()
    {
        // 錨點 1/31：2 月無 31 日應略過，3/31 應保留。
        var anchor = Utc(2026, 1, 31);
        var until = Utc(2026, 4, 30);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=MONTHLY", anchor, until);

        occurrences.Should().Equal(Utc(2026, 1, 31), Utc(2026, 3, 31));
    }

    [Fact]
    public void Expand_RespectsCount_IncludingAnchor()
    {
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 12, 31);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY;COUNT=3", anchor, until);

        occurrences.Should().Equal(Utc(2026, 1, 1), Utc(2026, 1, 2), Utc(2026, 1, 3));
    }

    [Fact]
    public void Expand_RespectsUntilInRule()
    {
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 12, 31);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY;UNTIL=20260103", anchor, until);

        // UNTIL 純日期視為當日尾端 → 含 1/3。
        occurrences.Should().Equal(Utc(2026, 1, 1), Utc(2026, 1, 2), Utc(2026, 1, 3));
    }

    [Fact]
    public void Expand_PreservesAnchorTimeOfDay()
    {
        var anchor = Utc(2026, 1, 1, hour: 14, minute: 30);
        var until = Utc(2026, 1, 3, hour: 23);

        var occurrences = RecurrenceRuleExpander.Expand("FREQ=DAILY", anchor, until);

        occurrences.Should().OnlyContain(o => o.Hour == 14 && o.Minute == 30);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("FREQ=HOURLY")] // 不支援的頻率
    [InlineData("INTERVAL=2")]  // 缺 FREQ
    [InlineData("garbage")]
    public void Expand_InvalidOrUnsupported_ReturnsEmpty(string? rule)
    {
        var occurrences = RecurrenceRuleExpander.Expand(rule, Utc(2026, 1, 1), Utc(2026, 6, 1));

        occurrences.Should().BeEmpty();
    }

    [Fact]
    public void Expand_AcceptsRrulePrefix()
    {
        var anchor = Utc(2026, 1, 1);
        var until = Utc(2026, 1, 3);

        var occurrences = RecurrenceRuleExpander.Expand("RRULE:FREQ=DAILY", anchor, until);

        occurrences.Should().HaveCount(3);
    }
}
