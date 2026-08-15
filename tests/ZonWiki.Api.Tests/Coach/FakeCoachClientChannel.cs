using System.Text.Json;
using System.Threading.Channels;
using ZonWiki.Api.Coach;

namespace ZonWiki.Api.Tests.Coach;

/// <summary>
/// <see cref="ICoachClientChannel"/> 的測試替身（假瀏覽器端）：測試可推入「瀏覽器→後端」訊框、
/// 讀回「後端→瀏覽器」已送出的訊框，並驗 Abort。
/// </summary>
public sealed class FakeCoachClientChannel : ICoachClientChannel
{
    private readonly Channel<string> _incoming =
        Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    private readonly List<string> _sent = new();
    private readonly object _sentLock = new();

    /// <summary>Abort 是否被呼叫。</summary>
    public bool Aborted { get; private set; }

    /// <summary>後端送給瀏覽器的所有訊框（JSON 字串）快照。</summary>
    public IReadOnlyList<string> Sent
    {
        get
        {
            lock (_sentLock)
            {
                return _sent.ToList();
            }
        }
    }

    /// <inheritdoc />
    public async Task<string?> ReceiveAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (await _incoming.Reader.WaitToReadAsync(cancellationToken))
            {
                if (_incoming.Reader.TryRead(out var frame))
                {
                    return frame;
                }
            }

            return null;
        }
        catch (OperationCanceledException)
        {
            return null;
        }
    }

    /// <inheritdoc />
    public Task SendAsync(string json, CancellationToken cancellationToken)
    {
        lock (_sentLock)
        {
            _sent.Add(json);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public void Abort()
    {
        Aborted = true;
        _incoming.Writer.TryComplete();
    }

    // ── 測試驅動 helper ───────────────────────────────────────────────────────────

    /// <summary>推一則「瀏覽器→後端」訊框。</summary>
    public void PushIncoming(string frame) => _incoming.Writer.TryWrite(frame);

    /// <summary>模擬瀏覽器正常關閉（後端泵1 收到 null → 收尾）。</summary>
    public void CloseIncoming() => _incoming.Writer.TryComplete();

    /// <summary>取出所有已送訊框中，符合指定 type 的解析結果。</summary>
    public IReadOnlyList<JsonElement> SentOfType(string type)
    {
        var result = new List<JsonElement>();
        foreach (var json in Sent)
        {
            var element = JsonSerializer.Deserialize<JsonElement>(json);
            if (element.TryGetProperty("type", out var t)
                && t.ValueKind == JsonValueKind.String
                && string.Equals(t.GetString(), type, StringComparison.Ordinal))
            {
                result.Add(element);
            }
        }

        return result;
    }

    /// <summary>是否曾送出某 type 的訊框。</summary>
    public bool HasSentType(string type) => SentOfType(type).Count > 0;
}
