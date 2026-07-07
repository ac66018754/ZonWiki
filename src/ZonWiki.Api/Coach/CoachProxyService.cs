using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Coach;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Coach;

/// <summary>
/// 英文教練「瀏覽器 WS ↔ Vertex Live」橋接服務（其他功能群 Phase 3・批次 2，【全新】）。
///
/// 三條不變式落實：
/// - <b>單寫者（A1）</b>：對瀏覽器通道套「送出佇列＋單一寫出 Task」（封包／狀態／reconnecting／fatal 全入同佇列）；
///   Vertex 端由 <see cref="ICoachLiveClient"/> 自身保證單寫者。
/// - <b>短命 DbContext（A2）</b>：不把 scoped DbContext 吊在連線壽命上；所有 DB 寫入收斂到<b>單一消費者寫入佇列</b>，
///   每筆以 <see cref="IServiceScopeFactory"/> 開一個「短命 DI scope」取設定齊全的 scoped DbContext
///   （含稽核／使用者隔離／具現化攔截器），先 <c>SetCurrentUserId(userId)</c> 再首查，寫完即棄。
///   （刻意用短命 DI scope 而非 <c>CoachDbContextFactory</c>——後者無稽核／隔離攔截器、僅供全站計量表；
///   CoachMessage/CoachSession 為 IUserOwned，用齊全 scope 才能正確稽核並享 fail-closed 具現化防線。此為對計畫
///   「短命 context」意旨的忠實落實＋更安全的實作。收尾／摘要 SaveChanges 一律 <see cref="CancellationToken.None"/>。）
/// - <b>計費斷路必真 Abort（S1/S2）</b>：單場硬時長、日分鐘上限、全站花費熔斷任一到點，皆 <see cref="Terminate"/>
///   → 立即 <c>liveClient.Abort()</c>（真的斷 Vertex WS）＋落地摘要，不存在「只改 DB 而 Vertex 續開」的路徑。
///
/// 職責：主橋接雙泵、逐字稿落地、toolCall 兩函式、重連編排（單一真源）、孤兒／踢舊回收、課末摘要。
/// 生命週期：transient，由端點 child scope 解析一次；連線層只放非 DbContext 物件。
/// </summary>
public sealed class CoachProxyService
{
    // ── 全站踢舊登記（connectionId → proxy）───────────────────────────────────────
    // 端點原子搶佔併發槽後，若頂替了舊連線，據此令舊 proxy 立即釋放 Vertex 連線（【審修-A5】踢舊）。
    private static readonly ConcurrentDictionary<Guid, CoachProxyService> ActiveProxies = new();

    /// <summary>送往瀏覽器／落地的 JSON 序列化選項（camelCase、不寫 null；與前端協定一致）。</summary>
    private static readonly JsonSerializerOptions BrowserJsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    // ── 常數 ─────────────────────────────────────────────────────────────────────
    /// <summary>等待首個 setupComplete（Ready）的逾時。</summary>
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(30);

    /// <summary>計量／落地心跳週期（秒）：續扣 AccumulatedSeconds＋檢查日額度／全站花費。</summary>
    private const int MeterFlushSeconds = 15;

    /// <summary>孤兒偵測輪詢週期（秒）。</summary>
    private const int OrphanCheckSeconds = 5;

    /// <summary>補釋義背景任務的最大並發（有界佇列，防 2GB VM 記憶體壓力）。</summary>
    private const int MaxConcurrentEnrich = 2;

    /// <summary>單場 Function Call args 的長度上限（字元；超限回 rejected 不入庫，防 prompt-inject 撐爆）。</summary>
    private const int MaxToolArgChars = 2000;

    /// <summary>
    /// 單則入站文字回合的字元上限（與 <see cref="MaxToolArgChars"/> 對齊；超限即忽略該回合，
    /// 防單發超大 text 在預算熔斷前灌爆 Vertex token 造成花費尖峰）。
    /// </summary>
    private const int MaxInboundTextChars = 2000;

    /// <summary>
    /// 單塊入站音訊 base64 的字元上限。16k PCM16 的一般 worklet 塊約 5～6K 字元，此上限（約 4.6 秒音訊）
    /// 給足合法擷取的餘裕，同時擋掉單發 MB 級的超大 base64 灌爆（計費放大防護，與 text 上限同一設計意圖）。
    /// </summary>
    private const int MaxInboundAudioBase64Chars = 200_000;

    /// <summary>近期加字去重視窗：同一單字於此秒數內重複請求即略過（防語音 prompt-inject 放大計費）。</summary>
    private const int VocabDedupWindowSeconds = 60;

    /// <summary>終止原因：瀏覽器正常關閉（→ 前端進 ended 終態，非 fatal）。</summary>
    private const string ReasonClientClosed = "client_closed";

    /// <summary>終止原因：被同使用者的新連線頂替（踢舊）。此路徑<b>不得</b>收尾 session（新連線接手擁有它）。</summary>
    private const string ReasonDisplaced = "displaced";

    /// <summary>單次瀏覽器送出的逾時（防半開 TCP 讓 SendAsync 永久阻塞而卡死整場收尾）。</summary>
    private static readonly TimeSpan BrowserSendTimeout = TimeSpan.FromSeconds(10);

    /// <summary>收尾時等待送出／DB 佇列收攏的上限（逾時即放棄等待，保證 RunAsync 有界回傳、釋放併發槽）。</summary>
    private static readonly TimeSpan DrainTimeout = TimeSpan.FromSeconds(12);

    /// <summary>
    /// 收尾時等待背景補釋義任務收攏的上限。取值需 &gt;= 背景補釋義自身的內部時間預算（20s），確保「完成或自我
    /// 取消」的補釋義其計費寫入必在本場收尾前落地（不外溢污染跨場計量表）；逾時即放棄等待，保證 RunAsync 有界
    /// 回傳。此 join 排在通知瀏覽器 ended/fatal＋Abort 之後，故不影響使用者看到終態的延遲（見 <see cref="FinishAsync"/>）。
    /// </summary>
    private static readonly TimeSpan EnrichmentJoinTimeout = TimeSpan.FromSeconds(25);

    /// <summary>
    /// 全站「sessionId → 工具預算」（加字上限＋去重）。因 proxy 為 transient、每次（重）連新建一顆，
    /// 若把加字計數放實例欄位，攻擊者反覆重連即可重置上限；故以 sessionId 為鍵的<b>跨連線共享</b>狀態，
    /// 於 session 真正收尾（非踢舊）時移除。
    /// </summary>
    private static readonly ConcurrentDictionary<Guid, SessionToolBudget> SessionBudgets = new();

    private readonly ICoachLiveClientFactory _liveClientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly CoachBudgetService _budgetService;
    private readonly CoachOptions _options;
    private readonly ILogger<CoachProxyService> _logger;

    // ── 連線層狀態（非 DbContext；與連線等長）─────────────────────────────────────
    private readonly Channel<string> _browserOut =
        Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    private readonly Channel<Func<Task>> _dbWrites =
        Channel.CreateUnbounded<Func<Task>>(new UnboundedChannelOptions { SingleReader = true });

    private readonly SemaphoreSlim _enrichConcurrency = new(MaxConcurrentEnrich, MaxConcurrentEnrich);

    /// <summary>
    /// 已發出的背景補釋義任務（fire-and-forget）。<b>收尾時 join（有逾時）</b>——確保其（走全站共享
    /// <see cref="ZonWiki.Domain.Entities.CoachBudgetLedger"/> 的）計費寫入在本場 RunAsync 返回前落地，
    /// 不外溢到「本場之後」而污染跨場（跨測試）共享的計量表（【對抗復審-#8】flaky 來源）。
    /// 由 pump2（<see cref="HandleAddVocabularyAsync"/>）新增、<see cref="FinishAsync"/> 快照後 join；以鎖保護。
    /// </summary>
    private readonly List<Task> _enrichmentTasks = new();

    /// <summary>保護 <see cref="_enrichmentTasks"/> 的鎖（pump2 新增 vs. 收尾快照）。</summary>
    private readonly object _enrichmentTasksLock = new();

    private readonly object _clientLock = new();

    /// <summary>本場（跨連線共享）的工具預算，於 <see cref="RunAsync"/> 綁定。</summary>
    private SessionToolBudget _toolBudget = null!;

    /// <summary>最後已知續連句柄（記憶體權威；避免「排隊寫 DB 尚未落地」時重連讀到過期 handle）。</summary>
    private volatile string? _lastKnownHandle;

    private ICoachClientChannel _browser = null!;
    private ICoachLiveClient? _liveClient;
    private CancellationTokenSource _bridgeCts = null!;

