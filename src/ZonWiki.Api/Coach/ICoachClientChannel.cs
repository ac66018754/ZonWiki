using System.Buffers;
using System.Net.WebSockets;
using System.Text;

namespace ZonWiki.Api.Coach;

/// <summary>
/// 「瀏覽器端連線」的抽象（收／送 JSON 文字訊框＋中止）。把真實 <see cref="WebSocket"/> 藏在此介面後，
/// 讓 <see cref="CoachProxyService"/> 的橋接邏輯可用可程式化的假通道做完整整合測試（不需真 WS 握手）。
///
/// 併發約定：<see cref="ReceiveAsync"/> 只由單一讀者（泵1）呼叫；<see cref="SendAsync"/> 只由 proxy 的
/// 單一寫出 Task 呼叫（【審修-A1】單寫者由 proxy 的送出佇列保證，故此介面實作本身不需再加鎖）。
/// </summary>
public interface ICoachClientChannel
{
    /// <summary>
    /// 收下一則文字訊框（累積至 EndOfMessage）。連線關閉／中止回 null。
    /// </summary>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>訊框 JSON 字串；關閉回 null。</returns>
    Task<string?> ReceiveAsync(CancellationToken cancellationToken);

    /// <summary>
    /// 送出一則文字訊框（原始送出；由 proxy 單一寫出 Task 序列化呼叫）。
    /// </summary>
    /// <param name="json">要送的 JSON 字串。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    Task SendAsync(string json, CancellationToken cancellationToken);

    /// <summary>立即中止底層連線（孤兒回收／踢舊／fatal 時用）。冪等。</summary>
    void Abort();
}

/// <summary>
/// <see cref="ICoachClientChannel"/> 的真實 WebSocket 實作：把瀏覽器 <see cref="WebSocket"/> 的
/// 收／送包成文字訊框 API。收訊累積至 EndOfMessage 並設上限（防惡意超大訊框）。
/// </summary>
public sealed class WebSocketCoachClientChannel : ICoachClientChannel
{
    /// <summary>收訊單次讀取緩衝（16KB；多段累積至 EndOfMessage）。</summary>
    private const int ReceiveChunkSize = 16 * 1024;

    /// <summary>單則瀏覽器訊框累積上限（1MB；超過即中止，防惡意超大 payload 撐爆記憶體）。</summary>
    private const int MaxFrameBytes = 1 * 1024 * 1024;

    private readonly WebSocket _socket;
    private int _aborted;

    /// <summary>
    /// 以既有的、已 Accept 的 WebSocket 建立通道。
    /// </summary>
    /// <param name="socket">瀏覽器 WebSocket（已由端點 AcceptWebSocketAsync）。</param>
    public WebSocketCoachClientChannel(WebSocket socket)
    {
        _socket = socket;
    }

    /// <inheritdoc />
    public async Task<string?> ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[ReceiveChunkSize];
        var accumulated = new ArrayBufferWriter<byte>();

        while (true)
        {
            WebSocketReceiveResult result;
            try
            {
                result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
            catch (WebSocketException)
            {
                // 傳輸層斷（瀏覽器強關等）：視為關閉。
                return null;
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            accumulated.Write(buffer.AsSpan(0, result.Count));
            if (accumulated.WrittenCount > MaxFrameBytes)
            {
                // 惡意超大訊框：中止連線並回關閉。
                Abort();
                return null;
            }

            if (result.EndOfMessage)
            {
                return Encoding.UTF8.GetString(accumulated.WrittenSpan);
            }
        }
    }

    /// <inheritdoc />
    public async Task SendAsync(string json, CancellationToken cancellationToken)
    {
        if (Volatile.Read(ref _aborted) == 1 || _socket.State != WebSocketState.Open)
        {
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(json);
        await _socket.SendAsync(
            new ArraySegment<byte>(bytes),
            WebSocketMessageType.Text,
            endOfMessage: true,
            cancellationToken);
    }

    /// <inheritdoc />
    public void Abort()
    {
        if (Interlocked.Exchange(ref _aborted, 1) == 1)
        {
            return;
        }

        try
        {
            _socket.Abort();
        }
        catch
        {
            // best-effort 中止。
        }
    }
}
