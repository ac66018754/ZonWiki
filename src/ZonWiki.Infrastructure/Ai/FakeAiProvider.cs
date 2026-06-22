using System.Runtime.CompilerServices;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 可決定性的假 AI 供應者，供單元測試與 Playwright E2E 使用（透過環境變數
/// ZONWIKI_AI_PROVIDER=Fake 啟用）。把固定答案切成數段以 Delta 串流吐出，最後吐 Completed，
/// 不需真的呼叫 claude CLI，故測試結果穩定。
/// </summary>
public sealed class FakeAiProvider : IAiProvider
{
    /// <summary>
    /// E2E 可辨識的固定答案片段集合（依序串流）。
    /// </summary>
    public static readonly IReadOnlyList<string> DefaultChunks = new[]
    {
        "這是測試用的 AI 回答。",
        "容器化（containerization）是把應用程式",
        "與其相依套件打包成獨立、可攜的容器的技術。",
    };

    private readonly IReadOnlyList<string> _chunks;
    private readonly int _delayMs;

    /// <summary>
    /// 建立假供應者。
    /// </summary>
    /// <param name="chunks">要串流的文字片段；省略時用 <see cref="DefaultChunks"/>。</param>
    /// <param name="delayMs">每段之間的延遲毫秒數（E2E 觀察串流用），預設 0。</param>
    public FakeAiProvider(IReadOnlyList<string>? chunks = null, int delayMs = 0)
    {
        _chunks = chunks ?? DefaultChunks;
        _delayMs = delayMs;
    }

    /// <summary>
    /// 依序吐出固定片段，最後吐出帶完整答案與（假）session id 的 Completed 事件。
    /// resume 時沿用傳入的 session id，否則回傳固定的假 id，方便測試 resume 流程。
    /// </summary>
    public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt, string? resumeSessionId = null, string? model = null, string? systemPrompt = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var full = string.Empty;
        foreach (var chunk in _chunks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_delayMs > 0)
            {
                await Task.Delay(_delayMs, cancellationToken);
            }

            full += chunk;
            yield return new AiStreamEvent(AiStreamEventType.Delta, chunk);
        }

        var sessionId = resumeSessionId ?? "fake-session-0001";
        yield return new AiStreamEvent(AiStreamEventType.Completed, full, SessionId: sessionId);
    }
}
