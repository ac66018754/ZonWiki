using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Renderers;
using Markdig.Renderers.Html;
using Markdig.Syntax;

namespace ZonWiki.Api.Notes;

/// <summary>
/// 筆記內容處理的共用輔助方法（Markdown 管線、Slug 產生、Content Hash 計算）。
/// </summary>
internal static class NoteContentHelpers
{
    /// <summary>
    /// Markdown 渲染管線（禁用 raw HTML 以防 XSS）。
    /// 另啟用「摺疊區塊（Notion 式 toggle）」：<c>:::toggle 標題 … :::</c> → 原生 &lt;details&gt;。
    /// 註：UseZonWikiToggles 必須在 UseAdvancedExtensions 之後，才能替換自訂容器的輸出器。
    /// 另啟用「字面 &lt;br&gt; 換行」：白名單只認 <c>&lt;br&gt;</c>/<c>&lt;br/&gt;</c>/<c>&lt;br /&gt;</c>
    /// → 硬換行（<c>&lt;br /&gt;</c>），供表格格內／段落內手動換行；其餘 HTML 標籤維持轉義。
    /// 註：UseZonWikiLineBreaks 必須在 DisableHtml 之後，才能把解析器插到最前面攔到 &lt;br&gt;。
    /// </summary>
    public static readonly MarkdownPipeline MarkdownPipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .UseAutoLinks()
        .UseZonWikiToggles()
        .DisableHtml()
        .UseZonWikiLineBreaks()
        .Build();

    /// <summary>
    /// 把 Markdown 渲染成 HTML（筆記顯示用的統一入口）。
    /// 渲染前先 <see cref="NormalizeToggleFences"/>：修正 Markdig 對「同長度 ::: 巢狀 toggle」會把
    /// 外層提早關掉的問題，讓後端渲染與前端（編輯預覽的深度計數器）一致。
    /// </summary>
    /// <param name="markdown">筆記 Markdown 原文。</param>
    /// <returns>渲染後的 HTML。</returns>
    public static string RenderToHtml(string markdown)
    {
        var document = Markdown.Parse(NormalizeToggleFences(markdown), MarkdownPipeline);

        // 給每個「圍欄程式碼區塊」標上 data-fence-line＝其在原文的「來源起始行號」（1 起算）。
        // 供查看模式就地改檔名／語言時，直接定位並改寫原文的那一行圍欄——後端 Markdig 依循 CommonMark、
        // 知道每個圍欄的確切位置（縮排程式碼區塊不是 FencedCodeBlock、不會被標記）。
        // 為何用「行號」而非「第幾個」：前端逐行重數圍欄拿不到 CommonMark 的容器縮排基準——頂層縮排 ≥4
        // 空白的字面 ``` 是縮排碼（非圍欄）、但清單／引用內縮排 ≥4 的 ``` 卻是合法圍欄，兩者絕對縮排相同、
        // 無法用逐行正則區分，會與後端計數分歧而改到別的區塊（跨區塊資料損毀）。改由後端吐行號可根治。
        // NormalizeToggleFences 只改 ::: 容器行的冒號數、不增減行，故行號與原始 contentRaw 一致。
        foreach (var fenced in document.Descendants().OfType<FencedCodeBlock>())
        {
            fenced.GetAttributes().AddProperty(
                "data-fence-line",
                (fenced.Line + 1).ToString(CultureInfo.InvariantCulture));
        }

        using var writer = new StringWriter();
        var renderer = new HtmlRenderer(writer);
        MarkdownPipeline.Setup(renderer);
        renderer.Render(document);
        writer.Flush();
        return writer.ToString();
    }

    /// <summary>
    /// 正規化摺疊區塊的圍欄冒號數：把「同長度 <c>:::</c> 巢狀」重寫成「外層冒號較多、內層較少」的變長圍欄。
    ///
    /// 為什麼需要：Markdig 的自訂容器解析，對「同長度圍欄的巢狀＋兄弟區塊」會把外層容器提早關掉
    /// （例：外層「省」內含兩個兄弟 toggle「通用」「91APP」時，91APP 會被解析成外層的兄弟而非子項）；
    /// 但前端編輯預覽用的是「深度計數器」，會正確巢狀。兩者不一致 → 同一份 Markdown 兩種渲染。
    /// 實測 Markdig 對「外層冒號較多」的變長圍欄可正確巢狀，故在渲染前用深度計數重新指派冒號數。
    ///
    /// 重要：只在「後端渲染前」做此轉換；筆記原文（contentRaw）仍以三冒號 <c>:::</c> 儲存，
    /// 前端解析與 AI 產出格式都不受影響。無巢狀或圍欄不平衡時原樣回傳（保守、不破壞）。
    /// </summary>
    /// <param name="markdown">筆記 Markdown 原文（來源為三冒號圍欄）。</param>
    /// <returns>圍欄冒號數已依巢狀深度正規化的 Markdown；無需轉換時回傳原文。</returns>
    internal static string NormalizeToggleFences(string markdown)
    {
        if (string.IsNullOrEmpty(markdown) || !markdown.Contains(":::", StringComparison.Ordinal))
        {
            return markdown;
        }

        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        var fenceDepth = new int[lines.Length];   // 該行若是容器 open/close，記其深度；否則 -1
        for (var i = 0; i < lines.Length; i++)
        {
            fenceDepth[i] = -1;
        }

        var stack = new Stack<int>();      // 目前開著的容器深度
        var inCodeFence = false;
        var codeFenceChar = ' ';
        var maxDepth = 0;

        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].TrimStart();

