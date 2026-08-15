using FluentAssertions;
using Xunit;
using ZonWiki.Api.Coach;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="CoachPromptAssembler.Compose"/> 純函式單元測試：六要素英文骨架＋到期單字注入＋前次摘要注入，
/// 以及【審修-S5】長度上限（防以歷史資料污染 systemInstruction）。
/// </summary>
public sealed class CoachPromptAssemblerTests
{
    [Fact]
    public void Compose_無主題無資料_含六要素骨架()
    {
        var prompt = CoachPromptAssembler.Compose(topic: null, dueWords: Array.Empty<string>(), previousSummary: null);

        prompt.Should().Contain("English speaking coach");
        prompt.Should().Contain("show_correction");
        prompt.Should().Contain("add_vocabulary");
        prompt.Should().Contain("what they would like to talk about"); // 無主題的開場引導
    }

    [Fact]
    public void Compose_有主題與到期單字與前次摘要_皆注入()
    {
        var prompt = CoachPromptAssembler.Compose(
            topic: "travel english",
            dueWords: new[] { "resilient", "ubiquitous" },
            previousSummary: "上次練習了機場對話。");

        prompt.Should().Contain("travel english");
        prompt.Should().Contain("resilient");
        prompt.Should().Contain("ubiquitous");
        prompt.Should().Contain("上次練習了機場對話。");
    }

    [Fact]
    public void Compose_前次摘要超長_截斷到上限()
    {
        var longSummary = new string('x', CoachPromptAssembler.MaxSummaryChars + 500);

        var prompt = CoachPromptAssembler.Compose(topic: null, dueWords: Array.Empty<string>(), previousSummary: longSummary);

        // 不應原封不動含超長字串（被裁到上限）。
        prompt.Should().NotContain(longSummary);
        prompt.Should().Contain(new string('x', CoachPromptAssembler.MaxSummaryChars));
    }

    [Fact]
    public void Compose_主題超長_截斷到上限()
    {
        var longTopic = new string('t', CoachPromptAssembler.MaxTopicChars + 100);

        var prompt = CoachPromptAssembler.Compose(topic: longTopic, dueWords: Array.Empty<string>(), previousSummary: null);

        prompt.Should().NotContain(longTopic);
    }
}
