using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;
using ZonWiki.Api.Notes;

namespace ZonWiki.Api.Tests.Notes;

/// <summary>
/// 表格列行號的後端權威行號測試（互動表格設計 v2 修訂第 13 條、§2）。
///
/// 設計：照 data-fence-line 先例，於 <see cref="NoteContentHelpers.RenderToHtml"/> parse 後的
/// AST 後處理迴圈，對每個 pipe table 的 &lt;table&gt; 標 <c>data-md-table="1"</c>、
/// 每個 &lt;tr&gt; 標 <c>data-md-line="(TableRow.Line + 1)"</c>（1 起算，對應 ContentRaw 原始行號）。
/// 前端讀模式互動（勾選/直編）以「列行號＋欄索引」定位 ContentRaw 儲存格——行號錯＝改到別行，
/// 屬跨列資料損毀等級，故以本測試逐案鎖住行號正確性。
/// </summary>
public sealed class TableLineNumberTests
{
    /// <summary>
    /// 從渲染後 HTML 依序取出所有 &lt;tr&gt; 的 data-md-line 值（字串形式、依出現順序）。
    /// </summary>
    /// <param name="html">渲染後 HTML。</param>
    /// <returns>data-md-line 值清單。</returns>
    private static List<string> ExtractRowLines(string html) =>
        Regex.Matches(html, "<tr[^>]*data-md-line=\"(\\d+)\"")
            .Select(m => m.Groups[1].Value)
            .ToList();

    [Fact]
    public void TopLevelSimpleTable_RowsCarryOriginalLineNumbers()
    {
        // Arrange：頂層簡單表——表頭列在第 1 行、分隔線第 2 行（非資料列）、資料列第 3、4 行。
        var markdown = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：table 帶可增強標記；每個 tr 的行號對回原文（1 起算）。
        html.Should().Contain("data-md-table=\"1\"");
        ExtractRowLines(html).Should().Equal("1", "3", "4");
        // Assert：所有 tr 都帶行號（沒有漏標的列）。
        Regex.Matches(html, "<tr").Count.Should().Be(3);
    }

    [Fact]
    public void TableAfterPrecedingContent_RowsCarryOriginalLineNumbers()
    {
        // Arrange：表前有標題與段落——表頭列落在第 5 行、資料列第 7 行。
        var markdown = "# 標題\n\n段落一。\n\n| A | B |\n|---|---|\n| 1 | 2 |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert
        html.Should().Contain("data-md-table=\"1\"");
        ExtractRowLines(html).Should().Equal("5", "7");
    }

    [Fact]
    public void TableInsideToggleContainer_RowsCarryOriginalLineNumbers()
    {
        // Arrange：表格在 :::toggle 容器內——表頭列第 2 行、資料列第 4 行。
        // （RenderToHtml 的 NormalizeToggleFences 只改冒號數、不增減行，行號仍對回原始 contentRaw。）
        var markdown = ":::toggle 收合標題\n| A | B |\n|---|---|\n| 1 | 2 |\n:::";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：容器內的表格一樣被標記且行號正確。
        html.Should().Contain("<details");
        html.Should().Contain("data-md-table=\"1\"");
        ExtractRowLines(html).Should().Equal("2", "4");
    }

    [Fact]
    public void CrlfSource_RowsCarryOriginalLineNumbers()
    {
        // Arrange：CRLF 行尾的原文（Windows 端儲存的筆記）——行號計算不得受 \r 影響。
        var markdown = "| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n| 3 | 4 |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert
        html.Should().Contain("data-md-table=\"1\"");
        ExtractRowLines(html).Should().Equal("1", "3", "4");
    }

    [Fact]
    public void NonTableContent_OutputHasNoTableMarkers()
    {
        // Arrange：無表格的內容（標題/段落/程式碼圍欄）。
        var markdown = "# 標題\n\n內文段落。\n\n```csharp\nvar x = 1;\n```";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：不得摻入表格專用標記；既有 data-fence-line 行為不變（圍欄起始行第 5 行）。
        html.Should().NotContain("data-md-table");
        html.Should().NotContain("data-md-line");
        html.Should().Contain("data-fence-line=\"5\"");
    }
}
