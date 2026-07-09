using Markdig;
using Markdig.Helpers;
using Markdig.Parsers;
using Markdig.Renderers;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace ZonWiki.Api.Notes;

/// <summary>
/// 「字面 <c>&lt;br&gt;</c> 換行」的 Markdig 擴充（白名單式，維持 DisableHtml 的零注入面）。
///
/// 背景：筆記管線刻意 <c>DisableHtml()</c> 防 XSS，因此表格格子（GFM pipe table 一列一行、
/// 格內天生無法按 Enter 換行）想換行時所寫的 <c>&lt;br&gt;</c> 會被整包轉義成字面
/// <c>&amp;lt;br&amp;gt;</c>，畫面顯示成文字而非換行。
///
/// 本擴充只認得三種確切形狀的換行標籤：<c>&lt;br&gt;</c>、<c>&lt;br/&gt;</c>、<c>&lt;br /&gt;</c>
/// （大小寫不敏感、允許標籤內含空白／Tab），命中就產生一個固定常數 <c>&lt;br /&gt;</c> 的
/// <see cref="HtmlInline"/>；其餘任何 HTML 標籤（<c>&lt;div&gt;</c>、<c>&lt;script&gt;</c>、甚至
/// 近似但不合法的 <c>&lt;brs&gt;</c>／<c>&lt;br x&gt;</c>）一律不處理、維持既有轉義行為，故不擴大注入面。
///
/// 為何用 <see cref="HtmlInline"/> 而非 <see cref="LineBreakInline"/>：實測 Markdig 的 pipe table
/// 會把「表格列裡的換行節點」當成『列分隔』而毀掉儲存格內容（本功能主場景正是表格格內換行）；
/// 不透明的 <see cref="HtmlInline"/> 不會觸發列切割，段落與表格格內皆能正確渲染成 <c>&lt;br /&gt;</c>。
///
/// 安全性：本擴充「只新增一個只吃 <c>&lt;br&gt;</c> 家族的 inline 解析器」，未開啟 raw HTML
/// （管線仍 DisableHtml）；輸出的 <see cref="HtmlInline"/> 標籤是硬編碼常數、永不含使用者輸入。
/// inline code 與程式碼區塊內的 <c>&lt;br&gt;</c> 由 Markdig 更高優先權的程式碼解析器先行接手
/// （其內容不會走一般 inline 解析），故天然維持字面、不被轉換。
/// </summary>
public sealed class HtmlLineBreakInlineExtension : IMarkdownExtension
{
    /// <summary>
    /// 解析期：把本擴充的 <see cref="HtmlLineBreakInlineParser"/> 插到 inline 解析器清單最前面，
    /// 確保在遇到 <c>'&lt;'</c> 時先於自動連結（autolink）等其他 <c>'&lt;'</c> 解析器嘗試比對。
    /// 不匹配時解析器會 return false，讓 <c>'&lt;'</c> 照原本的流程（autolink → 最終字面）處理。
    /// </summary>
    /// <param name="pipeline">Markdown 管線建構器。</param>
    public void Setup(MarkdownPipelineBuilder pipeline)
    {
        // 冪等：避免同一擴充被重複註冊時插入多個解析器。
        if (pipeline.InlineParsers.Find<HtmlLineBreakInlineParser>() is null)
        {
            pipeline.InlineParsers.Insert(0, new HtmlLineBreakInlineParser());
        }
    }

    /// <summary>
    /// 渲染期：無需自訂輸出器。本擴充產生的 <see cref="HtmlInline"/>（固定常數 <c>&lt;br /&gt;</c>）
    /// 由 Markdig 內建的 HtmlInline 輸出器直接寫出該標籤字串。
    /// </summary>
    /// <param name="pipeline">已建立的 Markdown 管線。</param>
    /// <param name="renderer">Markdown 渲染器（本擴充不介入）。</param>
    public void Setup(MarkdownPipeline pipeline, IMarkdownRenderer renderer)
    {
        // 不需要動渲染器：<br /> 的 HTML 輸出沿用 Markdig 內建的 HtmlInline 輸出器。
    }
}

/// <summary>
/// 只比對字面 <c>&lt;br&gt;</c> 家族並轉成硬換行的 inline 解析器。
///
/// 接受的形狀（皆大小寫不敏感、<c>br</c> 之後與 <c>/</c> 前後允許空白／Tab）：
/// <list type="bullet">
///   <item><description><c>&lt;br&gt;</c></description></item>
///   <item><description><c>&lt;br/&gt;</c></description></item>
///   <item><description><c>&lt;br /&gt;</c></description></item>
/// </list>
/// 其餘一律 return false（不吃掉任何字元），交回 Markdig 後續流程當字面處理。
/// </summary>
internal sealed class HtmlLineBreakInlineParser : InlineParser
{
    /// <summary>
    /// 命中時輸出的固定換行標籤（硬編碼常數，永不含使用者輸入）。
    /// 用自結束寫法 <c>&lt;br /&gt;</c> 與 Markdig 的硬換行輸出格式一致。
    /// </summary>
    private const string HardLineBreakTag = "<br />";

    /// <summary>
    /// 建構子：宣告本解析器的觸發字元為 <c>'&lt;'</c>。
    /// </summary>
    public HtmlLineBreakInlineParser()
    {
        OpeningCharacters = ['<'];
    }