    private Guid _userId;
    private Guid _sessionId;
    private Guid _connectionId;
    private string? _topic;
    private string _systemInstruction = string.Empty;
    private DateTime _sessionStartUtc;
    private int _accumulatedSecondsBaseline;

    private string? _terminationReason;
    private int _terminated;

    /// <summary>
    /// 被踢舊（displaced）時，頂替的新連線是否為<b>不同場次</b>（true＝跨場踢舊，舊場需正常收尾；
    /// false＝同場交棒或未知，沿用「不收尾」）。由 <see cref="SignalDisplaced"/> 在 <see cref="Terminate"/>
    /// 前寫入，<see cref="FinishAsync"/> 讀取；跨執行緒故 volatile。
    /// </summary>
    private volatile bool _displacedByDifferentSession;

    // 逐字稿累積（單一 vertex 泵存取，無跨執行緒競爭）。
    private readonly System.Text.StringBuilder _assistantTranscript = new();
    private readonly System.Text.StringBuilder _userTranscript = new();
    private readonly List<object> _pendingCorrections = new();
    private bool _interruptedThisTurn;
    private int _pendingApproxCut = -1; // -1＝無（跨執行緒以 Volatile 存取）。

    private long _lastBrowserActivityTicks;

    private Task? _browserWriterTask;
    private Task? _dbConsumerTask;

    /// <summary>
    /// 建立橋接服務。
    /// </summary>
    /// <param name="liveClientFactory">Live client 工廠（每場／每次重連 new 一顆）。</param>
    /// <param name="scopeFactory">DI scope 工廠（供每筆 DB 寫入開短命 scope）。</param>
    /// <param name="budgetService">全站花費熔斷計量器（singleton）。</param>
    /// <param name="options">教練子系統設定。</param>
    /// <param name="logger">記錄器。</param>
    public CoachProxyService(
        ICoachLiveClientFactory liveClientFactory,
        IServiceScopeFactory scopeFactory,
        CoachBudgetService budgetService,
        IOptions<CoachOptions> options,
        ILogger<CoachProxyService> logger)
    {
        _liveClientFactory = liveClientFactory;
        _scopeFactory = scopeFactory;
        _budgetService = budgetService;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// 令某連線的 proxy 立即釋放 Vertex 連線（踢舊時由端點呼叫）。找不到即無動作（可能已收尾）。
    ///
    /// 【對抗復審-#3 跨場踢舊】併發槽為 per-user，故「新連線」可能是<b>不同場次</b>（使用者在 A 場仍活著時
    /// 去連 B 場）。此時舊場 A 必須正常收尾（標 ended＋落地 AccumulatedSeconds＋移除本場工具預算），
    /// 否則 A 停在 active 直到 2 小時殭屍清掃，期間以 now 一路累加「幻影分鐘」吃掉使用者日額度（自我 DoS）、
    /// 且 SessionBudgets[A] 洩漏。故傳入新連線 sessionId，供舊 proxy 判斷是否為同場交棒。
    /// </summary>
    /// <param name="connectionId">要踢掉的舊連線 Id。</param>
    /// <param name="newSessionId">頂替的新連線所屬場次 Id（供判斷同場交棒／跨場踢舊）。</param>
    /// <returns>確有令其釋放時為 true。</returns>
    public static bool SignalDisplaced(Guid connectionId, Guid newSessionId)
    {
        if (ActiveProxies.TryGetValue(connectionId, out var proxy))
        {
            // 先寫旗標再 Terminate：新連線 sessionId 與舊 proxy 的場次不同 → 跨場踢舊，舊場仍需正常收尾。
            proxy._displacedByDifferentSession = proxy._sessionId != newSessionId;
            proxy.Terminate(ReasonDisplaced);
            return true;
        }

        return false;
    }

    /// <summary>
    /// 執行整場橋接直到結束（正常收尾／fatal／踢舊）。此方法回傳即代表本場已收尾（含落地摘要與通知前端）。
    /// </summary>
    /// <param name="browser">瀏覽器端通道（已 Accept 的 WS 或測試假通道）。</param>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="sessionId">本場 Id（端點已驗擁有權）。</param>
    /// <param name="connectionId">本次連線 Id（端點原子搶佔併發槽時產生）。</param>
    /// <param name="topic">本場主題（供 system prompt）。</param>
    /// <param name="startedUtc">開場時間（權威計量起點；端點自 DB 帶入）。</param>
    /// <param name="accumulatedSecondsBaseline">已累計秒數基準（續連場帶入）。</param>
    /// <param name="connectionCt">連線取消權杖（端點的 RequestAborted 或測試 CT）。</param>
    public async Task RunAsync(
        ICoachClientChannel browser,
        Guid userId,
        Guid sessionId,
        Guid connectionId,
        string? topic,
        DateTime startedUtc,
        int accumulatedSecondsBaseline,
        CancellationToken connectionCt)
    {
        _browser = browser;
        _userId = userId;
        _sessionId = sessionId;
        _connectionId = connectionId;
        _topic = topic;
        _sessionStartUtc = startedUtc;
        _accumulatedSecondsBaseline = accumulatedSecondsBaseline;
        _bridgeCts = CancellationTokenSource.CreateLinkedTokenSource(connectionCt);
        _toolBudget = SessionBudgets.GetOrAdd(sessionId, _ => new SessionToolBudget());
        MarkBrowserActivity();

        ActiveProxies[connectionId] = this;

        _browserWriterTask = Task.Run(BrowserWriterLoopAsync);
        _dbConsumerTask = Task.Run(DbWriteConsumerLoopAsync);

        try
        {
            // 【對抗復審-Finding3】搶佔併發槽（端點）與登記 ActiveProxies（此處，AcceptWebSocketAsync 之後）是
            // 兩個時點；若在本連線 accept 期間就被新連線頂替，端點的 SignalDisplaced 會撲空。自我核對：若併發槽
            // 已被「另一個」連線持有，代表 accept 期間已被頂替 → 立即以 displaced 自我終止（不收尾、真斷）。
            //（slot 為 null 表示未經端點搶佔——如直接驅動 proxy 的測試——則不自我終止。）
            var slotHolder = CoachSessionService.GetActiveConnection(userId);
            if (slotHolder is not null && slotHolder != connectionId)
            {
                // 【對抗復審-#8 accept 競態自我終止】無法從併發槽得知頂替者所屬場次（GetActiveConnection 只回
                // connectionId，非 sessionId），故保守當作「跨場踢舊」處理——標記 _displacedByDifferentSession=true，
                // 讓 FinishAsync 一律走完整收尾（FinalizeSessionAsync 標 ended＋落地 AccumulatedSeconds）並移除本場
                // 工具預算（SessionBudgets.TryRemove）。否則此路徑會維持 false → FinishAsync 誤判「同場交棒」而略過
                // 收尾 → 本場停在 active 直到 2 小時殭屍清掃、期間以 now 一路累加「幻影分鐘」吃掉日額度（自我 DoS），
                // 且 SessionBudgets[本場] 永久洩漏。FinalizeSessionAsync 以 s.Id==_sessionId 冪等更新，即使實為
                // 同場交棒、多收尾一次亦無害，遠優於「該收尾卻沒收尾」。
                _displacedByDifferentSession = true;
                Terminate(ReasonDisplaced);
                return;
            }

            // system prompt（短命 scope，明確 userId＋IgnoreQueryFilters）。
            _systemInstruction = await BuildSystemInstructionAsync();

            // 首次連線（帶 DB 內的續連句柄，若有）。
            var handle = await ReadResumptionHandleAsync();
            var connected = await TryConnectClientAsync(handle, _bridgeCts.Token);
            if (!connected)
            {
                Terminate("connect_failed");
                return;
            }

            EnqueueBrowser(new { type = "ready" });
            EnqueueBrowser(new { type = "state", state = "listening" });

            var pumpBrowser = PumpBrowserToVertexAsync();
            var pumpVertex = PumpVertexToBrowserAsync();
            var orphanWatch = OrphanWatchdogAsync();
            var meterWatch = MeteringWatchdogAsync();
            var durationWatch = MaxDurationWatchdogAsync();

            // 任一主泵結束（瀏覽器關／vertex 終結）即收束整場。
            await Task.WhenAny(pumpBrowser, pumpVertex);
            _bridgeCts.Cancel();

            await SafeAwait(pumpBrowser);
            await SafeAwait(pumpVertex);
            await SafeAwait(orphanWatch);
            await SafeAwait(meterWatch);
            await SafeAwait(durationWatch);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "教練橋接發生未預期錯誤（session={SessionId}）。", sessionId);
            Terminate("proxy_error");
        }
        finally
        {
            await FinishAsync();
            ActiveProxies.TryRemove(new KeyValuePair<Guid, CoachProxyService>(connectionId, this));
            _bridgeCts.Dispose();
        }
    }

