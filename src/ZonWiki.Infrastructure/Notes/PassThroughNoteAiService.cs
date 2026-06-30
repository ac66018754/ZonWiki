using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// 筆記 AI 服務的本地 Stub 實作：直接傳回原始內容，不進行任何 AI 處理。
/// 此實作用於開發與測試；正式環境接 <see cref="GeminiNoteAiService"/>（走後援鏈）。
/// Stub 無串流、不會發出 Stage 事件，故 <c>onStage</c> 收下但不呼叫。
/// </summary>
public sealed class PassThroughNoteAiService : INoteAiService
{
    /// <summary>
    /// Stub 實作：直接傳回原始內容。
    /// </summary>
    public Task<string> ReformatAsync(
        string contentRaw,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null)
    {
        return Task.FromResult(contentRaw);
    }

    /// <summary>
    /// Stub 實作：直接傳回原始內容。
    /// </summary>
    public Task<string> BeautifyAsync(
        string contentRaw,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null)
    {
        return Task.FromResult(contentRaw);
    }

    /// <summary>
    /// Stub 實作：回傳簡單佔位字串（正式以後援鏈回答）。
    /// </summary>
    public Task<string> AskAboutAsync(
        string selectedText,
        string question,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null)
    {
        return Task.FromResult($"（尚未接上 AI）關於「{selectedText}」的問題：{question}");
    }

    /// <summary>
    /// Stub 實作：直接回傳內容（測試精煉流程的管線時用）。
    /// </summary>
    public Task<string> GenerateAsync(
        string systemPrompt,
        string userContent,
        CancellationToken cancellationToken,
        Func<AiStreamEvent, Task>? onStage = null)
    {
        return Task.FromResult(userContent);
    }
}
