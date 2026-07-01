using FluentAssertions;
using Markdig;
using Xunit;
using ZonWiki.Api.Notes;

namespace ZonWiki.Api.Tests.Notes;

/// <summary>
/// 筆記 Markdown 管線單元測試（聚焦「摺疊區塊 toggle」擴充）。
/// 直接測試正式管線 <see cref="NoteContentHelpers.MarkdownPipeline"/>，確保線上行為一致。
/// </summary>
public sealed class NoteContentHelpersTests
{
    /// <summary>以正式管線把 Markdown 轉成 HTML。</summary>
    private static string ToHtml(string markdown) =>
        Markdown.ToHtml(markdown, NoteContentHelpers.MarkdownPipeline);

    [Fact]
    public void Toggle_RendersNativeDetails_CollapsedByDefault()
    {
        // Arrange
        var markdown = ":::toggle 我的標題\n內文\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("<details class=\"md-toggle\">");
        html.Should().Contain("<summary class=\"md-toggle-summary\">我的標題</summary>");
        html.Should().Contain("</details>");
        // 預設收合：不應帶 open 屬性。
        html.Should().NotContain("<details class=\"md-toggle\" open");
    }

    [Fact]
    public void ToggleOpen_RendersDetails_WithOpenAttribute()
    {
        // Arrange
        var markdown = ":::toggle-open 預設展開\n內文\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("<details class=\"md-toggle\" open>");
        html.Should().Contain("<summary class=\"md-toggle-summary\">預設展開</summary>");
    }

    [Fact]
    public void Toggle_WithoutTitle_UsesDefaultSummary()
    {
        // Arrange
        var markdown = ":::toggle\n只有內容\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("<summary class=\"md-toggle-summary\">詳細內容</summary>");
    }

    [Fact]
    public void Toggle_RendersInnerMarkdown()
    {
        // Arrange
        var markdown = ":::toggle 標題\n內文 **粗體** 與清單：\n\n- a\n- b\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert：內文 Markdown 應被正常渲染（粗體、清單）。
        html.Should().Contain("<strong>粗體</strong>");
        html.Should().Contain("<li>a</li>");
        html.Should().Contain("md-toggle-body");
    }

    [Fact]
    public void Toggle_EscapesTitle_NoXss()
    {
        // Arrange：標題夾帶 script，應被 HTML 轉義、不得原樣輸出。
        var markdown = ":::toggle <script>alert(1)</script>\n內文\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("&lt;script&gt;alert(1)&lt;/script&gt;");
        html.Should().NotContain("<script>alert(1)</script>");
    }

    [Fact]
    public void NestedToggles_RenderCorrectly_NoTrailingEmptyDiv()
    {
        // Arrange：同長度 ::: 的巢狀 toggle（外層含內層）。
        var markdown = ":::toggle 外層\n外層內文\n\n:::toggle 內層\n內層內文\n:::\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert：兩個 details 正確巢狀，且不得殘留空的 <div></div>。
        System.Text.RegularExpressions.Regex
            .Matches(html, "<details class=\"md-toggle\">")
            .Count.Should().Be(2);
        html.Should().Contain("<summary class=\"md-toggle-summary\">外層</summary>");
        html.Should().Contain("<summary class=\"md-toggle-summary\">內層</summary>");
        html.Should().NotContain("<div></div>");
    }

    [Fact]
    public void NestedToggles_ThreeLevels_RenderCorrectly()
    {
        // Arrange：H1>H2>H3 三層同長度 ::: 巢狀（對應「每個標題各自包一個 toggle」的排版慣例）。
        var markdown =
            ":::toggle H1 標題\nH1 導言\n\n" +
            ":::toggle H2 標題\nH2 內文\n\n" +
            ":::toggle H3 標題\nH3 內文\n" +
            ":::\n:::\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert：三個 details 皆正確渲染、三個標題都在、且不得殘留空的 <div></div>。
        System.Text.RegularExpressions.Regex
            .Matches(html, "<details class=\"md-toggle\">")
            .Count.Should().Be(3);
        html.Should().Contain("<summary class=\"md-toggle-summary\">H1 標題</summary>");
        html.Should().Contain("<summary class=\"md-toggle-summary\">H2 標題</summary>");
        html.Should().Contain("<summary class=\"md-toggle-summary\">H3 標題</summary>");
        html.Should().NotContain("<div></div>");
    }

    [Fact]
    public void NonToggleContainer_KeepsDefaultDivBehavior()
    {
        // Arrange：非 toggle 的自訂容器，應維持 Markdig 預設 <div class="…">。
        var markdown = ":::warning\n注意\n:::";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("<div class=\"warning\">");
        html.Should().NotContain("<details");
    }

    [Fact]
    public void RawHtmlDetails_IsStillDisabled_NotPassedThrough()
    {
        // Arrange：直接寫 raw <details> 仍應被當文字轉義（管線維持 DisableHtml）。
        var markdown = "<details><summary>X</summary>\n\nbody\n\n</details>";

        // Act
        var html = ToHtml(markdown);

        // Assert
        html.Should().Contain("&lt;details&gt;");
        html.Should().NotContain("<details><summary>X</summary>");
    }
}