    // ── 主橋接：泵1 瀏覽器→Vertex ─────────────────────────────────────────────────

    /// <summary>泵1：讀瀏覽器訊框並轉送 Vertex（audio／end／text／barge_in／ping）。</summary>
    private async Task PumpBrowserToVertexAsync()
    {
        var ct = _bridgeCts.Token;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var frame = await _browser.ReceiveAsync(ct);
                if (frame is null)
                {
                    // 瀏覽器關閉／中止 → 正常收尾（非 fatal）。
                    Terminate(ReasonClientClosed);
                    return;
                }

                MarkBrowserActivity();
                await HandleBrowserFrameAsync(frame, ct);
            }
        }
        catch (OperationCanceledException)
        {
            // 橋接結束。
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "教練泵1（瀏覽器→Vertex）例外。");
            Terminate("browser_pump_error");
        }
    }

    /// <summary>解析並處理單一瀏覽器訊框。</summary>
    private async Task HandleBrowserFrameAsync(string frame, CancellationToken ct)
    {
        string? type;
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(frame);
            root = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            // 壞訊框：忽略（不致命，不讓一個壞封包斷線）。
            return;
        }

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("type", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String)
        {
            return;
        }

        type = typeElement.GetString();
        var client = CurrentClient;
        if (client is null)
        {
            return;
        }

        switch (type)
        {
            case "audio":
                if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.String)
                {
                    var audioBase64 = data.GetString()!;
                    // 入站計費放大防護：超大單塊 base64 直接忽略（不轉給 Vertex），與 toolCall args 上限同設計。
                    if (audioBase64.Length > MaxInboundAudioBase64Chars)
                    {
                        _logger.LogWarning(
                            "教練入站音訊塊過大（{Length} 字元 > 上限 {Max}），忽略（session={SessionId}）。",
                            audioBase64.Length, MaxInboundAudioBase64Chars, _sessionId);
                        // 【對抗復審-#8】不可靜默丟棄：回一個瀏覽器可辨識的 rejected 訊框，讓前端撥回 listening
                        // 並提示使用者，否則使用者無從得知該片段被丟棄（前端 UI 可能停在 thinking／無回饋）。
                        EnqueueBrowser(new { type = "rejected", reason = "audio_too_large" });
                        break;
                    }

                    await client.SendAudioAsync(audioBase64, ct);
                }

                break;

            case "end":
                EnqueueBrowser(new { type = "state", state = "thinking" });
                await client.SendAudioStreamEndAsync(ct);
                break;

            case "text":
                // 本機無麥克風 smoke／文字輸入：走文字回合。
                if (root.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                {
                    var value = text.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        // 入站計費放大防護：超長單則文字回合直接忽略，與 toolCall args 上限對齊。
                        if (value.Length > MaxInboundTextChars)
                        {
                            _logger.LogWarning(
                                "教練入站文字回合過長（{Length} 字元 > 上限 {Max}），忽略（session={SessionId}）。",
                                value.Length, MaxInboundTextChars, _sessionId);
                            // 【對抗復審-#8】不可靜默丟棄：前端 sendText 送出當下已樂觀顯示 user 氣泡並轉 thinking，
                            // 若後端只記 log 就 break，前端會永久卡在 thinking、AI 永不回覆、也無錯誤提示。回一個
                            // rejected 訊框讓前端撥回 listening 並提示「訊息過長，請縮短再試」。
                            EnqueueBrowser(new { type = "rejected", reason = "text_too_long" });
                            break;
                        }

                        EnqueueBrowser(new { type = "state", state = "thinking" });
                        await client.SendTextTurnAsync(value, ct);
                    }
                }

                break;

            case "barge_in":
                // 前端回報近似截點（barge-in 落地用；不宣稱精準對齊）。此欄由泵1（此處）寫、泵2（落地）讀，
                // 兩條執行緒 → 以 Volatile 存取（比照 _lastBrowserActivityTicks）。
                if (root.TryGetProperty("approxCutChars", out var cut) && cut.ValueKind == JsonValueKind.Number
                    && cut.TryGetInt32(out var cutChars))
                {
                    Volatile.Write(ref _pendingApproxCut, cutChars);
                }

                break;

            case "ping":
                EnqueueBrowser(new { type = "pong" });
                break;

            default:
                // 未知型別：忽略。
                break;
        }
    }

    // ── 主橋接：泵2 Vertex→瀏覽器（含重連編排單一真源）──────────────────────────────

    /// <summary>泵2：消費 Vertex 事件並轉送前端；GoAway／非 fatal 斷線就地重連（單一真源）。</summary>
    private async Task PumpVertexToBrowserAsync()
    {
        var ct = _bridgeCts.Token;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var client = CurrentClient;
                if (client is null)
                {
                    return;
                }

                var shouldReconnect = false;
                await foreach (var serverEvent in client.ServerEvents.ReadAllAsync(ct))
                {
                    if (await HandleServerEventAsync(serverEvent, ct))
                    {
                        // 事件要求重連（GoAway／非 fatal 關）。
                        shouldReconnect = true;
                        break;
                    }
                }

                if (ct.IsCancellationRequested)
                {
                    return;
                }

                if (shouldReconnect)
                {
                    var reconnected = await ReconnectAsync(ct);
                    if (!reconnected)
                    {
                        Terminate("reconnect_exhausted");
                        return;
                    }

                    // 用新 client 續泵。
                    continue;
                }

                // 事件串流自然結束且非重連情形：視為結束。
                if (Volatile.Read(ref _terminated) == 0)
                {
                    Terminate("vertex_stream_ended");
                }

                return;
            }
        }
        catch (OperationCanceledException)
        {
            // 橋接結束。
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "教練泵2（Vertex→瀏覽器）例外。");
            Terminate("vertex_pump_error");
        }
    }

    /// <summary>
    /// 處理單一 Vertex 事件。回傳 true 表示「需重連」（GoAway／非 fatal 關），由泵2 統一編排重連。
    /// </summary>
    private async Task<bool> HandleServerEventAsync(CoachLiveServerEvent serverEvent, CancellationToken ct)
    {
        switch (serverEvent)
        {
            case CoachReadyEvent:
                EnqueueBrowser(new { type = "state", state = "listening" });
                return false;

            case CoachAudioOutEvent audio:
                EnqueueBrowser(new { type = "state", state = "speaking" });
                EnqueueBrowser(new { type = "audio", data = audio.Base64Pcm24 });
                return false;

            case CoachAssistantTranscriptEvent assistant:
                _assistantTranscript.Append(assistant.Text);
                EnqueueBrowser(new { type = "transcript", role = "assistant", text = assistant.Text, final = false });
                return false;

            case CoachUserTranscriptEvent user:
                _userTranscript.Append(user.Text);
                EnqueueBrowser(new { type = "transcript", role = "user", text = user.Text, final = false });
                return false;

            case CoachInterruptedEvent:
                _interruptedThisTurn = true;
                EnqueueBrowser(new { type = "interrupted" });
                return false;

            case CoachGenerationCompleteEvent:
                return false;

            case CoachTurnCompleteEvent:
                LandTurnTranscripts();
                // 明確的回合定案訊號：前端據此把待定的 AI 逐字定案成一則氣泡（文字／無麥克風模式多回合分泡，
                // 且語音模式使用者停止前的最後一則 assistant 也能定案）。assistant 逐字恆 final:false，故需此獨立訊號。
                EnqueueBrowser(new { type = "turn_end" });
                EnqueueBrowser(new { type = "state", state = "listening" });
                return false;

            case CoachToolCallEvent toolCall:
                await HandleToolCallsAsync(toolCall.Calls, ct);
                return false;

            case CoachToolCancelEvent:
                return false;

            case CoachSessionResumptionUpdateEvent resumption:
                if (resumption.Resumable && !string.IsNullOrEmpty(resumption.NewHandle))
                {
                    PersistResumptionHandle(resumption.NewHandle!);
                }

                return false;

            case CoachUsageMeteredEvent usage:
                // 全站花費累計（budgetService 內部走短命 context＋伺服器端原子遞增，執行緒安全）＋即時熔斷檢查：
                // 【審修-S1/S2】不只每 15s 檢查——本則 usage 累計後立刻檢查是否跨過門檻，跨過即真斷（非只擋下次）。
                await _budgetService.AccumulateAsync(usage.TotalTokens, CancellationToken.None);
                if (await _budgetService.IsOverBudgetAsync(CancellationToken.None))
                {
                    _logger.LogWarning("教練計費斷路：全站花費熔斷（usage 觸發），中止連線（session={SessionId}）。", _sessionId);
                    Terminate("budget");
                }

                return false;

            case CoachGoAwayEvent:
                return true; // 需重連。

            case CoachClosedEvent closed:
                if (closed.Fatal)
                {
                    Terminate(closed.Reason ?? "vertex_fatal");
                    return false;
                }

                return true; // 非 fatal 傳輸斷 → 需重連。

            default:
                return false;
        }
    }

    /// <summary>把本回合累積的 user／assistant 逐字稿落地為 CoachMessage（含 barge-in 旗標與糾錯卡）。</summary>
    private void LandTurnTranscripts()
    {
        var userText = _userTranscript.ToString();
        var assistantText = _assistantTranscript.ToString();
        var interrupted = _interruptedThisTurn;
        var cutRaw = Volatile.Read(ref _pendingApproxCut);
        int? approxCut = cutRaw >= 0 ? cutRaw : null;
        var corrections = _pendingCorrections.Count > 0 ? new List<object>(_pendingCorrections) : null;

        // 重置本回合累積。
        _userTranscript.Clear();
        _assistantTranscript.Clear();
        _pendingCorrections.Clear();
        _interruptedThisTurn = false;
        Volatile.Write(ref _pendingApproxCut, -1);

        if (!string.IsNullOrWhiteSpace(userText))
        {
            EnqueueDbWrite(() => WriteTranscriptAsync(
                CoachMessage.RoleUser, userText, interrupted: false, approxCut: null, correctionJson: null));
        }

        var correctionJson = corrections is null
            ? null
            : JsonSerializer.Serialize(corrections, BrowserJsonOptions);

        if (!string.IsNullOrWhiteSpace(assistantText) || correctionJson is not null)
        {
            EnqueueDbWrite(() => WriteTranscriptAsync(
                CoachMessage.RoleAssistant,
                string.IsNullOrEmpty(assistantText) ? "(correction)" : assistantText,
                interrupted,
                interrupted ? approxCut : null,
                correctionJson));
        }
    }

    /// <summary>
    /// 收尾時把「尚未 turnComplete」的當前回合逐字稿強制落地（【對抗復審-#5】）。
    /// 因這是非正常回合結束（被熔斷／時長／孤兒／關線打斷），以 interrupted 標記落地。
    /// 只在確有累積時才動作（避免空回合寫入）；<b>呼叫端須保證泵已停止</b>（見 <see cref="FinishAsync"/> 註解）。
    /// </summary>
    private void FlushPendingTranscriptsOnFinish()
    {
        if (_userTranscript.Length == 0 && _assistantTranscript.Length == 0 && _pendingCorrections.Count == 0)
        {
            return;
        }

        // 標記中斷：被強制終止的當前回合視為未完成／被打斷。
        _interruptedThisTurn = true;
        LandTurnTranscripts();
    }

    // ── toolCall 兩函式 ───────────────────────────────────────────────────────────

    /// <summary>處理一則 toolCall 的所有 Function Call（先驗長度→分派 add_vocabulary／show_correction）。</summary>
    private async Task HandleToolCallsAsync(IReadOnlyList<CoachToolCall> calls, CancellationToken ct)
    {
        var client = CurrentClient;
        if (client is null)
        {
            return;
        }

        foreach (var call in calls)
        {
            // 先驗 args 長度（超限回 rejected 不入庫，防背景 SaveChanges 丟例外被吞）。
            if (call.ArgumentsJson.Length > MaxToolArgChars)
            {
                await client.SendToolResponseAsync(
                    call.Id, call.Name, new { result = "rejected", reason = "arguments too long" }, "WHEN_IDLE", ct);
                continue;
            }

            JsonElement args;
            try
            {
                using var document = JsonDocument.Parse(call.ArgumentsJson);
                args = document.RootElement.Clone();
            }
            catch (JsonException)
            {
                await client.SendToolResponseAsync(
                    call.Id, call.Name, new { result = "rejected", reason = "invalid arguments" }, "WHEN_IDLE", ct);
                continue;
            }

            switch (call.Name)
            {
                case "add_vocabulary":
                    await HandleAddVocabularyAsync(client, call.Id, args, ct);
                    break;

                case "show_correction":
                    await HandleShowCorrectionAsync(client, call.Id, args, ct);
                    break;

                default:
                    await client.SendToolResponseAsync(
                        call.Id, call.Name, new { result = "rejected", reason = "unknown function" }, "WHEN_IDLE", ct);
                    break;
            }
        }
    }

    /// <summary>add_vocabulary：上限＋去重→upsert→設來源場次→背景補釋義（有界）→toolResponse→通知前端。</summary>
    private async Task HandleAddVocabularyAsync(
        ICoachLiveClient client,
        string callId,
        JsonElement args,
        CancellationToken ct)
    {
        var word = ReadStringArg(args, "word");
        if (string.IsNullOrWhiteSpace(word))
        {
            await client.SendToolResponseAsync(
                callId, "add_vocabulary", new { result = "rejected", reason = "missing word" }, "WHEN_IDLE", ct);
            return;
        }

        var normalized = VocabularyService.NormalizeWord(word);

        // 短時去重／防抖（跨連線共享；防語音 prompt-inject 放大計費、反覆重連重置）。
        if (_toolBudget.IsRecentDuplicate(normalized, VocabDedupWindowSeconds))
        {
            await client.SendToolResponseAsync(
                callId, "add_vocabulary", new { result = "duplicate", word = normalized }, "WHEN_IDLE", ct);
            return;
        }

        // 每場加字上限（原子保留一個名額；跨連線共享，重連不重置）。
        if (!_toolBudget.TryReserveVocabSlot(_options.MaxVocabAddsPerSession))
        {
            await client.SendToolResponseAsync(
                callId, "add_vocabulary", new { result = "rejected", reason = "session vocab limit reached" }, "WHEN_IDLE", ct);
            return;
        }

        _toolBudget.MarkVocab(normalized);

        // upsert（word 永不丟失）＋設來源場次——以短命 scope 立即完成。
        try
        {
            await WithUserScopeAsync(async provider =>
            {
                var vocabularyService = provider.GetRequiredService<VocabularyService>();
                var upsert = await vocabularyService.UpsertAsync(_userId, normalized, CancellationToken.None);
                if (upsert.Word.SourceCoachSessionId is null)
                {
                    upsert.Word.SourceCoachSessionId = _sessionId;
                    upsert.Word.UpdatedUser = _userId.ToString();
                    await provider.GetRequiredService<ZonWikiDbContext>().SaveChangesAsync(CancellationToken.None);
                }

                return 0;
            });
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "教練 add_vocabulary 入庫失敗（word={Word}）。", normalized);
            await client.SendToolResponseAsync(
                callId, "add_vocabulary", new { result = "error", reason = "save failed" }, "WHEN_IDLE", ct);
            return;
        }

        // 背景補釋義（有界並發，best-effort；不阻塞 toolResponse）。追蹤此任務以便收尾時 join——確保其
        // （走全站共享計量表的）計費寫入在本場 RunAsync 返回前落地，不外溢污染其它場次／測試（【對抗復審-#8】）。
        var contextSentence = ReadStringArg(args, "context_sentence");
        var enrichTask = EnrichVocabularyInBackgroundAsync(normalized, contextSentence);
        lock (_enrichmentTasksLock)
        {
            _enrichmentTasks.Add(enrichTask);
        }

        await client.SendToolResponseAsync(
            callId, "add_vocabulary", new { result = "ok", word = normalized }, "WHEN_IDLE", ct);
        EnqueueBrowser(new { type = "vocab_added", word = normalized });
    }

    /// <summary>show_correction：組 CorrectionJson→掛入本回合待落地→toolResponse→通知前端。</summary>
    private async Task HandleShowCorrectionAsync(
        ICoachLiveClient client,
        string callId,
        JsonElement args,
        CancellationToken ct)
    {
        var original = ReadStringArg(args, "original");
        var corrected = ReadStringArg(args, "corrected");
        if (string.IsNullOrWhiteSpace(original) || string.IsNullOrWhiteSpace(corrected))
        {
            await client.SendToolResponseAsync(
                callId, "show_correction", new { result = "rejected", reason = "missing fields" }, "WHEN_IDLE", ct);
            return;
        }

        var correction = new
        {
            original,
            corrected,
            explanationZh = ReadStringArg(args, "explanation_zh"),
            betterVersion = ReadStringArg(args, "better_version"),
        };

        // 掛入本回合待落地（turnComplete 時寫入 assistant CoachMessage 的 CorrectionJson）。
        _pendingCorrections.Add(correction);

        await client.SendToolResponseAsync(callId, "show_correction", new { result = "ok" }, "WHEN_IDLE", ct);
        EnqueueBrowser(new { type = "correction", correction });
    }

    /// <summary>背景補釋義（有界並發；用自己的短命 scope，錯誤只記錄不影響對話）。</summary>
    private async Task EnrichVocabularyInBackgroundAsync(string word, string? contextSentence)
    {
        if (!await _enrichConcurrency.WaitAsync(TimeSpan.FromSeconds(2)))
        {
            // 併發已滿：略過補釋義（word 已入庫，非必要）。
            return;
        }

        try
        {
            await WithUserScopeAsync(async provider =>
            {
                var enrichment = provider.GetRequiredService<VocabularyEnrichmentService>();
                var db = provider.GetRequiredService<ZonWikiDbContext>();

                using var budgetCts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var outcome = await enrichment.EnrichAsync(_userId, word, contextSentence, budgetCts.Token);
                if (!outcome.Success)
                {
                    return 0;
                }

                // 【對抗復審-計費盲點】背景補釋義也走 Vertex 文字串流，其 token 未經 Live usageMetadata 回報；
                // 以輸入（word＋context）與輸出（釋義各欄）字元數粗估後餵入全站花費熔斷計量器。
                await AccumulateEstimatedTokensAsync(
                    "vocab_enrich",
                    word,
                    contextSentence,
                    outcome.Phonetic,
                    outcome.PartOfSpeech,
                    outcome.DefinitionEn,
                    outcome.DefinitionZh,
                    outcome.ExampleSentence);

                var card = await db.VocabularyWord.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(v => v.UserId == _userId && v.Word == word && v.ValidFlag, budgetCts.Token);
                if (card is null)
                {
                    return 0;
                }

                var changed = ApplyEnrichment(card, outcome);
                if (changed)
                {
                    card.UpdatedUser = _userId.ToString();
                    await db.SaveChangesAsync(CancellationToken.None);
                }

                return 0;
            });
        }
        catch (Exception exception)
        {
            _logger.LogInformation(exception, "教練 add_vocabulary 背景補釋義失敗（word={Word}），略過。", word);
        }
        finally
        {
            _enrichConcurrency.Release();
        }
    }

    /// <summary>只填「原本為空」的釋義欄（不覆蓋既有）；回是否有變更。</summary>
    private static bool ApplyEnrichment(VocabularyWord card, VocabularyEnrichmentOutcome outcome)
    {
        const int maxPhonetic = 128;
        const int maxPartOfSpeech = 64;
        var changed = false;

        if (string.IsNullOrWhiteSpace(card.Phonetic)
            && !string.IsNullOrWhiteSpace(outcome.Phonetic)
            && outcome.Phonetic.Length <= maxPhonetic)
        {
            card.Phonetic = outcome.Phonetic;
            changed = true;
        }

        if (string.IsNullOrWhiteSpace(card.PartOfSpeech)
            && !string.IsNullOrWhiteSpace(outcome.PartOfSpeech)
            && outcome.PartOfSpeech.Length <= maxPartOfSpeech)
        {
            card.PartOfSpeech = outcome.PartOfSpeech;
            changed = true;
        }

        if (string.IsNullOrWhiteSpace(card.DefinitionEn) && !string.IsNullOrWhiteSpace(outcome.DefinitionEn))
        {
            card.DefinitionEn = outcome.DefinitionEn;
            changed = true;
        }

        if (string.IsNullOrWhiteSpace(card.DefinitionZh) && !string.IsNullOrWhiteSpace(outcome.DefinitionZh))
        {
            card.DefinitionZh = outcome.DefinitionZh;
            changed = true;
        }

        if (string.IsNullOrWhiteSpace(card.ExampleSentence) && !string.IsNullOrWhiteSpace(outcome.ExampleSentence))
        {
            card.ExampleSentence = outcome.ExampleSentence;
            changed = true;
        }

        return changed;
    }

    // ── 重連編排（單一真源）───────────────────────────────────────────────────────

    /// <summary>收 GoAway／非 fatal 斷→推 reconnecting→指數退避取新 token+新 client→setup 帶 DB 內 handle。</summary>
    private async Task<bool> ReconnectAsync(CancellationToken ct)
    {
        if (Volatile.Read(ref _terminated) == 1)
        {
            return false;
        }

        // 只送 {type:"reconnecting"}（前端據此進 reconnecting 呈現）。不再另送 {type:"state",state:"reconnecting"}——
        // 前端 CoachServerState 只認 listening/thinking/speaking，該訊框恆被丟棄，是死碼（【對抗復審-#1】移除）。
        EnqueueBrowser(new { type = "reconnecting" });
        await DisposeCurrentClientAsync();

        for (var attempt = 0; attempt < _options.MaxReconnectAttempts; attempt++)
        {
            try
            {
                var delayMs = _options.ReconnectBaseMs * (int)Math.Pow(2, attempt);
                await Task.Delay(delayMs, ct);
            }
            catch (OperationCanceledException)
            {
                return false;
            }

            // handle 只由伺服器從 DB 取（絕不接受前端傳入）。
            var handle = await ReadResumptionHandleAsync();
            if (await TryConnectClientAsync(handle, ct))
            {
                // Ready 已於握手時被 WaitForReadyAsync 消費，重連成功後明確回報前端恢復聆聽。
                EnqueueBrowser(new { type = "state", state = "listening" });
                return true;
            }
        }

        return false;
    }

    /// <summary>建一顆新 client 並連線（setup 帶 systemInstruction＋handle）。失敗回 false。</summary>
    private async Task<bool> TryConnectClientAsync(string? handle, CancellationToken ct)
    {
        var client = _liveClientFactory.Create();
        try
        {
            await client.ConnectAsync(new CoachLiveSetup(_systemInstruction), handle, ct);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "教練 Live 連線失敗（session={SessionId}）。", _sessionId);
            await client.DisposeAsync();
            return false;
        }

        lock (_clientLock)
        {
            _liveClient = client;
        }

        // 等 Ready（setupComplete），逾時視為失敗。
        var ready = await WaitForReadyAsync(client, ct);
        if (!ready)
        {
            await DisposeCurrentClientAsync();
            return false;
        }

        return true;
    }

    /// <summary>
    /// 等待新 client 的第一個 Ready 事件（逾時回 false）。消費掉 Ready（及理論上不會有的 setup 前事件）；
    /// Ready 只是握手完成訊號，被消費不影響後續逐字稿／音訊（那些仍排在事件通道內供泵讀）。收到 Closed 回 false。
    /// </summary>
    private static async Task<bool> WaitForReadyAsync(ICoachLiveClient client, CancellationToken ct)
    {
        using var timeoutCts = new CancellationTokenSource(ReadyTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        try
        {
            while (await client.ServerEvents.WaitToReadAsync(linked.Token))
            {
                while (client.ServerEvents.TryRead(out var next))
                {
                    switch (next)
                    {
                        case CoachReadyEvent:
                            return true;
                        case CoachClosedEvent:
                            return false;
                        default:
                            // setup 前的其它事件（理論上不會有）：略過。
                            break;
                    }
                }
            }

            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    // ── 監看：孤兒／計費／單場硬時長 ───────────────────────────────────────────────

    /// <summary>孤兒回收：瀏覽器逾 <see cref="CoachOptions.OrphanGraceSeconds"/> 無任何活動→真的 Abort＋收尾。</summary>
    private async Task OrphanWatchdogAsync()
    {
        var ct = _bridgeCts.Token;
        // 檢查週期最多等於寬限秒數（且至少 1s），確保小寬限（如測試）也能及時偵測。
        var checkSeconds = Math.Max(1, Math.Min(OrphanCheckSeconds, _options.OrphanGraceSeconds));
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(checkSeconds), ct);
                var idleSeconds = (DateTime.UtcNow - LastBrowserActivity).TotalSeconds;
                if (idleSeconds > _options.OrphanGraceSeconds)
                {
                    _logger.LogInformation(
                        "教練孤兒回收：瀏覽器閒置 {Idle}s（>寬限 {Grace}s），中止連線。",
                        (int)idleSeconds, _options.OrphanGraceSeconds);
                    Terminate("orphan");
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // 橋接結束。
        }
    }

    /// <summary>計費心跳：每 N 秒續扣 AccumulatedSeconds 落地＋檢查日額度／全站花費，跨門檻→真斷。</summary>
    private async Task MeteringWatchdogAsync()
    {
        var ct = _bridgeCts.Token;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(MeterFlushSeconds), ct);

                var elapsed = (int)(DateTime.UtcNow - _sessionStartUtc).TotalSeconds;
                var accumulated = _accumulatedSecondsBaseline + Math.Max(0, elapsed);
                await FlushAccumulatedSecondsAsync(accumulated);

                if (await IsDailyLimitReachedAsync())
                {
                    _logger.LogInformation("教練計費斷路：日分鐘上限已達，中止連線（session={SessionId}）。", _sessionId);
                    Terminate("daily_limit");
                    return;
                }

                if (await _budgetService.IsOverBudgetAsync(CancellationToken.None))
                {
                    _logger.LogWarning("教練計費斷路：全站花費熔斷，中止連線（session={SessionId}）。", _sessionId);
                    Terminate("budget");
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // 橋接結束。
        }
    }

    /// <summary>單場絕對時長硬上限（send-side backstop）：到點主動 Abort＋落地摘要。</summary>
    private async Task MaxDurationWatchdogAsync()
    {
        if (_options.MaxSessionMinutes <= 0)
        {
            return;
        }

        var ct = _bridgeCts.Token;
        var hardEnd = _sessionStartUtc.AddMinutes(_options.MaxSessionMinutes);
        var remaining = hardEnd - DateTime.UtcNow;
        if (remaining <= TimeSpan.Zero)
        {
            Terminate("max_session");
            return;
        }

        try
        {
            await Task.Delay(remaining, ct);
            _logger.LogInformation("教練計費斷路：單場硬時長 {Max} 分到點，中止連線。", _options.MaxSessionMinutes);
            Terminate("max_session");
        }
        catch (OperationCanceledException)
        {
            // 橋接提前結束。
        }
    }

    // ── 收尾 ─────────────────────────────────────────────────────────────────────

    /// <summary>設定終止原因並真正斷線（S1/S2：立即 Abort Vertex WS）；冪等。</summary>
    private void Terminate(string reason)
    {
        if (Interlocked.Exchange(ref _terminated, 1) == 1)
        {
            return;
        }

        _terminationReason = reason;

        // 【審修-S1/S2】立即真斷 Vertex WS（不只改 DB）。
        lock (_clientLock)
        {
            try
            {
                _liveClient?.Abort();
            }
            catch
            {
                // best-effort。
            }
        }

        try
        {
            _bridgeCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // 已釋放。
        }
    }

    /// <summary>整場收尾：確保 Abort→落地 AccumulatedSeconds/ended/摘要→通知前端→關閉通道與 client。</summary>
    private async Task FinishAsync()
    {
        // 保證終止（若非由 Terminate 觸發，例如例外路徑）。
        if (Volatile.Read(ref _terminated) == 0)
        {
            Terminate(_terminationReason ?? ReasonClientClosed);
        }

        // 【審修-S1/S2】確保 Vertex WS 已真斷。
        await DisposeCurrentClientAsync();

        // 【對抗復審-#5】強制終止（budget／max_session／orphan／daily_limit／client_closed）時，把「尚未 turnComplete」
        // 的當前回合逐字稿落地，否則最後一段對話會被直接丟棄（不進 DB、課末摘要與歷史重播都缺這段）。
        // 執行緒安全前提：此處兩泵已於 RunAsync 收束（await 過），且上方 DisposeCurrentClientAsync 已 Abort client，
        // 故 StringBuilder 不再有泵2 併發存取；必須排在 _dbWrites.TryComplete() 之前，落地寫入才會被排空。
        FlushPendingTranscriptsOnFinish();

        // 先排空 DB 寫入佇列（讓本場所有逐字稿／handle／花費落地）——摘要才看得到完整逐字稿。
        // 逾時保底：即使某筆寫入卡住也放棄等待，保證收尾有界回傳、釋放併發槽。
        _dbWrites.Writer.TryComplete();
        await SafeAwait(_dbConsumerTask, DrainTimeout);

        var reason = _terminationReason ?? ReasonClientClosed;
        var displaced = string.Equals(reason, ReasonDisplaced, StringComparison.Ordinal);

        // 【對抗復審-#3】只有「同場交棒」（新連線接手同一 session）才略過收尾——新連線已擁有它，
        // 舊 proxy 收尾會把仍在進行的 session 標 ended、覆寫 handle／摘要，害了新連線。
        // 「跨場踢舊」（新連線是不同場次）與其餘所有終止原因，都必須真正收尾＋移除本場工具預算
        // （避免舊場停在 active 吃幻影分鐘、SessionBudgets 洩漏）。
        var sameSessionHandoff = displaced && !_displacedByDifferentSession;
        if (!sameSessionHandoff)
        {
            var elapsed = (int)(DateTime.UtcNow - _sessionStartUtc).TotalSeconds;
            var accumulated = _accumulatedSecondsBaseline + Math.Max(0, elapsed);
            try
            {
                await FinalizeSessionAsync(accumulated);
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "教練收尾落地失敗（session={SessionId}）。", _sessionId);
            }

            SessionBudgets.TryRemove(_sessionId, out _);
        }

        // 通知前端（正常關→ended；其餘→fatal 終態），再收束送出佇列並等前端把 ended/fatal 送出後才 Abort 瀏覽器。
        if (string.Equals(reason, ReasonClientClosed, StringComparison.Ordinal))
        {
            EnqueueBrowser(new { type = "ended" });
        }
        else
        {
            EnqueueBrowser(new { type = "fatal", reason });
        }

        _browserOut.Writer.TryComplete();
        // 逾時保底：半開 TCP 下寫出迴圈可能仍卡在最後一則 SendAsync，逾時即放棄等待（socket 稍後由 Abort 收）。
        await SafeAwait(_browserWriterTask, DrainTimeout);
        _browser.Abort();

        // 【對抗復審-#8】最後才 join 已發出的背景補釋義任務（有逾時）。刻意排在通知瀏覽器 ended/fatal＋Abort
        // 之後，故不延遲使用者看到終態；目的僅是把「背景補釋義走全站共享計量表的計費寫入」收攏在本場 RunAsync
        // 返回前落地，避免它在本場結束後才寫入而污染跨場（跨測試）共享的 CoachBudgetLedger（flaky 來源）。
        await JoinBackgroundEnrichmentAsync();
    }

    /// <summary>
    /// 收尾時 join 所有已發出的背景補釋義任務（有逾時保底）。<see cref="EnrichVocabularyInBackgroundAsync"/>
    /// 內部已吞掉所有例外（含取消），故此處等待不會拋；逾時即放棄等待（不可讓卡住的背景任務永久拖住收尾）。
    /// </summary>
    private async Task JoinBackgroundEnrichmentAsync()
    {
        Task[] pending;
        lock (_enrichmentTasksLock)
        {
            pending = _enrichmentTasks.ToArray();
        }

        if (pending.Length == 0)
        {
            return;
        }

        await SafeAwait(Task.WhenAll(pending), EnrichmentJoinTimeout);
    }

    /// <summary>落地最終狀態＋生成課末摘要（VertexAdc，查不到共用列時降級不 throw）。</summary>
    private async Task FinalizeSessionAsync(int accumulatedSeconds)
    {
        await WithUserScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<ZonWikiDbContext>();

            // 【對抗復審】先「快速」把 Status 翻 ended（在慢速摘要生成之前），把「已收尾卻仍讀為 active」的視窗
            // 縮到近乎零——避免摘要生成期間有並發新連線通過端點的擁有權/狀態檢查而接手一個正在收尾的 session。
            var now = DateTime.UtcNow;
            await db.CoachSession.IgnoreQueryFilters()
                .Where(s => s.Id == _sessionId && s.UserId == _userId && s.ValidFlag)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(s => s.Status, CoachSession.StatusEnded)
                        .SetProperty(s => s.EndedDateTime, now)
                        .SetProperty(s => s.AccumulatedSeconds, accumulatedSeconds)
                        .SetProperty(s => s.UpdatedUser, _userId.ToString())
                        .SetProperty(s => s.UpdatedDateTime, now),
                    CancellationToken.None);

            // 再生成摘要（best-effort；失敗 → 保持既有 null，不覆寫）。
            string? summary = null;
            try
            {
                summary = await GenerateSummaryAsync(provider);
            }
            catch (Exception exception)
            {
                _logger.LogInformation(exception, "教練課末摘要生成失敗，降級（不影響收尾）。");
            }

            if (!string.IsNullOrWhiteSpace(summary))
            {
                await db.CoachSession.IgnoreQueryFilters()
                    .Where(s => s.Id == _sessionId && s.UserId == _userId)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(s => s.SummaryText, summary),
                        CancellationToken.None);
            }

            return 0;
        });
    }

    /// <summary>生成課末摘要（取本場逐字稿→VertexAdc lite；查不到共用列時降級回 null 不 throw）。</summary>
    private async Task<string?> GenerateSummaryAsync(IServiceProvider provider)
    {
        var db = provider.GetRequiredService<ZonWikiDbContext>();
        var messages = await db.CoachMessage.IgnoreQueryFilters()
            .Where(m => m.CoachSessionId == _sessionId && m.UserId == _userId && m.ValidFlag)
            .OrderBy(m => m.SeqNo)
            .Select(m => new { m.Role, m.Content })
            .Take(200)
            .ToListAsync(CancellationToken.None);

        if (messages.Count == 0)
        {
            return null;
        }

        var transcript = new System.Text.StringBuilder();
        foreach (var message in messages)
        {
            transcript.Append(message.Role == CoachMessage.RoleUser ? "Learner: " : "Coach: ");
            transcript.AppendLine(message.Content);
        }

        var factory = provider.GetRequiredService<ZonWiki.Infrastructure.Ai.AiProviderFactory>();
        var resolved = await factory.ResolveAsync(_userId, DefaultSummaryModelKey, CancellationToken.None);

        const string systemPrompt =
            "You summarize an English speaking-practice session for continuity. In 2-4 short sentences, note what "
            + "the learner practiced, recurring mistakes, and words introduced. Reply in Traditional Chinese.";

        var transcriptText = transcript.ToString();
        var summary = await AccumulateAsync(resolved.Provider, systemPrompt, transcriptText, resolved.Model);

        // 【對抗復審-計費盲點】課末摘要走 AiProviderFactory→Vertex 文字串流，其 token 未經 Live usageMetadata 回報，
        // 過去完全不進全站花費熔斷。供應者不回傳精確 usage，故以字元數粗估（~4 字元/token）餵入熔斷計量器，
        // 讓「全站花費熔斷」語意與實際覆蓋一致（估算保守偏低不影響熔斷保護方向，僅供斷路參考）。
        await AccumulateEstimatedTokensAsync("summary", systemPrompt, transcriptText, summary);

        return string.IsNullOrWhiteSpace(summary) ? null : summary.Trim();
    }

    /// <summary>
    /// 把「文字副作用」（課末摘要／背景補釋義）的估算 token 用量餵入全站花費熔斷計量器。
    /// 供應者不回傳精確 usage，故以字元數 ÷4 粗估（比照業界 tokenizer 概略比例）；此估算僅供熔斷保守參考，
    /// 非精確帳單（權威帳單以 GCP 為準）。累計失敗只記錄不拋（不可讓計量副作用影響收尾）。
    /// </summary>
    /// <param name="purpose">用途標籤（記錄用）。</param>
    /// <param name="texts">參與估算的文字片段（prompt／輸入／輸出）。</param>
    private async Task AccumulateEstimatedTokensAsync(string purpose, params string?[] texts)
    {
        var estimatedTokens = EstimateTokens(texts);
        if (estimatedTokens <= 0)
        {
            return;
        }

        try
        {
            await _budgetService.AccumulateAsync(estimatedTokens, CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogInformation(
                exception,
                "教練文字副作用（{Purpose}）估算 token 累計失敗，略過（估 {Tokens} tokens，session={SessionId}）。",
                purpose, estimatedTokens, _sessionId);
        }
    }

    /// <summary>粗估一組文字的 token 數（總字元數 ÷4；僅供計費熔斷保守累計，非精確 tokenization）。</summary>
    /// <param name="texts">文字片段（可含 null）。</param>
    /// <returns>估算 token 數（無文字時為 0）。</returns>
    private static long EstimateTokens(params string?[] texts)
    {
        long totalChars = 0;
        foreach (var text in texts)
        {
            totalChars += text?.Length ?? 0;
        }

        return totalChars / 4;
    }

    /// <summary>摘要模型鍵（與其它文字任務共用 Vertex lite 列）。</summary>
    private const string DefaultSummaryModelKey = "vertex-gemini-lite";

    /// <summary>累積供應者串流取全文（收 Delta、以 Completed 收尾；Error 拋例外）。</summary>
    private static async Task<string> AccumulateAsync(
        ZonWiki.Infrastructure.Ai.IAiProvider provider,
        string systemPrompt,
        string userPrompt,
        string? model)
    {
        var builder = new System.Text.StringBuilder();
        await foreach (var streamEvent in provider.StreamAsync(
            userPrompt, resumeSessionId: null, model: model, systemPrompt: systemPrompt,
            cancellationToken: CancellationToken.None))
        {
            switch (streamEvent.Type)
            {
                case ZonWiki.Infrastructure.Ai.AiStreamEventType.Delta:
                    builder.Append(streamEvent.Text);
                    break;
                case ZonWiki.Infrastructure.Ai.AiStreamEventType.Completed:
                    return string.IsNullOrEmpty(streamEvent.Text) ? builder.ToString() : streamEvent.Text;
                case ZonWiki.Infrastructure.Ai.AiStreamEventType.Error:
                    throw new InvalidOperationException(streamEvent.Text);
                default:
                    break;
            }
        }

        return builder.ToString();
    }

    // ── 瀏覽器送出（單寫者佇列）＋ DB 寫入（單消費者佇列）──────────────────────────

    /// <summary>把一則訊息排進瀏覽器送出佇列（單一寫出 Task 消費，保證 A1）。</summary>
    private void EnqueueBrowser(object message)
    {
        var json = JsonSerializer.Serialize(message, BrowserJsonOptions);
        _browserOut.Writer.TryWrite(json);
    }

    /// <summary>瀏覽器送出單一寫出 Task：逐則取出送到瀏覽器通道（唯一呼叫 browser.SendAsync 之處）。</summary>
    private async Task BrowserWriterLoopAsync()
    {
        try
        {
            await foreach (var json in _browserOut.Reader.ReadAllAsync())
            {
                try
                {
                    // 有界逾時：半開 TCP 下 SendAsync 可能永久阻塞；逾時即放棄本則（socket 已無救），
                    // 避免整場收尾（FinishAsync→RunAsync）永久卡死而漏放併發槽。
                    using var sendCts = new CancellationTokenSource(BrowserSendTimeout);
                    await _browser.SendAsync(json, sendCts.Token);
                }
                catch (Exception exception)
                {
                    _logger.LogDebug(exception, "教練瀏覽器送出失敗／逾時（連線可能已斷）。");
                }
            }
        }
        finally
        {
            // 送完所有排隊訊息（含 ended/fatal）後才真的中止瀏覽器連線。
            _browser.Abort();
        }
    }

    /// <summary>排一筆 DB 寫入到單消費者佇列（【審修-A2】所有落地序列化）。</summary>
    private void EnqueueDbWrite(Func<Task> writeAction)
        => _dbWrites.Writer.TryWrite(writeAction);

    /// <summary>DB 寫入單一消費者：逐筆執行（每筆自建短命 scope）；例外只記錄不中斷佇列。</summary>
    private async Task DbWriteConsumerLoopAsync()
    {
        await foreach (var writeAction in _dbWrites.Reader.ReadAllAsync())
        {
            try
            {
                await writeAction();
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "教練 DB 寫入佇列項目失敗（session={SessionId}）。", _sessionId);
            }
        }
    }

    // ── 短命 scope＋DB 小工具 ──────────────────────────────────────────────────────

    /// <summary>開一個短命 DI scope，取設定齊全的 scoped 服務並先 SetCurrentUserId(userId) 再首查（【審修-A2】）。</summary>
    private async Task<T> WithUserScopeAsync<T>(Func<IServiceProvider, Task<T>> body)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
        // 首次查詢前設定使用者，讓隔離全域過濾與模型快取鍵都用正確 userId（背景無 HttpContext）。
        db.SetCurrentUserId(_userId);
        return await body(scope.ServiceProvider);
    }

    /// <summary>組 systemInstruction（短命 scope）。</summary>
    private Task<string> BuildSystemInstructionAsync()
        => WithUserScopeAsync(provider =>
        {
            var assembler = provider.GetRequiredService<CoachPromptAssembler>();
            return assembler.BuildSystemInstructionAsync(_userId, _sessionId, _topic, CancellationToken.None);
        });

    /// <summary>
    /// 取本場的續連句柄（handle 只由伺服器取，絕不接受前端傳入）。<b>優先用記憶體權威</b>
    /// <see cref="_lastKnownHandle"/>——避免「sessionResumptionUpdate 排隊寫 DB 尚未落地、goAway 緊接觸發重連」
    /// 而讀到過期 handle；記憶體無值（首連或跨行程重啟）才回退讀 DB。
    /// </summary>
    private async Task<string?> ReadResumptionHandleAsync()
    {
        var cached = _lastKnownHandle;
        if (!string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        return await WithUserScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<ZonWikiDbContext>();
            return await db.CoachSession.IgnoreQueryFilters()
                .Where(s => s.Id == _sessionId && s.UserId == _userId && s.ValidFlag)
                .Select(s => s.ResumptionHandle)
                .FirstOrDefaultAsync(CancellationToken.None);
        });
    }

    /// <summary>持久化最後一個續連句柄（先更新記憶體權威，再排進 DB 寫入佇列做持久化備援）。</summary>
    private void PersistResumptionHandle(string handle)
    {
        _lastKnownHandle = handle; // 記憶體權威即時更新（重連即讀得到，不必等佇列落地）。
        EnqueueDbWrite(() => WithUserScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<ZonWikiDbContext>();
            var now = DateTime.UtcNow;
            await db.CoachSession.IgnoreQueryFilters()
                .Where(s => s.Id == _sessionId && s.UserId == _userId && s.ValidFlag)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(s => s.ResumptionHandle, handle)
                        .SetProperty(s => s.UpdatedUser, _userId.ToString())
                        .SetProperty(s => s.UpdatedDateTime, now),
                    CancellationToken.None);
            return 0;
        }));
    }

    /// <summary>續扣 AccumulatedSeconds 落地＋把 UpdatedDateTime 推到 now（心跳，讓殭屍判定看到「活著」）。</summary>
    private Task FlushAccumulatedSecondsAsync(int accumulatedSeconds)
        => WithUserScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<ZonWikiDbContext>();
            var now = DateTime.UtcNow;
            await db.CoachSession.IgnoreQueryFilters()
                .Where(s => s.Id == _sessionId && s.UserId == _userId && s.ValidFlag)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(s => s.AccumulatedSeconds, accumulatedSeconds)
                        .SetProperty(s => s.UpdatedUser, _userId.ToString())
                        .SetProperty(s => s.UpdatedDateTime, now),
                    CancellationToken.None);
            return 0;
        });

    /// <summary>本人今日是否已達日分鐘上限（權威計量，短命 scope）。</summary>
    private Task<bool> IsDailyLimitReachedAsync()
        => WithUserScopeAsync(provider =>
        {
            var sessionService = provider.GetRequiredService<CoachSessionService>();
            return sessionService.IsDailyLimitReachedAsync(_userId, CancellationToken.None);
        });

    /// <summary>寫一則逐字稿 CoachMessage（SeqNo 取 DB max+1，唯一索引為背板；撞 23505 重試一次）。</summary>
    private Task WriteTranscriptAsync(
        string role,
        string content,
        bool interrupted,
        int? approxCut,
        string? correctionJson)
        => WithUserScopeAsync(async provider =>
        {
            var db = provider.GetRequiredService<ZonWikiDbContext>();

            // 踢舊交棒瞬間，舊 proxy 排空佇列與新 proxy 可能短暫並存並對同場寫入；唯一索引 (CoachSessionId, SeqNo)
            // 為背板，撞號即卸掉重取 max+1 重試。多給幾次（而非只一次）以吸收較寬的交棒視窗，避免逐字稿悄悄遺失。
            const int maxAttempts = 6;
            for (var attempt = 0; attempt < maxAttempts; attempt++)
            {
                var maxSeq = await db.CoachMessage.IgnoreQueryFilters()
                    .Where(m => m.CoachSessionId == _sessionId && m.UserId == _userId)
                    .Select(m => (int?)m.SeqNo)
                    .MaxAsync(CancellationToken.None);
                var nextSeq = (maxSeq ?? 0) + 1;

                var message = new CoachMessage
                {
                    UserId = _userId,
                    CoachSessionId = _sessionId,
                    Role = role,
                    Content = content,
                    CorrectionJson = correctionJson,
                    SeqNo = nextSeq,
                    InterruptedFlag = interrupted,
                    ApproxCutChars = approxCut,
                    CreatedUser = _userId.ToString(),
                    UpdatedUser = _userId.ToString(),
                };

                db.CoachMessage.Add(message);
                try
                {
                    await db.SaveChangesAsync(CancellationToken.None);
                    return 0;
                }
                catch (DbUpdateException exception) when (IsUniqueViolation(exception) && attempt < maxAttempts - 1)
                {
                    db.Entry(message).State = EntityState.Detached;
                }
            }

            _logger.LogWarning(
                "教練逐字稿落地重試耗盡（session={SessionId}，role={Role}）——SeqNo 持續撞號。", _sessionId, role);
            return 0;
        });

    /// <summary>釋放並棄置目前 client（Abort＋Dispose；冪等）。</summary>
    private async Task DisposeCurrentClientAsync()
    {
        ICoachLiveClient? client;
        lock (_clientLock)
        {
            client = _liveClient;
            _liveClient = null;
        }

        if (client is not null)
        {
            try
            {
                await client.DisposeAsync();
            }
            catch (Exception exception)
            {
                _logger.LogDebug(exception, "教練 Live client 釋放時例外。");
            }
        }
    }

    /// <summary>目前的 Live client（執行緒安全讀取）。</summary>
    private ICoachLiveClient? CurrentClient
    {
        get
        {
            lock (_clientLock)
            {
                return _liveClient;
            }
        }
    }

    /// <summary>最近一次瀏覽器活動時間（孤兒偵測用）。</summary>
    private DateTime LastBrowserActivity => new(Volatile.Read(ref _lastBrowserActivityTicks), DateTimeKind.Utc);

    /// <summary>標記瀏覽器有活動（收到任何訊框時呼叫）。</summary>
    private void MarkBrowserActivity() => Volatile.Write(ref _lastBrowserActivityTicks, DateTime.UtcNow.Ticks);

    /// <summary>讀取 Function Call args 的字串欄位（缺失／空白回 null）。</summary>
    private static string? ReadStringArg(JsonElement args, string propertyName)
    {
        if (args.ValueKind == JsonValueKind.Object
            && args.TryGetProperty(propertyName, out var value)
            && value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }

        return null;
    }

    /// <summary>安全等待一個背景 Task（吞掉例外／取消，收尾用）。</summary>
    private static async Task SafeAwait(Task? task)
    {
        if (task is null)
        {
            return;
        }

        try
        {
            await task;
        }
        catch
        {
            // 收尾期例外一律吞掉。
        }
    }

    /// <summary>安全等待一個背景 Task，逾時即放棄（收尾用；保證有界回傳、吞掉例外／取消）。</summary>
    private static async Task SafeAwait(Task? task, TimeSpan timeout)
    {
        if (task is null)
        {
            return;
        }

        try
        {
            await task.WaitAsync(timeout);
        }
        catch
        {
            // 逾時或例外一律吞掉（不可讓爛掉的連線拖垮收尾）。
        }
    }

    /// <summary>判斷 <see cref="DbUpdateException"/> 是否為 PostgreSQL 唯一約束違反（SQLSTATE 23505）。</summary>
    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is System.Data.Common.DbException { SqlState: "23505" };

    /// <summary>
    /// 一場 session 跨連線共享的工具預算（加字上限＋短時去重）。以 sessionId 為鍵存於 static 表，
    /// 故重連（新 proxy 實例）不會重置——防「反覆重連重置每場加字上限」的計費放大。所有操作皆執行緒安全。
    /// </summary>
    private sealed class SessionToolBudget
    {
        private int _vocabCount;
        private readonly ConcurrentDictionary<string, DateTime> _recentVocab = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>是否為短時重複（同字於視窗內已加過）。</summary>
        /// <param name="word">正規化單字。</param>
        /// <param name="windowSeconds">去重視窗（秒）。</param>
        /// <returns>屬短時重複時為 true。</returns>
        public bool IsRecentDuplicate(string word, int windowSeconds)
            => _recentVocab.TryGetValue(word, out var lastAt)
               && (DateTime.UtcNow - lastAt).TotalSeconds < windowSeconds;

        /// <summary>原子保留一個加字名額（未超上限才 +1 並回 true）。</summary>
        /// <param name="max">每場上限。</param>
        /// <returns>成功保留為 true；已達上限為 false。</returns>
        public bool TryReserveVocabSlot(int max)
        {
            while (true)
            {
                var current = Volatile.Read(ref _vocabCount);
                if (current >= max)
                {
                    return false;
                }

                if (Interlocked.CompareExchange(ref _vocabCount, current + 1, current) == current)
                {
                    return true;
                }
            }
        }

        /// <summary>記錄一個字剛被加入（供去重）。</summary>
        /// <param name="word">正規化單字。</param>
        public void MarkVocab(string word) => _recentVocab[word] = DateTime.UtcNow;
    }
}
