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
    public void RenderToHtml_UnclosedOuterToggle_StillNestsChildren()
    {
        // 「疑問」未閉合（EOF 前少了收尾 :::），內含兩個子 toggle。
        // 前端 parseToggleSegments 容忍未閉合、會把子項巢狀進「疑問」；後端渲染也應一致
        // （不可因圍欄不平衡就整個放棄正規化 → 否則 Markdig 同長度會把子項變成兄弟）。
        var markdown =
            ":::toggle 金句\n金句\n:::\n" +
            ":::toggle 疑問\n" +
            ":::toggle 2. A\na\n:::\n" +
            ":::toggle 3. B\nb\n:::"; // 「疑問」沒有收尾 :::
        var html = NoteContentHelpers.RenderToHtml(markdown);

        System.Text.RegularExpressions.Regex.Matches(html, "<details").Count.Should().Be(4);
        var pos3 = html.IndexOf("3. B</summary>", System.StringComparison.Ordinal);
        pos3.Should().BeGreaterThan(0);
        // 3.B 的 </summary> 之後應還有 2 個 </details>（3.B 自己 + 外層「疑問」）→ 證明子項巢狀於「疑問」內。
        System.Text.RegularExpressions.Regex.Matches(html[pos3..], "</details>")
            .Count.Should().Be(2, "未閉合的『疑問』仍應把子項巢狀在內（與前端預覽一致）");
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

    // ---------------------------------------------------------------------
    // 需求1：表格格子（與一般段落）內以字面 <br> 家族換行。
    // 白名單只認 <br> / <br/> / <br />（大小寫不敏感、標籤內允許空白），
    // 轉成硬換行（<br />）；其餘任何 HTML 標籤一律維持轉義（維持 DisableHtml 的零注入面）。
    // ---------------------------------------------------------------------

    [Fact]
    public void TableCell_WithLiteralBr_RendersHardLineBreak()
    {
        // Arrange：GFM pipe table，格內用 <br> 換行（GitHub 通用逃生口）。
        var markdown =
            "| 欄位 | 說明 |\n" +
            "| --- | --- |\n" +
            "| 第一行<br>第二行 | x |\n";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：格內 <br> 應轉成硬換行 <br />，不得殘留字面 &lt;br&gt;。
        html.Should().Contain("<br />");
        html.Should().NotContain("&lt;br&gt;");
        // 換行落在同一個表格格內（<td> … </td> 之間），而非把儲存格拆成兩列。
        html.Should().Contain("第一行<br />");
        html.Should().Contain("第二行");
        html.Should().Contain("<td>").And.Contain("</td>");
    }

    [Theory]
    [InlineData("<br>")]
    [InlineData("<br/>")]
    [InlineData("<br />")]
    [InlineData("<BR>")]
    [InlineData("<br >")]
    [InlineData("<br  />")]
    public void BrVariants_AllRenderHardLineBreak(string brToken)
    {
        // Arrange：一般段落內的各種 <br> 變體（大小寫、有無斜線、標籤內空白）皆應生效。
        var markdown = $"第一行{brToken}第二行";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert
        html.Should().Contain("<br />");
        html.Should().NotContain("&lt;br");
    }

    [Fact]
    public void Paragraph_WithLiteralBr_RendersHardLineBreak()
    {
        // Arrange：一般段落內的 <br> 也應轉硬換行（與表格格內行為一致）。
        var markdown = "第一段落<br>接續同段落";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert
        html.Should().Contain("第一段落<br />");
        html.Should().Contain("接續同段落");
        html.Should().NotContain("&lt;br&gt;");
    }

    [Fact]
    public void InlineCode_WithBr_KeepsLiteralNotConverted()
    {
        // Arrange：inline code 內的 <br> 必須維持字面（不可被當成硬換行）。
        var markdown = "這是程式碼 `<br>` 標籤";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：inline code 內容轉義成 &lt;br&gt;，且不得產生 <br />。
        html.Should().Contain("<code>&lt;br&gt;</code>");
        html.Should().NotContain("<br />");
    }

    [Fact]
    public void FencedCodeBlock_WithBr_KeepsLiteralNotConverted()
    {
        // Arrange：程式碼區塊內的 <br> 也必須維持字面。
        var markdown = "```\n<br>\n```";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert
        html.Should().Contain("&lt;br&gt;");
        html.Should().NotContain("<br />");
    }

    [Theory]
    [InlineData("<script>alert(1)</script>", "&lt;script&gt;")]
    [InlineData("<div>x</div>", "&lt;div&gt;")]
    [InlineData("<b>粗</b>", "&lt;b&gt;")]
    [InlineData("<brs>", "&lt;brs&gt;")]
    [InlineData("<br x>", "&lt;br x&gt;")]
    public void NonWhitelistedTags_StillEscaped_ProvesNoRawHtmlOpened(
        string tagInput,
        string expectedEscaped)
    {
        // Arrange：非白名單標籤（含近似 <br> 但不合法的 <brs>/<br x>）一律維持轉義。
        var markdown = $"前綴 {tagInput} 後綴";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：應轉義輸出，且完全不得產生硬換行（證明只開放 <br> 家族、沒開放其他標籤）。
        html.Should().Contain(expectedEscaped);
        html.Should().NotContain("<br />");
    }

    [Fact]
    public void Autolink_StillWorks_ParserInsertedAtFrontDoesNotBreakAngleBracketLinks()
    {
        // 迴歸守門：<br> parser 被插到 InlineParsers[0]、搶在其他 '<' 家族解析器（含 autolink）之前，
        // 必須確認合法 autolink（<https://...>）在改動後仍正常轉成 <a>，沒有被誤吃或擋掉。
        var markdown = "請看 <https://example.com>";

        var html = NoteContentHelpers.RenderToHtml(markdown);

        html.Should().Contain("<a href=\"https://example.com\"");
        html.Should().Contain(">https://example.com</a>");
    }

    [Fact]
    public void DanglingBr_WithoutClosingBracket_NoException_KeepsLiteral()
    {
        // 邊界安全：懸空 <br（無收尾 '>'，延伸到行尾）不得拋例外，且退化為字面（不觸發硬換行）。
        var markdown = "前綴 <br 後面還有文字";

        var html = NoteContentHelpers.RenderToHtml(markdown);

        html.Should().NotContain("<br />");
        html.Should().Contain("&lt;br");
    }

    [Fact]
    public void ConsecutiveBr_BothRenderHardLineBreak()
    {
        // 連續 <br><br> 應各自轉成硬換行（兩個 <br />），彼此不互相干擾。
        var markdown = "一<br><br>二";

        var html = NoteContentHelpers.RenderToHtml(markdown);

        System.Text.RegularExpressions.Regex.Matches(html, "<br />").Count.Should().Be(2);
        html.Should().NotContain("&lt;br");
    }

    // ---------------------------------------------------------------------
    // 查看模式就地改程式碼區塊 metadata：後端給每個「圍欄程式碼區塊」標 data-fence-line＝
    // 其在原文的來源起始行號（1 起算），供前端直接定位並改寫該行圍欄；縮排程式碼區塊不標。
    // ---------------------------------------------------------------------

    [Fact]
    public void FencedCodeBlocks_GetSourceLineNumber()
    {
        // Arrange：兩個圍欄程式碼區塊（js 在第 1 行、py 在第 5 行）。
        var markdown = "```js\na();\n```\n\n```py\nb();\n```";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：各標其來源行號（1 起算），共兩個。
        html.Should().Contain("data-fence-line=\"1\"");
        html.Should().Contain("data-fence-line=\"5\"");
        System.Text.RegularExpressions.Regex.Matches(html, "data-fence-line=").Count.Should().Be(2);
    }

    [Fact]
    public void DataFenceLine_SkipsListIndentedContinuation_C1Regression()
    {
        // C1 迴歸守門：清單項下縮排 4 空白的續行段落是「普通段落」（不是縮排程式碼區塊），
        // 不得被當成圍欄；兩個真正的圍欄在第 5、9 行。
        var markdown = string.Join("\n",
            "- point", "", "    continuation paragraph indented 4 spaces", "",
            "```a", "AAA", "```", "", "```b", "BBB", "```");

        var html = NoteContentHelpers.RenderToHtml(markdown);

        html.Should().Contain("continuation paragraph");
        System.Text.RegularExpressions.Regex.Matches(html, "data-fence-line=").Count.Should().Be(2);
        html.Should().Contain("data-fence-line=\"5\"");
        html.Should().Contain("data-fence-line=\"9\"");
    }

    [Fact]
    public void DataFenceLine_SkipsTopLevelIndentedFenceLiteral_High1Regression()
    {
        // HIGH-1 迴歸守門：頂層縮排 4 空白的字面 ```bash 是「縮排程式碼區塊」（CommonMark），
        // 不是圍欄、不標行號；只有真正的圍欄 py（第 7 行）被標。這正是前端逐行正則會誤判、
        // 而後端 Markdig 正確判定之處——查看模式據此定位才不會改到縮排展示區塊。
        var markdown = string.Join("\n",
            "段落", "", "    ```bash", "    echo", "    ```", "", "```py", "print", "```");

        var html = NoteContentHelpers.RenderToHtml(markdown);

        System.Text.RegularExpressions.Regex.Matches(html, "data-fence-line=").Count.Should().Be(1);
        html.Should().Contain("data-fence-line=\"7\"");
    }

    [Fact]
    public void IndentedCodeBlock_GetsNoDataFenceLine()
    {
        // 真正的縮排程式碼區塊不是 FencedCodeBlock → 不標 data-fence-line；只有圍欄 js（第 5 行）被標。
        var markdown = "para\n\n    indented_code()\n\n```js\nx\n```";

        var html = NoteContentHelpers.RenderToHtml(markdown);

        System.Text.RegularExpressions.Regex.Matches(html, "data-fence-line=").Count.Should().Be(1);
        html.Should().Contain("data-fence-line=\"5\"");
    }
}
