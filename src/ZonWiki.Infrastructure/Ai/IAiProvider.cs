namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// AI 串流事件型別。
/// </summary>
public enum AiStreamEventType
{
    /// <summary>
    /// 一段新產生的文字片段（增量）。
    /// </summary>
    Delta,

    /// <summary>
    /// 串流完成。<c>Text</c> 帶完整答案。
    /// </summary>
    Completed,

    /// <summary>
    /// 發生錯誤。<c>Text</c> 帶錯誤訊息。
    /// </summary>
    Error,
}

/// <summary>
/// 單一 AI 串流事件。
/// </summary>
/// <param name="Type">事件型別。</param>
/// <param name="Text">片段文字 / 完整文字 / 錯誤訊息。</param>
/// <param name="RawLine">對應的原始輸出行（除錯用，可空）。</param>
/// <param name="SessionId">claude 對話 session 識別碼（通常隨 Completed 事件回傳，供後續 --resume）。</param>
public readonly record struct AiStreamEvent(
    AiStreamEventType Type, string Text, string? RawLine = null, string? SessionId = null);

/// <summary>
/// AI 供應者抽象。把「給一段 prompt、串流回傳答案」這件事抽離出來，
/// 讓正式環境用 claude CLI、測試與 E2E 用可決定性的假供應者，且兩者可互換。
/// </summary>
public interface IAiProvider
{
    /// <summary>
    /// 串流回傳對 <paramref name="prompt"/> 的回答。先吐若干 <see cref="AiStreamEventType.Delta"/>，
    /// 最後吐一個帶 <c>SessionId</c> 的 <see cref="AiStreamEventType.Completed"/>（或 <see cref="AiStreamEventType.Error"/>）。
    /// </summary>
    /// <param name="prompt">提示內容。採 resume 時通常只含新問題。</param>
    /// <param name="resumeSessionId">若提供，則以 <c>--resume</c> 接續該 claude session（線性接續）。</param>
    /// <param name="model">指定回答模型（如 opus / sonnet / haiku）；null 或空字串表示用 claude 預設模型。</param>
    /// <param name="systemPrompt">系統提示（可空）：以各供應者原生方式注入（claude 用 --append-system-prompt；OpenAI 相容用 role=system 訊息）。</param>
    IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null, CancellationToken cancellationToken = default);
}
