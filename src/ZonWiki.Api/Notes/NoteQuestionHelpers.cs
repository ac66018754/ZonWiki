using System.Text.Json;
using System.Text.RegularExpressions;

namespace ZonWiki.Api.Notes;

/// <summary>
/// 「問題功能」共用小工具：從浮層元件（便利貼 / T 文字框）推導「問題顯示標題」。
///
/// 標題推導規則（與前端問題清單一致）：
/// - sticky（便利貼）：優先取 DataJson.title（於 C# 記憶體端以 System.Text.Json 安全解析）；
///   無標題則退回文字前段；再無則回退預設字樣。
/// - text（T 文字框）：取文字前段；無文字則回退預設字樣。
/// </summary>
public static class NoteQuestionHelpers
{
    /// <summary>
    /// 問題標題的最大顯示長度（超過即截斷並加省略號）。
    /// </summary>
    private const int QuestionTitleMaxLength = 30;

    /// <summary>
    /// 便利貼型別字串（與 <see cref="Domain.Entities.NoteOverlayItem.Kind"/> 一致）。
    /// </summary>
    private const string StickyKind = "sticky";

    /// <summary>
    /// 無可用文字時的問題標題預設字樣。
    /// </summary>
    private const string EmptyQuestionTitle = "(未命名問題)";

    /// <summary>
    /// 推導問題顯示標題（問題清單用；空文字回退為「(未命名問題)」）。
    /// </summary>
    /// <param name="kind">浮層型別（"sticky" / "text"）。</param>
    /// <param name="text">浮層文字內容（可空）。</param>
    /// <param name="dataJson">浮層的 DataJson（sticky 可能含 title；可空、可為壞 JSON）。</param>
    /// <returns>可讀的短標題。</returns>
    public static string DeriveQuestionTitle(string kind, string? text, string? dataJson)
        => DeriveOverlayTitle(kind, text, dataJson, EmptyQuestionTitle);

    /// <summary>
    /// 推導浮層元件（便利貼 / T 文字框）的顯示標題——問題清單與全站搜尋共用同一份推導規則（DRY）：
    /// sticky 優先取 DataJson.title（記憶體端安全解析）→ 退回文字前段（空白正規化＋截斷加省略號）→
    /// 再無則回退 <paramref name="emptyFallback"/>；text 直接走文字前段。
    /// </summary>
    /// <param name="kind">浮層型別（"sticky" / "text"）。</param>
    /// <param name="text">浮層文字內容（可空）。</param>
    /// <param name="dataJson">浮層的 DataJson（sticky 可能含 title；可空、可為壞 JSON）。</param>
    /// <param name="emptyFallback">無任何可用文字時的預設字樣（依呼叫端語境而異，如「(未命名問題)」「(無文字)」）。</param>
    /// <returns>可讀的短標題。</returns>
    public static string DeriveOverlayTitle(string kind, string? text, string? dataJson, string emptyFallback)
    {
        if (string.Equals(kind, StickyKind, StringComparison.OrdinalIgnoreCase))
        {
            var title = TryReadJsonStringProperty(dataJson, "title");
            if (!string.IsNullOrWhiteSpace(title))
            {
                return Truncate(title!, emptyFallback);
            }
        }

        return Truncate(text, emptyFallback);
    }

    /// <summary>
    /// 取文字前段作為標題（空白正規化；超長截斷加省略號）；空文字回退為指定的預設字樣。
    /// </summary>
    /// <param name="text">來源文字（可空）。</param>
    /// <param name="emptyFallback">空文字時的預設字樣。</param>
    /// <returns>短標題。</returns>
    private static string Truncate(string? text, string emptyFallback)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return emptyFallback;
        }

        var normalized = Regex.Replace(text, @"\s+", " ").Trim();
        return normalized.Length <= QuestionTitleMaxLength
            ? normalized
            : normalized.Substring(0, QuestionTitleMaxLength) + "…";
    }

    /// <summary>
    /// 於記憶體端安全解析 JSON 物件的某個「字串」屬性；非物件／缺屬性／非字串／壞 JSON 皆回 null。
    /// </summary>
    /// <param name="json">JSON 字串（可空、可為壞資料）。</param>
    /// <param name="propertyName">要讀取的屬性名稱。</param>
    /// <returns>屬性字串值；不存在或不合法時回 null。</returns>
    private static string? TryReadJsonStringProperty(string? json, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty(propertyName, out var property)
                && property.ValueKind == JsonValueKind.String)
            {
                return property.GetString();
            }
        }
        catch (JsonException)
        {
            // DataJson 不是合法 JSON（理論上不會發生，但防禦性處理）→ 視為沒有標題。
        }

        return null;
    }
}
