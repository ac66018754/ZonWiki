using System.Collections.Concurrent;

namespace ZonWiki.Api.Services;

/// <summary>
/// 提問中止登記簿：登記提問對應的取消令牌源，便於使用者中途中斷 AI 串流。
/// </summary>
public sealed class AskCancellationRegistry
{
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _registry = new();

    /// <summary>
    /// 登記一個提問結果節點與其取消令牌源（通常在串流開始前）。
    /// </summary>
    public void Register(string nodeId, CancellationTokenSource cts)
    {
        _registry.TryAdd(nodeId, cts);
    }

    /// <summary>
    /// 取消指定節點的串流（若存在），並移除登記。
    /// </summary>
    public void Cancel(string nodeId)
    {
        if (_registry.TryRemove(nodeId, out var cts))
        {
            try
            {
                cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // CTS 可能已被 Dispose，忽略。
            }
        }
    }

    /// <summary>
    /// 嘗試取消指定節點的串流。若節點存在且成功取消，則回傳 true；否則回傳 false（冪等操作）。
    /// </summary>
    public bool TryCancel(string nodeId)
    {
        if (_registry.TryRemove(nodeId, out var cts))
        {
            try
            {
                cts.Cancel();
                return true;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }
        return false;
    }

    /// <summary>
    /// 移除登記（不取消，通常在串流完成時呼叫）。
    /// </summary>
    public void Unregister(string nodeId)
    {
        _registry.TryRemove(nodeId, out _);
    }
}
