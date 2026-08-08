using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Extensions.GenericAttributes;
using Markdig.Extensions.Tables;
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
    /// 現行「渲染管線版本號」——Note.RenderVersion 的比對基準（單一真相，勿在他處散落魔術數字）。
    ///
    /// 版本史（每次讓 ContentHtml 輸出「形狀」改變的管線調整都要 +1，並在此補一行）：
    /// - 0：Note_RenderVersion 欄位加入前的存量筆記（DB 預設值；內容形狀不明，一律視為過時）。
    /// - 1：data-fence-line 時代（程式碼圍欄帶起始行號）——欄位加入前的最後一版管線，
    ///      僅作歷史紀錄用，實際存量筆記的欄位值都是 0。
    /// - 2：表格權威行號（data-md-table / data-md-line）＋移除 GenericAttributes
    ///      （表頭 {…} 尾碼以字面文字存活；修掉 {onclick=…} stored XSS）＋移除 GridTable
    ///      （+---+ 語法退回字面文字，防多行列的直編座標錯位）。2026-08-08。
    ///
    /// 用法：所有「重算 ContentHtml」的寫入路徑都同步寫入此值；GET 單篇筆記時
    /// RenderVersion &lt; 此值 → 純記憶體重渲染（不落 DB，見 NoteEndpoints.LoadNoteDetailByIdAsync）；
    /// DB 收斂由啟動一次性遷移負責（見 NoteRenderMigrationService）。
    /// </summary>
    public const int CurrentRenderVersion = 2;

    /// <summary>
    /// Markdown 渲染管線（禁用 raw HTML 以防 XSS）。
    /// 另啟用「摺疊區塊（Notion 式 toggle）」：<c>:::toggle 標題 … :::</c> → 原生 &lt;details&gt;。
    /// 註：UseZonWikiToggles 必須在 UseAdvancedExtensions 之後，才能替換自訂容器的輸出器。
    /// 另啟用「字面 &lt;br&gt; 換行」：白名單只認 <c>&lt;br&gt;</c>/<c>&lt;br/&gt;</c>/<c>&lt;br /&gt;</c>
    /// → 硬換行（<c>&lt;br /&gt;</c>），供表格格內／段落內手動換行；其餘 HTML 標籤維持轉義。
    /// 註：UseZonWikiLineBreaks 必須在 DisableHtml 之後，才能把解析器插到最前面攔到 &lt;br&gt;。
    /// 註：組完後移除 GenericAttributesExtension 與 GridTableExtension（見 <see cref="CreateMarkdownPipeline"/>）。
    /// </summary>
    public static readonly MarkdownPipeline MarkdownPipeline = CreateMarkdownPipeline();

    /// <summary>
    /// 建立筆記渲染管線，並「移除」UseAdvancedExtensions 內含的 GenericAttributesExtension
    /// 與 GridTableExtension。
    ///
    /// 為什麼要移除 GenericAttributes（互動表格設計 v2 修訂第 1、2 條；2026-08-08）：
    /// 1. 【安全・stored XSS】GenericAttributes 會把 <c>{onclick=alert(1)}</c> 這類「屬性語法」
    ///    渲染成真的 HTML 屬性（實測 <c>&lt;table onclick="alert(1)"&gt;</c>）——DisableHtml() 只擋
    ///    raw HTML 標籤，擋不住屬性語法，等於留了一條把事件處理器寫進筆記的後門。
    /// 2. 【功能】表格表頭的控件尾碼 <c>{checkbox}</c>／<c>{radio:…}</c> 會被當屬性語法吃掉並
    ///    套到 &lt;table&gt; 上，表頭尾碼無法以字面文字存活；移除後與編輯預覽（remark-gfm 本來
    ///    就不解析 <c>{…}</c>）行為一致，讀模式的表格控件語法才能雙路徑成立。
    ///
    /// 為什麼也移除 GridTable（對抗式復審 HIGH-2；2026-08-08）：grid table（<c>+---+</c> 圍線語法）
    /// 的「一列」可跨多個原始行——「列行號＋欄索引 → 改寫 ContentRaw 儲存格」的前端互動座標系
    /// 對它不成立；若讓它渲染成 &lt;table&gt;，下方 AST 後處理會照樣標上 data-md-table / data-md-line，
    /// 前端據此直編就會改寫到錯誤的行（跨行資料損毀）。且編輯預覽（remark-gfm）本來就不支援
    /// grid table，移除後兩條渲染路徑一致：grid 語法一律以字面文字（段落）存活。
    ///
    /// 做法：builder 各擴充組完後、Build() 之前，從 <c>builder.Extensions</c> 移除目標擴充——
    /// 其解析器因此不會被掛進管線，但其他 Advanced 擴充（pipe table、AutoIdentifier、刪除線…）
    /// 不受影響。
    /// 註：既有的 data-fence-line／本檔的表格行號都是「AST 後處理直接 AddProperty」，
    /// 屬性輸出由 HtmlRenderer 原生支援，與被移除的解析期擴充無關，不受影響。
    /// </summary>
    /// <returns>移除 GenericAttributes 與 GridTable 後的筆記渲染管線。</returns>
    private static MarkdownPipeline CreateMarkdownPipeline()
    {
        var builder = new MarkdownPipelineBuilder()
            .UseAdvancedExtensions()
            .UseAutoLinks()
            .UseZonWikiToggles()
            .DisableHtml()
            .UseZonWikiLineBreaks();

        // OrderedList<T> 繼承 List<T>，可直接以述詞移除；用型別比對而非索引，
        // 不依賴 UseAdvancedExtensions 的內部掛載順序。
        builder.Extensions.RemoveAll(extension =>
            extension is GenericAttributesExtension or GridTableExtension);

        return builder.Build();
    }

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

        // 給每個「pipe table」標上前端讀模式互動所需的權威行號（互動表格設計 v2 修訂第 13 條、§2）：
        // - <table> 標 data-md-table="1"：前端據此辨識「可增強的表格」（排序/篩選/控件/直編）。
        // - 每個 <tr> 標 data-md-line="(TableRow.Line + 1)"（1 起算）＝該列在原始 contentRaw 的行號。
        //   GFM 表格「一列＝一行原始碼」，前端以「列行號＋欄索引」即可定位並改寫 ContentRaw 的儲存格；
        //   與 data-fence-line 同理，行號必須由後端 Markdig AST 吐出（前端逐行正則是明文禁區——
        //   行號錯＝改到別行，屬跨列資料損毀）。分隔線（|---|）不是 TableRow，天然不會被標。
        foreach (var table in document.Descendants().OfType<Table>())
        {
            table.GetAttributes().AddProperty("data-md-table", "1");

            // 列是 Table 的直接子區塊；逐列標原始行號（含表頭列——表頭雖不可直編，
            // 但欄寬/檢視狀態簽章與除錯都用得到）。
            foreach (var row in table.OfType<TableRow>())
            {
                row.GetAttributes().AddProperty(
                    "data-md-line",
                    (row.Line + 1).ToString(CultureInfo.InvariantCulture));
            }
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
    /// 把筆記 slug 逐段編碼成可安全放進 URL 路徑的字串（段與段之間的「/」保留為層級分隔）。
    ///
    /// 為什麼要「逐段 Uri.EscapeDataString、以 / 接回」而非整串編碼、也不是裸串：
    /// 舊檔案匯入時代的 slug 可含「#」（prod 實例：programming/c#/f）。若後端把裸串 slug 直接組進
    /// 「/notes/{slug}」交給前端，前端 href 內含未編碼的「#」，瀏覽器會把其後整段當 URL fragment 丟棄，
    /// 導頁變成「筆記不存在」。逐段編碼會把「#」編成 %23（fragment 陷阱消失），同時保留「/」層級分隔
    /// （整串 Uri.EscapeDataString 會連「/」一起編成 %2F，破壞層級、也與前端 noteHref 組出的路徑形狀不一致）。
    ///
    /// 對齊 JS encodeURIComponent 語意（對抗式復審 MEDIUM #1）：.NET 的 Uri.EscapeDataString 依 RFC 3986
    /// 會把「! * ' ( )」這五個 sub-delims 也編成百分號（%21 %2A %27 %28 %29），但前端與 MCP 用的
    /// encodeURIComponent 不編碼它們。若不對齊，同一 slug 前後端會組出「逐位元組不同」的 URL 字串，
    /// 筆記頁的「返回堆疊」等字面比對會誤判成不同筆記。故編碼後把這五個 sub-delims 的百分號編碼還原成原字元。
    /// （此還原絕無誤傷：Uri.EscapeDataString 的輸出是三元組對齊的，%2A 等序列只可能來自對應原字元的編碼，
    /// 不會由其他編碼序列拼接而成；原文中的「%」本身已先被編成 %25。）
    /// </summary>
    /// <param name="slug">筆記 slug（可含「/」層級與「#」等 URL 特殊字元）。</param>
    /// <returns>逐段編碼後、以「/」接回的路徑片段（不含 /notes 前綴）；輸出與前端 encodeURIComponent 逐位元組一致。</returns>
    public static string EncodeSlugForUrl(string slug)
    {
        var encoded = string.Join('/', slug.Split('/').Select(Uri.EscapeDataString));

        // 把 encodeURIComponent 不編碼的五個 sub-delims 還原（見上方 summary 的「對齊 JS 語意」）。
        return encoded
            .Replace("%21", "!")
            .Replace("%2A", "*")
            .Replace("%27", "'")
            .Replace("%28", "(")
            .Replace("%29", ")");
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
