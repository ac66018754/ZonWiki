using FluentAssertions;
using Xunit;
using ZonWiki.Domain.Tts;

namespace ZonWiki.Api.Tests.Tts;

/// <summary>
/// <see cref="TtsChapterCalculator"/> 章節時間位移純函式單元測試（審查修正 #2：欄名 startSeconds）。
/// </summary>
public sealed class TtsChapterCalculatorTests
{
    [Fact]
    public void U15_三章塊時長累加_offsets正確()
    {
        // 三章：A(2塊) / B(1塊) / C(1塊)；逐塊時長攤平 [1,1] / [2] / [1] → offsets [0,2,4]。
        var chapters = new List<(string, int)> { ("A", 2), ("B", 1), ("C", 1) };
        var durations = new List<double> { 1, 1, 2, 1 };

        var result = TtsChapterCalculator.ComputeChapterStarts(chapters, durations);

        result.Should().NotBeNull();
        result!.Select(c => c.Title).Should().Equal("A", "B", "C");
        result!.Select(c => c.StartSeconds).Should().Equal(0.0, 2.0, 4.0);
    }

    [Fact]
    public void U16_無標題章節_回null()
    {
        var chapters = new List<(string, int)> { ("", 1) };
        var durations = new List<double> { 1 };

        TtsChapterCalculator.ComputeChapterStarts(chapters, durations).Should().BeNull();
    }

    [Fact]
    public void 隱含開頭無標題章仍計入時間累積_只有標題章列進清單()
    {
        // 開頭無標題章（1 塊 1 秒）＋標題章 B（1 塊）→ B 的 startSeconds 應為 1（含開頭章時長）。
        var chapters = new List<(string, int)> { ("", 1), ("B", 1) };
        var durations = new List<double> { 1, 1 };

        var result = TtsChapterCalculator.ComputeChapterStarts(chapters, durations);

        result.Should().ContainSingle();
        result![0].Title.Should().Be("B");
        result[0].StartSeconds.Should().Be(1.0);
    }

    [Fact]
    public void 首章offset恆為零()
    {
        var chapters = new List<(string, int)> { ("開頭", 1), ("第二", 1) };
        var durations = new List<double> { 3.5, 2 };

        var result = TtsChapterCalculator.ComputeChapterStarts(chapters, durations);

        result![0].StartSeconds.Should().Be(0.0);
        result[1].StartSeconds.Should().Be(3.5);
    }
}
