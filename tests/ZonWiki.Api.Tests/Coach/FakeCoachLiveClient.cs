using System.Collections.Concurrent;
using System.Threading.Channels;
using ZonWiki.Infrastructure.Coach;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="ICoachLiveClient"/> 的測試替身：可程式化推伺服器事件、記錄送出與 Abort／Dispose，
/// 讓 <c>CoachProxyService</c> 的橋接邏輯能在不連真 Vertex 的情況下做完整整合測試。
///
/// 併發：內部事件通道 unbounded；<see cref="Emit"/> 供測試從外部推事件；預設連線時自動送
/// <see cref="CoachReadyEvent"/>（多數測試要立即進聆聽），可用 <see cref="AutoReady"/> 關閉。
/// </summary>
public sealed class FakeCoachLiveClient : ICoachLiveClient
{
    private readonly Channel<CoachLiveServerEvent> _events =
        Channel.CreateUnbounded<CoachLiveServerEvent>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>連線時是否自動送出 Ready（setupComplete）。預設 true。</summary>
    public bool AutoReady { get; set; } = true;

    /// <summary>本 client 連線時收到的 setup。</summary>
    public CoachLiveSetup? ConnectedSetup { get; private set; }

    /// <summary>本 client 連線時收到的續連句柄（重連驗證用）。</summary>
    public string? ConnectedHandle { get; private set; }

    /// <summary>ConnectAsync 是否被呼叫。</summary>
    public bool ConnectCalled { get; private set; }

    /// <summary>Abort 被呼叫的次數（S1/S2 驗證：計費斷路確有真斷）。</summary>
    public int AbortCount => _abortCount;

    private int _abortCount;

    /// <summary>DisposeAsync 是否被呼叫。</summary>
    public bool Disposed { get; private set; }

    /// <summary>記錄送出的音訊 base64。</summary>
    public ConcurrentQueue<string> SentAudio { get; } = new();

    /// <summary>記錄送出的文字回合。</summary>
    public ConcurrentQueue<string> SentText { get; } = new();

    /// <summary>記錄送出的 audioStreamEnd 次數。</summary>
    public int AudioStreamEndCount => _audioStreamEndCount;

    private int _audioStreamEndCount;

    /// <summary>記錄送出的 toolResponse（id, name, response, scheduling）。</summary>
    public ConcurrentQueue<(string Id, string Name, object Response, string Scheduling)> ToolResponses { get; } = new();

    /// <inheritdoc />
    public ChannelReader<CoachLiveServerEvent> ServerEvents => _events.Reader;

    /// <inheritdoc />
    public Task ConnectAsync(CoachLiveSetup setup, string? resumptionHandle, CancellationToken cancellationToken)
    {
        ConnectCalled = true;
        ConnectedSetup = setup;
        ConnectedHandle = resumptionHandle;
        if (AutoReady)
        {
            _events.Writer.TryWrite(new CoachReadyEvent());
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask SendAudioAsync(string base64Pcm16, CancellationToken cancellationToken)
    {
        SentAudio.Enqueue(base64Pcm16);
        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask SendAudioStreamEndAsync(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _audioStreamEndCount);
        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask SendTextTurnAsync(string text, CancellationToken cancellationToken)
    {
        SentText.Enqueue(text);
        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask SendToolResponseAsync(
        string id,
        string name,
        object response,
        string scheduling,
        CancellationToken cancellationToken)
    {
        ToolResponses.Enqueue((id, name, response, scheduling));
        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public void Abort()
    {
        Interlocked.Increment(ref _abortCount);
        _events.Writer.TryComplete();
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        Disposed = true;
        Abort();
        return ValueTask.CompletedTask;
    }

    // ── 測試驅動 helper ───────────────────────────────────────────────────────────

    /// <summary>從外部推一個伺服器事件給 proxy 消費。</summary>
    public void Emit(CoachLiveServerEvent serverEvent) => _events.Writer.TryWrite(serverEvent);

    /// <summary>完成事件通道（模擬伺服器關線；non-fatal 用 <see cref="Emit"/> 送 <see cref="CoachClosedEvent"/>）。</summary>
    public void CompleteEvents() => _events.Writer.TryComplete();
}

/// <summary>
/// <see cref="ICoachLiveClientFactory"/> 的測試替身：依序吐出 fake client 並記錄，
/// 供整合測試驗「第二顆（重連）client 的 setup 帶 handle」。
/// </summary>
public sealed class FakeCoachLiveClientFactory : ICoachLiveClientFactory
{
    private readonly List<FakeCoachLiveClient> _created = new();
    private readonly object _lock = new();

    /// <summary>依建立順序的所有 fake client（[0]＝首連，[1]＝第一次重連…）。</summary>
    public IReadOnlyList<FakeCoachLiveClient> Created
    {
        get
        {
            lock (_lock)
            {
                return _created.ToList();
            }
        }
    }

    /// <summary>可選：每顆新 client 建立後的設定 hook（例如關掉 AutoReady 以測連線失敗）。</summary>
    public Action<FakeCoachLiveClient>? Configure { get; set; }

    /// <inheritdoc />
    public ICoachLiveClient Create()
    {
        var client = new FakeCoachLiveClient();
        Configure?.Invoke(client);
        lock (_lock)
        {
            _created.Add(client);
        }

        return client;
    }
}
