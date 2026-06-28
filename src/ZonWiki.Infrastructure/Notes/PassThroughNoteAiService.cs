namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// 筆記 AI 服務的本地 Stub 實作：直接傳回原始內容，不進行任何 AI 處理。
/// 此實作用於開發與測試；正式環境需接上真實 AI 供應者（OpenAI、Gemini 或 Claude CLI）。
/// TODO: P5 接線真實供應者（可注入選擇哪種供應者）。
/// </summary>
public sealed class PassThroughNoteAiService : INoteAiService
{
    /// <summary>
    /// Stub 實作：直接傳回原始內容。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖（未使用）。</param>
    /// <returns>未經修改的原始內容。</returns>
    public Task<string> ReformatAsync(
        string contentRaw,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(contentRaw);
    }

    /// <summary>
    /// Stub 實作：直接傳回原始內容。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖（未使用）。</param>
    /// <returns>未經修改的原始內容。</returns>
    public Task<string> BeautifyAsync(
        string contentRaw,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(contentRaw);
    }

    /// <summary>
    /// Stub 實作：回傳簡單佔位字串（正式以 Gemini 供應者回答）。
    /// </summary>
    public Task<string> AskAboutAsync(
        string selectedText,
        string question,
        CancellationToken cancellationToken)
    {
        return Task.FromResult($"（尚未接上 AI）關於「{selectedText}」的問題：{question}");
    }

    /// <summary>
    /// Stub 實作：直接回傳內容（測試精煉流程的管線時用）。
    /// </summary>
    public Task<string> GenerateAsync(
        string systemPrompt,
        string userContent,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(userContent);
    }
}
