using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace ZonWiki.Infrastructure.Refine;

/// <summary>
/// 文章抓取結果。
/// </summary>
/// <param name="Title">標題（取 og:title 或 &lt;title&gt;）。</param>
/// <param name="Text">抽出的可讀主文純文字。</param>
public sealed record ArticleResult(string Title, string Text);

/// <summary>
/// 抓「純文字網頁/文章」的內文：HTTP 取 HTML → 去掉 script/style/導覽等雜訊 → 抽成純文字。
/// 供「精煉成筆記」在 yt-dlp 抓不到影音時退而求其次（一般文章/部落格/新聞可行；
/// Threads/X/IG 等靠 JS 渲染或登入牆的頁面抓不到乾淨文字）。殘餘雜訊由後續 AI 整理時自行過濾。
///
/// 安全：與 yt-dlp 共用 <see cref="RefineUrlGuard"/> 的 SSRF 防護（擋私有/內網/中繼資料 IP）。
/// </summary>
public sealed class ArticleFetchService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<ArticleFetchService> _logger;

    /// <summary>內文太短就視為「不是文章」（多半是 JS 殼/登入牆/錯誤頁）。</summary>
    private const int MinTextLength = 200;

    /// <summary>內文上限（與 RefineService 的 prompt 長度上限呼應）。</summary>
    private const int MaxTextLength = 40000;

    /// <summary>
    /// 建立文章抓取服務。
    /// </summary>
    public ArticleFetchService(IHttpClientFactory httpClientFactory, ILogger<ArticleFetchService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// 抓取並抽出文章內文。失敗（非 HTML、抓不到、內文太短）回 null。
    /// </summary>
    /// <param name="url">文章連結。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>文章結果，或 null（不是可讀文章）。</returns>
    public async Task<ArticleResult?> FetchAsync(string url, CancellationToken cancellationToken)
    {
        await RefineUrlGuard.ValidateAsync(url, cancellationToken);

        var http = _httpClientFactory.CreateClient("ai");
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        // 帶常見瀏覽器 UA：不少站對預設/空 UA 直接擋。
        request.Headers.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
        request.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml");

        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogInformation("文章抓取非 2xx（{Status}）：{Url}", (int)response.StatusCode, url);
            return null;
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (mediaType.Length > 0 && !mediaType.Contains("html") && !mediaType.Contains("xml") && !mediaType.Contains("text"))
        {
            // 不是 HTML/文字（例如 PDF、影音、圖片）→ 不是這條路該處理的。
            return null;
        }

        var html = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(html))
        {
            return null;
        }

        var title = ExtractTitle(html);
        var text = HtmlToText(html);

        if (text.Length < MinTextLength)
        {
            _logger.LogInformation("文章內文過短（{Len} 字），視為非文章：{Url}", text.Length, url);
            return null;
        }

        if (text.Length > MaxTextLength)
        {
            text = text[..MaxTextLength];
        }

        return new ArticleResult(string.IsNullOrWhiteSpace(title) ? "未命名文章" : title, text);
    }

    /// <summary>取標題：優先 og:title，其次 &lt;title&gt;。</summary>
    private static string ExtractTitle(string html)
    {
        var og = Regex.Match(
            html,
            "<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']",
            RegexOptions.IgnoreCase);
        if (og.Success)
        {
            return WebUtility.HtmlDecode(og.Groups[1].Value).Trim();
        }

        var t = Regex.Match(html, "<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return t.Success ? WebUtility.HtmlDecode(t.Groups[1].Value).Trim() : string.Empty;
    }

    /// <summary>
    /// 把 HTML 轉成可讀純文字：移除 script/style/head/nav/footer 等雜訊 →
    /// 區塊標籤轉換行 → 去掉其餘標籤 → 解碼 HTML 實體 → 收斂空白。
    /// </summary>
    private static string HtmlToText(string html)
    {
        // 1) 整段移除非內容區塊（含其內容）。
        html = Regex.Replace(html, "<!--.*?-->", " ", RegexOptions.Singleline);
        foreach (var tag in new[] { "script", "style", "head", "noscript", "svg", "nav", "footer", "header", "aside", "form" })
        {
            html = Regex.Replace(html, $"<{tag}[^>]*>.*?</{tag}>", " ", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        }

        // 2) 區塊級標籤 → 換行（保住段落感）。
        html = Regex.Replace(html, "<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article)[^>]*>", "\n", RegexOptions.IgnoreCase);

        // 3) 去掉其餘所有標籤。
        html = Regex.Replace(html, "<[^>]+>", " ");

        // 4) 解碼 HTML 實體。
        var text = WebUtility.HtmlDecode(html);

        // 5) 收斂空白：每行 trim、移除空行過多、合併多重空格。
        var lines = text.Replace("\r\n", "\n").Split('\n')
            .Select(l => Regex.Replace(l, "[ \t ]+", " ").Trim())
            .Where(l => l.Length > 0);
        return string.Join("\n", lines).Trim();
    }
}
