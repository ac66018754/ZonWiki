using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;

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
    /// </summary>
    public static readonly MarkdownPipeline MarkdownPipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .UseAutoLinks()
        .UseZonWikiToggles()
        .DisableHtml()
        .Build();

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
