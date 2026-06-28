namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// 筆記 AI 服務介面。提供兩種 AI 輔助模式：調整排版與整體美化。
/// P5 階段改為真實供應者（Claude CLI 子行程、OpenAI 相容端點或 Gemini）；目前為本地 stub 實作。
/// </summary>
public interface INoteAiService
{
    /// <summary>
    /// 重新格式化：單純調整 Markdown 排版（空行、表格、粗體等），不改變語意。
    /// 例如：補齊分段空行、調整表格格式、統一標題層級。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>格式化後的 Markdown 內容。</returns>
    Task<string> ReformatAsync(
        string contentRaw,
        CancellationToken cancellationToken);

    /// <summary>
    /// 美化內容：不只調整排版，還雕琢措辭、改善結構、補充邏輯銜接、提升可讀性。
    /// 例如：重新組織段落、改善用詞遣句、補充過渡句。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>美化後的 Markdown 內容。</returns>
    Task<string> BeautifyAsync(
        string contentRaw,
        CancellationToken cancellationToken);

    /// <summary>
    /// 框選提問：針對一段選取的文字回答使用者的問題（以 Markdown 作答）。
    /// </summary>
    /// <param name="selectedText">使用者框選的文字片段（作為提問脈絡）。</param>
    /// <param name="question">使用者的問題。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>AI 的 Markdown 回答。</returns>
    Task<string> AskAboutAsync(
        string selectedText,
        string question,
        CancellationToken cancellationToken);

    /// <summary>
    /// 通用文字生成：以給定的系統提示與使用者內容呼叫 AI，回傳完整文字結果。
    /// 供「精煉成筆記」等需要自訂提示的流程使用（重用同一條 AI 供應者管線）。
    /// </summary>
    /// <param name="systemPrompt">系統提示（角色與輸出規範）。</param>
    /// <param name="userContent">使用者內容（例如逐字稿）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>AI 產出的完整文字。</returns>
    Task<string> GenerateAsync(
        string systemPrompt,
        string userContent,
        CancellationToken cancellationToken);
}
