using System.Threading.Channels;

namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// Vertex Live（BidiGenerateContent over WebSocket）的「單一連線」客戶端抽象（【審修-A3】職責邊界）。
///
/// 定位：只管「一條連線的生命週期」——連線、（單寫者）送出、收訊迴圈向上派發事件；
/// <b>自己不重連、不落地、不計費</b>（重連編排／逐字稿落地／計費斷路皆在 <c>CoachProxyService</c>）。
/// 重連＝上層透過 <see cref="ICoachLiveClientFactory"/> 建一顆新 client，故此介面才能被
/// FakeCoachLiveClientFactory 依序吐多顆假 client、供整合測試驗「第二顆 setup 帶 handle」。
///
/// 併發（【審修-A1】單寫者不變式）：所有 <c>Send*</c> 一律入內部序列化佇列，任一時刻只有一個未完成
/// SendAsync；並發呼叫多個 <c>Send*</c> 不得擲 <see cref="InvalidOperationException"/>。
/// 收訊為獨立單一讀者，事件經 <see cref="ServerEvents"/> 供上層消費。
/// </summary>
public interface ICoachLiveClient : IAsyncDisposable
{
    /// <summary>
    /// 伺服器事件串流（收訊迴圈的單一出口）。上層以 <c>await foreach</c> 消費；連線關閉時以
    /// <see cref="CoachClosedEvent"/> 收尾並 complete 此 channel。
    /// </summary>
    ChannelReader<CoachLiveServerEvent> ServerEvents { get; }

    /// <summary>
    /// 建立連線並送出 setup（送完不阻塞等待，setup 完成以 <see cref="CoachReadyEvent"/> 通知）。
    /// 握手時以 ADC token 當 Bearer；送 Bearer 前先斷言組出的 host 為 Vertex 官方 wss 端點（【審修-S6】）。
    /// </summary>
    /// <param name="setup">本場 setup 參數（systemInstruction）。</param>
    /// <param name="resumptionHandle">續連句柄（可空；<b>只由伺服器從 DB 取，絕不接受前端傳入</b>）。</param>
    /// <param name="cancellationToken">取消權杖（連線握手用）。</param>
    Task ConnectAsync(CoachLiveSetup setup, string? resumptionHandle, CancellationToken cancellationToken);

    /// <summary>送出一段上行音訊（16kHz PCM16 的 base64；入序列化佇列，非直接 SendAsync）。</summary>
    /// <param name="base64Pcm16">base64 編碼的 16kHz PCM16 片段。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    ValueTask SendAudioAsync(string base64Pcm16, CancellationToken cancellationToken);

    /// <summary>送出「手動 VAD 收尾」訊號（<c>realtimeInput.audioStreamEnd</c>）。</summary>
    /// <param name="cancellationToken">取消權杖。</param>
    ValueTask SendAudioStreamEndAsync(CancellationToken cancellationToken);

    /// <summary>送出一個文字回合（<c>clientContent</c>；供本機無麥克風 smoke／文字輸入）。</summary>
    /// <param name="text">使用者文字。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    ValueTask SendTextTurnAsync(string text, CancellationToken cancellationToken);

    /// <summary>回覆一個 Function Call（<c>toolResponse</c>；scheduling 決定何時回應，見 spec §3.5）。</summary>
    /// <param name="id">與 toolCall 相同的呼叫 Id。</param>
    /// <param name="name">函式名稱。</param>
    /// <param name="response">回覆內容物件（將序列化為 <c>response</c> 欄位）。</param>
    /// <param name="scheduling">排程（INTERRUPT／WHEN_IDLE／SILENT）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    ValueTask SendToolResponseAsync(
        string id,
        string name,
        object response,
        string scheduling,
        CancellationToken cancellationToken);

    /// <summary>
    /// 立即中止底層 WebSocket（<c>ClientWebSocket.Abort()</c>）。計費斷路／孤兒回收／踢舊時，
    /// 上層以此保證「真的斷 Vertex 連線」（【審修-S1/S2】計費斷路不變式的 send-side backstop）。
    /// 冪等，可重複呼叫。
    /// </summary>
    void Abort();
}

/// <summary>
/// <see cref="ICoachLiveClient"/> 的工廠（singleton）：每場、每次重連各 new 一顆新 client。
/// 測試以 FakeCoachLiveClientFactory 覆寫（可依序吐多顆假 client）。
/// </summary>
public interface ICoachLiveClientFactory
{
    /// <summary>建立一顆新的、尚未連線的 Live client。</summary>
    /// <returns>新的 client 實例。</returns>
    ICoachLiveClient Create();
}
