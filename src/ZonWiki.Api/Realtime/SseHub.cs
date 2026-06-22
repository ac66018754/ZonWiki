using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace ZonWiki.Api.Realtime;

/// <summary>
/// 單一 SSE 事件信封：序號、型別、酬載。
/// 內部記錄時間戳記以支援追蹤與驗證。
/// </summary>
/// <param name="Seq">該畫布內單調遞增的序號（去重與補播依據）。</param>
/// <param name="Type">事件型別（node.created、node.streaming…）。</param>
/// <param name="Data">事件酬載。</param>
public sealed record SseEnvelope(int Seq, string Type, object Data)
{
    /// <summary>
    /// 事件發生的 UTC 時間戳記（內部追蹤用，不序列化到前端）。
    /// </summary>
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// SSE 中樞（單例）：以畫布為單位管理訂閱者頻道與事件 backlog。
/// 應用內 AI 串流、節點/筆記變更、以及 MCP 經由 Web API 的寫入，全部 Publish 到此處，
/// 開著的瀏覽器即時收到更新。每事件帶單調序號；用戶端可帶 afterSeq 重連補播去重。
/// </summary>
public sealed class SseHub
{
    private const int BacklogCap = 500;

    private sealed class CanvasChannel
    {
        public int Seq;
        public readonly List<SseEnvelope> Backlog = new();
        public readonly ConcurrentDictionary<Guid, Channel<SseEnvelope>> Subscribers = new();
        public readonly object Gate = new();
    }

    private readonly ConcurrentDictionary<string, CanvasChannel> _canvases = new();

    private CanvasChannel GetChannel(string canvasId)
        => _canvases.GetOrAdd(canvasId, _ => new CanvasChannel());

    /// <summary>
    /// 發布一個事件到指定畫布；指派序號與時間戳記、寫入 backlog、推送給所有訂閱者。
    /// </summary>
    public void Publish(string canvasId, string type, object data)
    {
        var channel = GetChannel(canvasId);
        SseEnvelope envelope;

        lock (channel.Gate)
        {
            var seq = ++channel.Seq;
            // 建立事件信封，內部時間戳記用於去重與追蹤（不序列化到前端）
            envelope = new SseEnvelope(seq, type, data) { Timestamp = DateTime.UtcNow };
            channel.Backlog.Add(envelope);
            if (channel.Backlog.Count > BacklogCap)
            {
                channel.Backlog.RemoveAt(0);
            }
        }

        foreach (var sub in channel.Subscribers.Values)
        {
            sub.Writer.TryWrite(envelope);
        }
    }

    /// <summary>
    /// 訂閱指定畫布的事件流。若帶 <paramref name="afterSeq"/>，先補播序號較大的 backlog，再續傳即時事件。
    /// </summary>
    public async IAsyncEnumerable<SseEnvelope> SubscribeAsync(
        string canvasId, int afterSeq = 0, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var channel = GetChannel(canvasId);
        var queue = Channel.CreateUnbounded<SseEnvelope>();
        var id = Guid.NewGuid();

        List<SseEnvelope> replay;
        lock (channel.Gate)
        {
            replay = channel.Backlog.Where(e => e.Seq > afterSeq).ToList();
            channel.Subscribers[id] = queue;
        }

        try
        {
            foreach (var evt in replay)
            {
                yield return evt;
            }

            await foreach (var evt in queue.Reader.ReadAllAsync(cancellationToken))
            {
                yield return evt;
            }
        }
        finally
        {
            channel.Subscribers.TryRemove(id, out _);
        }
    }
}