    /// <summary>
    /// 嘗試從目前位置比對 <c>&lt;br&gt;</c> 家族。命中時吃掉整個標籤並產生硬換行；
    /// 不命中時完全不改動輸入（回傳 false，讓 <c>'&lt;'</c> 交由後續解析器/字面處理）。
    /// </summary>
    /// <param name="processor">
    /// inline 解析處理器；命中時把 <see cref="InlineProcessor.Inline"/> 設為硬換行節點。
    /// </param>
    /// <param name="slice">
    /// 目前的字元切片（<c>CurrentChar</c> 必為 <c>'&lt;'</c>）；命中時推進到標籤 <c>'&gt;'</c> 之後。
    /// </param>
    /// <returns>命中 <c>&lt;br&gt;</c> 家族回傳 true，否則 false。</returns>
    public override bool Match(InlineProcessor processor, ref StringSlice slice)
    {
        // StringSlice 是 struct，複本用來「前視」；比對失敗時原 slice 完全不受影響。
        var lookahead = slice;

        // 目前字元為 '<'（由 OpeningCharacters 保證），推進讀取後續字元。
        // 需求：'<' 'b'/'B' 'r'/'R'
        var current = lookahead.NextChar();
        if (current is not ('b' or 'B'))
        {
            return false;
        }

        current = lookahead.NextChar();
        if (current is not ('r' or 'R'))
        {
            return false;
        }

        // 'br' 之後：允許零個以上的空白／Tab。
        current = lookahead.NextChar();
        current = SkipInlineWhitespace(ref lookahead, current);

        // 可選的自結束斜線 '/'；其後同樣允許空白／Tab。
        if (current == '/')
        {
            current = lookahead.NextChar();
            current = SkipInlineWhitespace(ref lookahead, current);
        }

        // 收尾必須是 '>'，否則不是合法的 <br> 家族（例如 <br x>、<brs>）→ 不匹配。
        if (current != '>')
        {
            return false;
        }

        // 記錄標籤在來源中的位置（供除錯／來源對映；不影響 HTML 輸出）。
        // originalStart 指向 '<'、lookahead.Start 指向 '>'，兩者位於同一行，故位移可直接相加。
        var originalStart = slice.Start;
        var startPosition = processor.GetSourcePosition(originalStart, out var line, out var column);
        var endPosition = startPosition + (lookahead.Start - originalStart);

        // 命中：把主切片推進到 '>' 之後（lookahead.Start 目前指向 '>'）。
        slice.Start = lookahead.Start + 1;

        // 輸出固定常數 <br /> 的 HtmlInline 節點（非 LineBreakInline）。
        //
        // 為何不用 LineBreakInline：實測 Markdig 的 pipe table 會把「表格列裡的換行節點
        // （LineBreakInline）」當成『列分隔』，導致換行前的內容被丟到別列、儲存格內容遺失
        // （本功能主場景正是表格格內換行，故 LineBreakInline 不可用）。
        // HtmlInline 是「不透明的行內內容」，不會觸發 pipe table 的列切割，段落與表格格內皆
        // 正確渲染為 <br />；這也是 Markdig 在「開啟 HTML」時對 <br> 的原生處理方式。
        //
        // 安全性：Tag 是硬編碼常數 <see cref="HardLineBreakTag"/>，永不取自使用者輸入，
        // 故不擴大任何注入面（白名單：只有 <br> 家族的輸入才會產生這個固定常數）。
        processor.Inline = new HtmlInline(HardLineBreakTag)
        {
            Line = line,
            Column = column,
            Span = new SourceSpan(startPosition, endPosition),
        };
        return true;
    }

    /// <summary>
    /// 從目前字元起跳過連續的空白／Tab，回傳第一個非空白字元。
    /// </summary>
    /// <param name="slice">前視用的字元切片（會被推進）。</param>
    /// <param name="current">目前字元（呼叫端已讀入）。</param>
    /// <returns>第一個非空白／Tab 的字元。</returns>
    private static char SkipInlineWhitespace(ref StringSlice slice, char current)
    {
        while (current is ' ' or '\t')
        {
            current = slice.NextChar();
        }
        return current;
    }
}

/// <summary>
/// 「字面 <c>&lt;br&gt;</c> 換行」擴充的管線註冊輔助方法。
/// </summary>
public static class HtmlLineBreakPipelineExtensions
{
    /// <summary>
    /// 在管線中啟用「字面 <c>&lt;br&gt;</c> 家族 → 硬換行」。
    /// 應在 <c>DisableHtml()</c> 之後呼叫；本擴充會把解析器插到 inline 清單最前面，
    /// 確保先於其他 <c>'&lt;'</c> 解析器攔到 <c>&lt;br&gt;</c>。
    /// </summary>
    /// <param name="builder">Markdown 管線建構器。</param>
    /// <returns>同一個建構器（供鏈式呼叫）。</returns>
    public static MarkdownPipelineBuilder UseZonWikiLineBreaks(this MarkdownPipelineBuilder builder)
    {
        builder.Extensions.AddIfNotAlready(new HtmlLineBreakInlineExtension());
        return builder;
    }
}
