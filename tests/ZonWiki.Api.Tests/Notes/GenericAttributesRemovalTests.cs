using FluentAssertions;
using Xunit;
using ZonWiki.Api.Notes;

namespace ZonWiki.Api.Tests.Notes;

/// <summary>
/// GenericAttributes 擴充移除的回歸測試（互動表格設計 v2 修訂第 1、2 條）。
///
/// 背景：<c>UseAdvancedExtensions()</c> 內含 GenericAttributesExtension，會把 Markdown 中的
/// <c>{…}</c> 當「屬性語法」吃掉並套到鄰近元素上——實測有兩個問題：
/// 1. 表頭控件尾碼 <c>{checkbox}</c>／<c>{radio:…}</c> 會被吃掉、套成 &lt;table&gt; 的屬性，
///    表頭尾碼語法無法成立（編輯預覽的 remark-gfm 本來就不解析 <c>{…}</c>，兩路徑不一致）。
/// 2. 【安全】<c>{onclick=alert(1)}</c> 會被渲染成真的 onclick 屬性——DisableHtml() 擋不住
///    屬性語法，構成 stored XSS。
///
/// 移除後 <c>{…}</c> 一律以「字面文字」存活，本測試類把此行為鎖住（回歸鎖）。
/// 一律直接測正式渲染入口 <see cref="NoteContentHelpers.RenderToHtml"/>，確保與線上行為一致。
/// </summary>
public sealed class GenericAttributesRemovalTests
{
    [Fact]
    public void TableHeader_CheckboxSuffix_SurvivesAsLiteralText()
    {
        // Arrange：表頭帶 {checkbox} 控件尾碼的 GFM 表格。
        var markdown = "| 已讀{checkbox} | 備註 |\n|---|---|\n| [x] | ok |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：th 內保留字面 {checkbox}（供前端讀模式解析控件欄）。
        html.Should().Contain("已讀{checkbox}");
        // Assert：<table> 不得被套上名為 checkbox 的屬性（GenericAttributes 移除前的錯誤行為）。
        html.Should().NotMatchRegex("<table[^>]*checkbox");
        // Assert：仍是正常的 GFM 表格（pipe table 擴充不受移除影響）。
        html.Should().Contain("<table");
        html.Should().Contain("<th");
    }

    [Fact]
    public void TableHeader_OnclickAttributeSyntax_IsNotRenderedAsAttribute()
    {
        // Arrange：夾帶事件屬性語法的表頭（stored XSS 攻擊樣本）。
        var markdown = "| A{onclick=alert(1)} | B |\n|---|---|\n| 1 | 2 |";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert【XSS 鎖】：任何標籤內都不得出現 onclick「屬性」。
        // （不能斷言 NotContain("onclick")——移除後攻擊字串會以「字面文字」存活在 th 內文中，
        //   該文字本來就含 "onclick" 子字串；安全性質是「不得成為屬性」，故用「標籤內」正則。）
        html.Should().NotMatchRegex("<[^>]*onclick");
        // Assert：攻擊字串以字面文字存活（不被解析、也不消失）。
        html.Should().Contain("A{onclick=alert(1)}");
    }

    [Fact]
    public void Heading_ClassAttributeSyntax_IsNotApplied()
    {
        // Arrange：標題帶 {.class} 屬性語法（用純 ASCII 標題，避免 AutoIdentifier 產生的
        // id 前綴干擾斷言）。
        var markdown = "# Title {.special-class}";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：不得產生 class 屬性；{.special-class} 以字面文字存活。
        html.Should().NotContain("class=\"special-class\"");
        html.Should().Contain("{.special-class}");
    }

    [Fact]
    public void Heading_IdAttributeSyntax_IsNotApplied()
    {
        // Arrange：標題帶 {#id} 屬性語法。
        var markdown = "# Title {#custom-id}";

        // Act
        var html = NoteContentHelpers.RenderToHtml(markdown);

        // Assert：不得把 custom-id 套成元素 id（AutoIdentifier 自動 id 會帶 title- 前綴，
        // 不會恰好等於 "custom-id"，此斷言不受其影響）；{#custom-id} 以字面文字存活。
        html.Should().NotContain("id=\"custom-id\"");
        html.Should().Contain("{#custom-id}");
    }
}
