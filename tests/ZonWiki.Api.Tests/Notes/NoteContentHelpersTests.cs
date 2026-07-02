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
    public void RenderToHtml_SiblingTogglesInsideOuter_NestsUnderParent()
    {
        // 外層「省」內含兩個兄弟 toggle（通用、91APP）——同長度 ::: 寫法。
        // 直接用 Markdig 會把「省」在「通用」後就關掉、91APP 變成兄弟；
        // RenderToHtml 會先正規化冒號，讓 91APP 正確巢狀在「省」內（與前端編輯預覽一致）。
        var markdown =
            ":::toggle 省\n省內文\n" +
            ":::toggle 通用\n通用內文\n:::\n" +
            ":::toggle 91APP\n91內文\n:::\n" +
            ":::";
        var html = NoteContentHelpers.RenderToHtml(markdown);

        System.Text.RegularExpressions.Regex.Matches(html, "<details").Count.Should().Be(3);
        var pos91 = html.IndexOf("91APP</summary>", System.StringComparison.Ordinal);
        pos91.Should().BeGreaterThan(0);
        // 91APP 的 </summary> 之後應還有「2 個」</details>（91APP 自己 + 外層「省」）→ 證明 91APP 在省內。
        System.Text.RegularExpressions.Regex.Matches(html[pos91..], "</details>")
            .Count.Should().Be(2, "外層「省」的 </details> 應在 91APP 之後（91APP 巢狀於省內）");
    }

    [Fact]
    public void NormalizeToggleFences_TopLevelSiblingsNoNesting_ReturnsUnchanged()
    {
        // 頂層兄弟 toggle、無巢狀 → Markdig 本來就對，正規化不應改動原文。
        var md = "# 標題\n:::toggle A\n內容\n:::\n一般段落。\n:::toggle B\n內容\n:::";
        NoteContentHelpers.NormalizeToggleFences(md).Should().Be(md);
    }

    [Fact]
    public void NormalizeToggleFences_IgnoresColonsInsideCodeFence()
    {
        // 程式碼區塊內的 ::: 不可被當成容器（否則會誤判巢狀、破壞內容）。
        var md = "```\n:::toggle 這是程式碼不是容器\n:::\n```\n正常段落。";
        NoteContentHelpers.NormalizeToggleFences(md).Should().Be(md);
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