            // 追蹤 ``` / ~~~ 程式碼圍欄：其內的 ::: 一律視為內容、不當容器（與前端解析一致）。
            if (trimmed.StartsWith("```", StringComparison.Ordinal) || trimmed.StartsWith("~~~", StringComparison.Ordinal))
            {
                if (!inCodeFence)
                {
                    inCodeFence = true;
                    codeFenceChar = trimmed[0];
                }
                else if (trimmed.StartsWith(new string(codeFenceChar, 3), StringComparison.Ordinal))
                {
                    inCodeFence = false;
                }
                continue;
            }
            if (inCodeFence)
            {
                continue;
            }

            var (colons, isOpen, isClose) = ClassifyFenceLine(trimmed);
            if (isOpen)
            {
                var depth = stack.Count;
                fenceDepth[i] = depth;
                stack.Push(depth);
                if (depth > maxDepth)
                {
                    maxDepth = depth;
                }
            }
            else if (isClose && stack.Count > 0)
            {
                fenceDepth[i] = stack.Pop();
            }
            _ = colons;
        }

        // 無巢狀（maxDepth==0，頂層兄弟 Markdig 本來就對）→ 不動、原樣回傳。
        //
        // 圍欄「不平衡」（未閉合的 toggle）不再放棄正規化：前端 parseToggleSegments 對未閉合是容忍的
        // （子項仍巢狀進外層、延伸到 EOF），若後端這裡因不平衡就 return 原文，Markdig 同長度 ::: 會把子項
        // 誤解析成兄弟 → 筆記頁與編輯預覽渲染不一致（實測 bug）。未閉合的 open 在上面的迴圈已記了深度，
        // 照樣依深度重寫冒號（外層冒號較多），Markdig 會在 EOF 自動收尾外層容器 → 與前端一致。
        if (maxDepth == 0)
        {
            return markdown;
        }

        var sb = new StringBuilder(markdown.Length + 32);
        for (var i = 0; i < lines.Length; i++)
        {
            var depth = fenceDepth[i];
            if (depth >= 0)
            {
                var line = lines[i];
                var trimmed = line.TrimStart();
                var indent = line[..(line.Length - trimmed.Length)];
                var colons = 3 + (maxDepth - depth);   // 外層深度小 → 冒號多；最內層(=maxDepth) → 3
                var rest = trimmed.TrimStart(':');      // 去掉開頭冒號，保留 toggle 標題等其餘內容
                sb.Append(indent).Append(new string(':', colons)).Append(rest);
            }
            else
            {
                sb.Append(lines[i]);
            }

            if (i < lines.Length - 1)
            {
                sb.Append('\n');
            }
        }

        return sb.ToString();
    }

    /// <summary>
    /// 判斷一行（已去左側空白）是不是自訂容器的圍欄：回傳冒號數、是否為 open（後接非空白，如 <c>:::toggle 標題</c>）、
    /// 是否為 close（整行只有冒號，如 <c>:::</c>）。冒號少於 3 個則都不是。
    /// </summary>
    private static (int Colons, bool IsOpen, bool IsClose) ClassifyFenceLine(string trimmed)
    {
        var c = 0;
        while (c < trimmed.Length && trimmed[c] == ':')
        {
            c++;
        }
        if (c < 3)
        {
            return (0, false, false);
        }
        var rest = trimmed[c..].Trim();
        return rest.Length == 0 ? (c, false, true) : (c, true, false);
    }

    /// <summary>
    /// 產生筆記 slug（從標題移除特殊字元、轉小寫、用連字號分隔）。
    /// </summary>
    /// <param name="title">筆記標題。</param>
    /// <returns>Slug 字串（全小寫、連字號分隔、無特殊字元）。</returns>
    public static string GenerateSlug(string title)
    {
        var slug = Regex.Replace(title.ToLowerInvariant(), @"[^\w\s-]", string.Empty);
        slug = Regex.Replace(slug, @"[\s]+", "-");
        slug = Regex.Replace(slug, @"-+", "-").Trim('-');
        return slug;
    }

    /// <summary>
    /// 計算筆記內容雜湊（SHA-256）。
    /// </summary>
    /// <param name="content">筆記內容（Markdown 原文）。</param>
    /// <returns>SHA-256 十六進位字串（小寫、64 字元）。</returns>
    public static string ComputeContentHash(string content)
    {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(hash);
    }
}
