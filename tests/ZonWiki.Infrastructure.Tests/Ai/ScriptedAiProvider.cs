using System.Runtime.CompilerServices;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Tests.Ai;

/// <summary>
/// 可腳本化的測試用 AI 供應者：每次被呼叫（含後援鏈重試）依序取出一個 <see cref="Attempt"/> 腳本，
/// 模擬「逐字吐 Delta 後成功 / 回錯誤 / 拋例外 / 回空白」。用以對 <see cref="FallbackChainProvider"/> 做可決定性測試。
/// </summary>
internal sealed class ScriptedAiProvider : IAiProvider
{
    /// <summary>
    /// 單次嘗試的結局。
    /// </summary>
    internal enum Outcome
    {
        /// <summary>正常完成，帶非空白文字。</summary>
        Completed,
        /// <summary>吐 Error 事件。</summary>
        Error,
        /// <summary>串流過程中拋例外。</summary>
        Throw,
        /// <summary>完成但文字為空白（空回應）。</summary>
        EmptyCompleted,
    }

    /// <summary>
    /// 單次嘗試腳本：先吐這些 Delta，再依 <paramref name="Result"/> 收尾。
    /// </summary>
    internal sealed record Attempt(string[] Deltas, Outcome Result, string Text = "");

    private readonly Queue<Attempt> _attempts;

    /// <summary>被呼叫的次數（驗證重試/換家是否如預期）。</summary>
    public int CallCount { get; private set; }

    /// <summary>每次被呼叫時收到的 model 參數（驗證逐 link 帶對模型）。</summary>
    public List<string?> ReceivedModels { get; } = new();

    public ScriptedAiProvider(params Attempt[] attempts)
    {
        _attempts = new Queue<Attempt>(attempts);
    }

    /// <summary>方便建立「直接成功」的腳本。</summary>
    public static ScriptedAiProvider Succeeds(string text = "答案", params string[] deltas) =>
        new(new Attempt(deltas.Length == 0 ? new[] { text } : deltas, Outcome.Completed, text));

    public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt,
        string? resumeSessionId = null,
        string? model = null,
        string? systemPrompt = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        CallCount++;
        ReceivedModels.Add(model);

        var attempt = _attempts.Count > 0
            ? _attempts.Dequeue()
            : new Attempt(Array.Empty<string>(), Outcome.Error, "腳本已用盡");

        foreach (var delta in attempt.Deltas)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return new AiStreamEvent(AiStreamEventType.Delta, delta);
        }

        switch (attempt.Result)
        {
            case Outcome.Completed:
                yield return new AiStreamEvent(AiStreamEventType.Completed, attempt.Text, SessionId: "session-x");
                break;
            case Outcome.EmptyCompleted:
                yield return new AiStreamEvent(AiStreamEventType.Completed, attempt.Text);
                break;
            case Outcome.Error:
                yield return new AiStreamEvent(AiStreamEventType.Error, attempt.Text);
                break;
            case Outcome.Throw:
                throw new InvalidOperationException(attempt.Text);
        }
    }
}
