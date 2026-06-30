using Markdig;
using Markdig.Extensions.CustomContainers;
using Markdig.Renderers;
using Markdig.Renderers.Html;

namespace ZonWiki.Api.Notes;

/// <summary>
/// 「摺疊區塊（Notion 式 toggle）」的 Markdig 擴充。
///
/// 設計重點：
/// - 沿用 Markdig 內建的自訂容器（custom container）語法 <c>:::</c>，不另寫區塊解析器：
///     <code>
///     :::toggle 我的標題
///     內文（可含任意 Markdown）
///     :::
///     </code>
///   會渲染成原生的 <c>&lt;details&gt;&lt;summary&gt;…&lt;/summary&gt;…&lt;/details&gt;</c>，
///   瀏覽器即可原生摺疊／展開，<b>完全不需 JavaScript</b>。
/// - <c>:::toggle-open</c> 代表「預設展開」（輸出帶 <c>open</c> 屬性）。
/// - 安全性：本擴充只「替換自訂容器的 HTML 輸出器」，並未開啟 raw HTML（管線仍 DisableHtml），
///   標題以 <see cref="HtmlRenderer.WriteEscape(string)"/> 做 HTML 轉義，故無 XSS 風險；
///   內文沿用 Markdig 既有的安全渲染。
/// - 非 toggle 的容器（如 <c>:::warning</c>）維持 Markdig 預設行為（輸出 <c>&lt;div class="warning"&gt;</c>）。
/// </summary>
public sealed class ToggleContainerExtension : IMarkdownExtension
{
    /// <summary>
    /// 解析期不需額外設定（沿用內建自訂容器解析器）。
    /// </summary>
    /// <param name="pipeline">Markdown 管線建構器。</param>
    public void Setup(MarkdownPipelineBuilder pipeline)
    {
        // 解析語法沿用 UseAdvancedExtensions() 內含的 CustomContainer 解析器，無需在此註冊。
    }

    /// <summary>
    /// 渲染期：移除自訂容器的預設 HTML 輸出器，改用本擴充的
    /// <see cref="ToggleContainerRenderer"/>（toggle → details；其餘 → 維持預設 div）。
    /// </summary>
    /// <param name="pipeline">已建立的 Markdown 管線。</param>
    /// <param name="renderer">Markdown 渲染器（僅處理 HTML 渲染器）。</param>
    public void Setup(MarkdownPipeline pipeline, IMarkdownRenderer renderer)
    {
        if (renderer is not HtmlRenderer htmlRenderer)
        {
            return;
        }

        // 找出並移除 Markdig 內建的自訂容器輸出器，換上本擴充的版本。
        var defaultRenderer = htmlRenderer.ObjectRenderers.FindExact<HtmlCustomContainerRenderer>();
        if (defaultRenderer is not null)
        {
            htmlRenderer.ObjectRenderers.Remove(defaultRenderer);
        }

        htmlRenderer.ObjectRenderers.AddIfNotAlready(new ToggleContainerRenderer());
    }
}

/// <summary>
/// 自訂容器的 HTML 輸出器：把 <c>:::toggle</c> / <c>:::toggle-open</c> 渲染成原生
/// <c>&lt;details&gt;</c>；其餘容器則維持 Markdig 預設的 <c>&lt;div class="…"&gt;</c> 行為。
/// </summary>
internal sealed class ToggleContainerRenderer : HtmlObjectRenderer<CustomContainer>
{
    /// <summary>容器名稱：摺疊（預設收合）。</summary>
    private const string ToggleInfo = "toggle";

    /// <summary>容器名稱：摺疊（預設展開）。</summary>
    private const string ToggleOpenInfo = "toggle-open";

    /// <summary>標題為空時的預設摘要文字。</summary>
    private const string DefaultSummary = "詳細內容";

    /// <summary>
    /// 輸出單一自訂容器。
    /// </summary>
    /// <param name="renderer">HTML 渲染器。</param>
    /// <param name="container">待輸出的自訂容器區塊。</param>
    protected override void Write(HtmlRenderer renderer, CustomContainer container)
    {
        var info = container.Info ?? string.Empty;
        var isCollapsed = info.Equals(ToggleInfo, StringComparison.OrdinalIgnoreCase);
        var isExpanded = info.Equals(ToggleOpenInfo, StringComparison.OrdinalIgnoreCase);

        if (!isCollapsed && !isExpanded)
        {
            // 非 toggle 容器：維持 Markdig 預設行為（<div class="info">…children…</div>）。
            WriteDefaultDiv(renderer, container);
            return;
        }

        // 標題取自容器參數（::: 後第一個字之後的整行文字）；空白則用預設摘要。
        var title = (container.Arguments ?? string.Empty).Trim();
        if (title.Length == 0)
        {
            title = DefaultSummary;
        }

        renderer.EnsureLine();
        renderer.Write("<details class=\"md-toggle\"");
        if (isExpanded)
        {
            renderer.Write(" open");
        }
        renderer.Write("><summary class=\"md-toggle-summary\">");
        // 標題以純文字轉義輸出（避免 XSS）。
        renderer.WriteEscape(title);
        renderer.Write("</summary>\n<div class=\"md-toggle-body\">\n");
        renderer.WriteChildren(container);
        renderer.WriteLine("</div>\n</details>");
    }

    /// <summary>
    /// 維持 Markdig 對自訂容器的預設輸出（<c>&lt;div&gt;</c> 包子節點，class 來自容器屬性）。
    /// </summary>
    /// <param name="renderer">HTML 渲染器。</param>
    /// <param name="container">自訂容器區塊。</param>
    private static void WriteDefaultDiv(HtmlRenderer renderer, CustomContainer container)
    {
        // 略過「無名稱且無內容」的空容器：同長度的巢狀 ::: 收尾時，Markdig 會多吐一個
        // 空的、無 class 的容器（<div></div>），對應使用者輸入沒有任何意義，直接不輸出。
        if (container.Count == 0 && string.IsNullOrWhiteSpace(container.Info))
        {
            return;
        }

        renderer.EnsureLine();
        if (renderer.EnableHtmlForBlock)
        {
            renderer.Write("<div").WriteAttributes(container).Write('>');
        }

        renderer.WriteChildren(container);

        if (renderer.EnableHtmlForBlock)
        {
            renderer.WriteLine("</div>");
        }
    }
}

/// <summary>
/// 摺疊區塊擴充的管線註冊輔助方法。
/// </summary>
public static class ToggleContainerPipelineExtensions
{
    /// <summary>
    /// 在管線中啟用「摺疊區塊（Notion 式 toggle）」。
    /// 須在 <c>UseAdvancedExtensions()</c> 之後呼叫，才能正確替換自訂容器的輸出器。
    /// </summary>
    /// <param name="builder">Markdown 管線建構器。</param>
    /// <returns>同一個建構器（供鏈式呼叫）。</returns>
    public static MarkdownPipelineBuilder UseZonWikiToggles(this MarkdownPipelineBuilder builder)
    {
        builder.Extensions.AddIfNotAlready(new ToggleContainerExtension());
        return builder;
    }
}
