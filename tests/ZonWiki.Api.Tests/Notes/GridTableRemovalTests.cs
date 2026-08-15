using FluentAssertions;
using Xunit;
using ZonWiki.Api.Notes;

namespace ZonWiki.Api.Tests.Notes;

/// <summary>
/// GridTable 擴充移除的回歸測試（對抗式復審 HIGH-2）。
///
/// 背景：<c>UseAdvancedExtensions()</c> 除了 pipe table 還內含 GridTableExtension
/// （<c>+---+</c> 圍線語法）。Grid table 的「一列」可跨多個原始行，
/// 「列行號＋欄索引 → 改寫 ContentRaw 儲存格」的前端互動座標系對它不成立——
/// 若讓它渲染成 &lt;table&gt;，AST 後處理會照樣標上 data-md-table / data-md-line，
/// 前端據此直編就會改到錯誤的行（跨行資料損毀）。且編輯預覽（remark-gfm）本來就不支援
/// grid table，兩條渲染路徑不一致。故與 GenericAttributes 同手法自管線移除，
/// grid table 語法退回字面文字（段落），本測試把此行為鎖住。
/// </summary>
public sealed class GridTableRemovalTests
{
    [Fact]
    public void GridTableSyntax_DoesNotRenderAsTable()
    {
        // Arrange：Markdig grid table 語法（+---+ 圍線＋ +===+ 表頭分隔）。
        var markdown =
            "+---------+---------+\n" +
            "| 表頭A   | 表頭B   |\n" +
            "+=========+=========+\n" +
            "| 內容1   | 內容2   |\n" +
            "+---------+---------+";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：不得渲染成表格（退回字面文字/段落），自然也不得帶表格互動標記。
        html.Should().NotContain("<table");
        html.Should().NotContain("data-md-table");
        html.Should().NotContain("data-md-line");
        // Assert：內容不消失（以字面文字存活，供使用者自行改寫成 pipe table）。
        html.Should().Contain("表頭A");
        html.Should().Contain("內容1");
    }

    [Fact]
    public void PipeTable_StillRendersNormally_AfterGridTableRemoval()
    {
        // Arrange：GFM pipe table（本站唯一支援的表格語法）。
        var markdown = "| A | B |\n|---|---|\n| 1 | 2 |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：pipe table 擴充不受 grid table 移除影響。
        html.Should().Contain("<table");
        html.Should().Contain("data-md-table=\"1\"");
    }
}
