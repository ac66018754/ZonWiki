using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// 筆記 AI 服務介面。提供 AI 排版、美化、框選提問與通用生成。
/// 正式實作（<see cref="GeminiNoteAiService"/>）走「後援鏈」（Claude → Google AI Studio → banana）。
///
/// <para>
/// <b>onStage 回呼</b>：可選參數，置於 <c>cancellationToken</c> 之後以維持既有位置呼叫相容。
/// 實作在後援鏈每次「開始嘗試 / 嘗試失敗」時呼叫它，讓擁有 AiSession 的呼叫端能即時把
/// 階段（哪一家、第幾次、失敗錯誤）寫進佇列。不需要階段資訊的呼叫端可不傳（預設 null）。
/// </para>
/// </summary>
public interface INoteAiService
{
    /// <summary>
    /// 重新格式化：單純調整 Markdown 排版（空行、表格、粗體等），不改變語意。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <param name="onStage">後援鏈階段事件回呼（可空；遇 Stage 事件時呼叫）。</param>
    /// <returns>格式化後的 Markdown 內容。</returns>
    Task<string> ReformatAsync(
        string contentRaw,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null);

    /// <summary>
    /// 美化內容：不只調整排版，還雕琢措辭、改善結構、補充邏輯銜接、提升可讀性。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <param name="onStage">後援鏈階段事件回呼（可空；遇 Stage 事件時呼叫）。</param>
    /// <returns>美化後的 Markdown 內容。</returns>
    Task<string> BeautifyAsync(
        string contentRaw,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null);

    /// <summary>
    /// 框選提問：針對一段選取的文字回答使用者的問題（以 Markdown 作答）。
    /// </summary>
    /// <param name="selectedText">使用者框選的文字片段（作為提問脈絡）。</param>
    /// <param name="question">使用者的問題。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <param name="onStage">後援鏈階段事件回呼（可空；遇 Stage 事件時呼叫）。</param>
    /// <returns>AI 的 Markdown 回答。</returns>
    Task<string> AskAboutAsync(
        string selectedText,
        string question,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null);

    /// <summary>
    /// 通用文字生成：以給定的系統提示與使用者內容呼叫 AI，回傳完整文字結果。
    /// 供「精煉成筆記」等需要自訂提示的流程使用（重用同一條 AI 供應者管線）。
    /// </summary>
    /// <param name="systemPrompt">系統提示（角色與輸出規範）。</param>
    /// <param name="userContent">使用者內容（例如逐字稿）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <param name="onStage">後援鏈階段事件回呼（可空；遇 Stage 事件時呼叫）。</param>
    /// <returns>AI 產出的完整文字。</returns>
    Task<string> GenerateAsync(
        string systemPrompt,
        string userContent,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null);
}
