using System.Buffers;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Coach;

/// <summary>
/// Vertex Live（<c>google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent</c>）的單一連線客戶端，
/// 以原生 <see cref="ClientWebSocket"/> 實作（Google.Cloud.AIPlatform.V1 無 Live client）。
///
/// 三條不變式落實：
/// - <b>單寫者（A1）</b>：所有送出經內部 <see cref="Channel{T}"/> 佇列＋單一寫出 Task 序列化，任一時刻
///   只有一個未完成 <c>SendAsync</c>；並發呼叫多個 <c>Send*</c> 不會擲 <see cref="InvalidOperationException"/>。
///   收訊為獨立單一讀者。
/// - <b>ADC token 只送 Vertex 官方 host（S6）</b>：送 Bearer 前先以 <see cref="VertexHostGuard"/> 斷言
///   組出的 wss host，否則拒連（連 token 都不取）。
/// - <b>離開路徑必 Abort（S1/S2/S4）</b>：收訊解析例外／傳輸斷／Dispose 一律保證 <c>ClientWebSocket.Abort()</c>，
///   不留孤兒連線；例外不逸散（記錄後翻成 <see cref="CoachClosedEvent"/>）。
///
/// 職責邊界（A3）：只管「一條連線」；不重連、不落地、不計費（由 <c>CoachProxyService</c> 編排）。
/// </summary>
public sealed class CoachLiveClient : ICoachLiveClient
{
    /// <summary>Live WebSocket 的 gRPC 服務路徑（固定；Vertex v1）。</summary>
    private const string BidiServicePath =
        "/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent";

    /// <summary>收訊單次讀取的緩衝大小（16KB；大訊息以多段累積至 EndOfMessage，可 >200KB）。</summary>
    private const int ReceiveChunkSize = 16 * 1024;

    /// <summary>Dispose 等待送出／收訊迴圈收攏的逾時（避免卡死）。</summary>
    private static readonly TimeSpan DisposeDrainTimeout = TimeSpan.FromSeconds(2);

    private readonly ClientWebSocket _socket = new();
    private readonly IVertexAdcTokenProvider _tokenProvider;
    private readonly CoachLiveConnectionConfig _config;
    private readonly ILogger<CoachLiveClient> _logger;

    /// <summary>送出序列化佇列（單一讀者＝單寫出 Task；保證 A1）。</summary>
    private readonly Channel<byte[]> _outgoing =
        Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>收訊事件出口（單一寫者＝收訊迴圈；單一讀者＝上層 proxy）。</summary>
    private readonly Channel<CoachLiveServerEvent> _serverEvents =
        Channel.CreateUnbounded<CoachLiveServerEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

    /// <summary>連線壽命取消源（Abort／Dispose 觸發，收攏兩條迴圈）。</summary>
    private readonly CancellationTokenSource _lifetimeCts = new();

    private Task? _writeLoop;
    private Task? _readLoop;

    /// <summary>已中止旗標（Interlocked；讓 Abort 冪等、送出佇列在中止後短路）。</summary>
    private int _aborted;

    /// <summary>已釋放旗標（Interlocked；讓 DisposeAsync 冪等）。</summary>
    private int _disposed;

    /// <summary>
    /// 建立 Live client。
    /// </summary>
    /// <param name="tokenProvider">ADC access token 提供者（握手 Bearer 用）。</param>
    /// <param name="config">連線設定（region／project／model／voice 等）。</param>
    /// <param name="logger">記錄器。</param>
    public CoachLiveClient(
        IVertexAdcTokenProvider tokenProvider,
        CoachLiveConnectionConfig config,
        ILogger<CoachLiveClient> logger)
    {
        _tokenProvider = tokenProvider;
        _config = config;
        _logger = logger;
    }

    /// <inheritdoc />
    public ChannelReader<CoachLiveServerEvent> ServerEvents => _serverEvents.Reader;

    /// <inheritdoc />
    public async Task ConnectAsync(
        CoachLiveSetup setup,
        string? resumptionHandle,
        CancellationToken cancellationToken)
    {
        // 組 WS URL（非使用者輸入；region 來自設定）。global 區域用無前綴 host，其餘用 <region>- 前綴。
        var host = string.Equals(_config.Region, "global", StringComparison.OrdinalIgnoreCase)
            ? VertexHostGuard.VertexOfficialHost
            : $"{_config.Region}-{VertexHostGuard.VertexOfficialHost}";
        var url = $"wss://{host}{BidiServicePath}";

        // 【審修-S6】縱深防禦：送 Bearer（甚至取 token）之前先斷言 host 為 Vertex 官方 wss 端點，否則拒連。
        if (!VertexHostGuard.IsAllowedVertexWssUrl(url))
        {
            throw new InvalidOperationException(
                $"拒絕連線：組出的 Live WebSocket host 不是 Vertex 官方端點（{url}）。" +
                "為避免 ADC token 外流，只允許 wss://<region>-aiplatform.googleapis.com。");
        }

        var token = await _tokenProvider.GetAccessTokenAsync(cancellationToken);
        _socket.Options.SetRequestHeader("Authorization", "Bearer " + token);
        _socket.Options.SetRequestHeader("Content-Type", "application/json");

        await _socket.ConnectAsync(new Uri(url), cancellationToken);

        // 先把 setup 排進送出佇列（FIFO＋單寫者保證它是第一則）；setupComplete 以 Ready 事件通知上層。
        var setupBytes = JsonSerializer.SerializeToUtf8Bytes(
            BuildSetupMessage(setup, resumptionHandle), CoachLiveJson.SerializerOptions);
        await _outgoing.Writer.WriteAsync(setupBytes, cancellationToken);

        // 啟動送出／收訊兩條獨立迴圈。
        _writeLoop = Task.Run(WriteLoopAsync);
        _readLoop = Task.Run(ReadLoopAsync);
    }

    /// <inheritdoc />
    public ValueTask SendAudioAsync(string base64Pcm16, CancellationToken cancellationToken)
        => EnqueueAsync(
            new { realtimeInput = new { audio = new { mimeType = "audio/pcm;rate=16000", data = base64Pcm16 } } },
            cancellationToken);

    /// <inheritdoc />
    public ValueTask SendAudioStreamEndAsync(CancellationToken cancellationToken)
        => EnqueueAsync(new { realtimeInput = new { audioStreamEnd = true } }, cancellationToken);

    /// <inheritdoc />
    public ValueTask SendTextTurnAsync(string text, CancellationToken cancellationToken)
        => EnqueueAsync(
            new
            {
                clientContent = new
                {
                    turns = new[] { new { role = "user", parts = new[] { new { text } } } },
                    turnComplete = true,
                },
            },
            cancellationToken);

    /// <inheritdoc />
    public ValueTask SendToolResponseAsync(
        string id,
        string name,
        object response,
        string scheduling,
        CancellationToken cancellationToken)
        => EnqueueAsync(
            new
            {
                toolResponse = new
                {
                    functionResponses = new[]
                    {
                        new { id, name, response, scheduling },
                    },
                },
            },
            cancellationToken);

    /// <inheritdoc />
    public void Abort()
    {
        // 冪等：只第一次真正中止。
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
            // Abort 為 best-effort，底層狀態不佳時吞掉。
        }

        try
        {
            _lifetimeCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // 已釋放，忽略。
        }

        _outgoing.Writer.TryComplete();
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1)
        {
            return;
        }

        // 【審修-S4】保證 Abort（含 socket.Abort()）＋釋放送出 Task；所有離開路徑都會走這裡。
        Abort();

        await DrainLoopAsync(_writeLoop);
        await DrainLoopAsync(_readLoop);

        _serverEvents.Writer.TryComplete();

        try
        {
            _socket.Dispose();
        }
        catch
        {
            // 忽略釋放期例外。
        }

        _lifetimeCts.Dispose();
    }

    // ── 送出（單寫者佇列）────────────────────────────────────────────────────────

    /// <summary>把一則訊息序列化為 UTF-8 JSON 並排進送出佇列（不直接 SendAsync，保證 A1）。</summary>
    private ValueTask EnqueueAsync(object message, CancellationToken cancellationToken)
    {
        // 已中止：不再送（避免對已 Abort 的 socket 排入無效訊息）。
        if (Volatile.Read(ref _aborted) == 1)
        {
            return ValueTask.CompletedTask;
        }

        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, CoachLiveJson.SerializerOptions);

        // 佇列已完成（連線關閉）時 TryWrite 回 false → 靜默丟棄（連線已不可用）。
        if (!_outgoing.Writer.TryWrite(bytes))
        {
            return ValueTask.CompletedTask;
        }

        return ValueTask.CompletedTask;
    }

    /// <summary>單一寫出 Task：從佇列逐則取出、序列化送到 WebSocket（唯一呼叫 SendAsync 之處）。</summary>
    private async Task WriteLoopAsync()
    {
        try
        {
            await foreach (var frame in _outgoing.Reader.ReadAllAsync(_lifetimeCts.Token))
            {
                if (_socket.State != WebSocketState.Open)
                {
                    break;
                }

                await _socket.SendAsync(
                    new ArraySegment<byte>(frame),
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    _lifetimeCts.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // 連線壽命結束（Abort/Dispose）：正常收攏。
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "教練 Live 送出迴圈結束（連線可能已斷）。");
        }
    }

    // ── 收訊（單一讀者）＋協定分派 ─────────────────────────────────────────────────

    /// <summary>收訊迴圈：累積至 EndOfMessage → UTF-8 → JsonDocument → 依頂層鍵分派事件。</summary>
    private async Task ReadLoopAsync()
    {
        var buffer = new byte[ReceiveChunkSize];
        var accumulated = new ArrayBufferWriter<byte>();

        try
        {
            while (!_lifetimeCts.IsCancellationRequested)
            {
                accumulated.Clear();
                WebSocketReceiveResult result;
                do
                {
                    result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), _lifetimeCts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        // 伺服器正常關線（非致命）：上層可視情況帶 handle 重連。
                        _serverEvents.Writer.TryWrite(
                            new CoachClosedEvent(Fatal: false, Reason: $"server close: {result.CloseStatus}"));
                        _serverEvents.Writer.TryComplete();
                        return;
                    }

                    accumulated.Write(buffer.AsSpan(0, result.Count));
                }
                while (!result.EndOfMessage);

                DispatchFrame(accumulated.WrittenSpan);
            }
        }
        catch (OperationCanceledException)
        {
            // 連線壽命結束（Abort/Dispose）：正常收攏，不視為致命。
        }
        catch (Exception exception)
        {
            // 【審修-S4】解析／傳輸例外不得逸散：記 Seq → fatal 收尾 → Abort（不留孤兒連線）。
            _logger.LogError(exception, "教練 Live 收訊迴圈致命錯誤，觸發 fatal 收尾並中止連線。");
            _serverEvents.Writer.TryWrite(new CoachClosedEvent(Fatal: true, Reason: exception.Message));
            Abort();
        }
        finally
        {
            _serverEvents.Writer.TryComplete();
        }
    }

    /// <summary>
    /// 解析單一完整訊息並派發事件。<b>一個 frame 可能同時含多個頂層 key</b>（如 serverContent＋usageMetadata），
    /// 故逐一檢查、不假設單一頂層 key。JSON 本身無效（<see cref="JsonException"/>）會往上拋 → 收訊迴圈翻成 fatal。
    /// </summary>
    private void DispatchFrame(ReadOnlySpan<byte> utf8)
    {
        using var document = JsonDocument.Parse(utf8.ToArray());
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (root.TryGetProperty("setupComplete", out _))
        {
            _serverEvents.Writer.TryWrite(new CoachReadyEvent());
        }

        if (root.TryGetProperty("serverContent", out var serverContent))
        {
            DispatchServerContent(serverContent);
        }

        if (root.TryGetProperty("toolCall", out var toolCall))
        {
            DispatchToolCall(toolCall);
        }

        if (root.TryGetProperty("toolCallCancellation", out var cancellation)
            && cancellation.TryGetProperty("ids", out var ids)
            && ids.ValueKind == JsonValueKind.Array)
        {
            var list = new List<string>();
            foreach (var idElement in ids.EnumerateArray())
            {
                if (idElement.ValueKind == JsonValueKind.String)
                {
                    var value = idElement.GetString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        list.Add(value);
                    }
                }
            }

            _serverEvents.Writer.TryWrite(new CoachToolCancelEvent(list));
        }

        if (root.TryGetProperty("goAway", out var goAway))
        {
            var timeLeft = goAway.TryGetProperty("timeLeft", out var tl) && tl.ValueKind == JsonValueKind.String
                ? tl.GetString()
                : null;
            _serverEvents.Writer.TryWrite(new CoachGoAwayEvent(timeLeft));
        }

        if (root.TryGetProperty("sessionResumptionUpdate", out var resumption))
        {
            var newHandle = resumption.TryGetProperty("newHandle", out var nh) && nh.ValueKind == JsonValueKind.String
                ? nh.GetString()
                : null;
            var resumable = resumption.TryGetProperty("resumable", out var r) && r.ValueKind == JsonValueKind.True;
            _serverEvents.Writer.TryWrite(new CoachSessionResumptionUpdateEvent(newHandle, resumable));
        }

        if (root.TryGetProperty("usageMetadata", out var usage)
            && usage.TryGetProperty("totalTokenCount", out var totalTokens)
            && totalTokens.ValueKind == JsonValueKind.Number
            && totalTokens.TryGetInt64(out var tokens))
        {
            _serverEvents.Writer.TryWrite(new CoachUsageMeteredEvent(tokens));
        }
    }

    /// <summary>派發 <c>serverContent</c> 的音訊／逐字稿／三旗標（皆可能分別出現、不塞同一則）。</summary>
    private void DispatchServerContent(JsonElement serverContent)
    {
        if (serverContent.TryGetProperty("modelTurn", out var modelTurn)
            && modelTurn.TryGetProperty("parts", out var parts)
            && parts.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("inlineData", out var inlineData)
                    && inlineData.TryGetProperty("data", out var data)
                    && data.ValueKind == JsonValueKind.String)
                {
                    var base64 = data.GetString();
                    if (!string.IsNullOrEmpty(base64))
                    {
                        _serverEvents.Writer.TryWrite(new CoachAudioOutEvent(base64));
                    }
                }
            }
        }

        var assistantText = ReadTranscriptText(serverContent, "outputTranscription");
        if (assistantText is not null)
        {
            _serverEvents.Writer.TryWrite(new CoachAssistantTranscriptEvent(assistantText));
        }

        var userText = ReadTranscriptText(serverContent, "inputTranscription");
        if (userText is not null)
        {
            _serverEvents.Writer.TryWrite(new CoachUserTranscriptEvent(userText));
        }

        if (serverContent.TryGetProperty("interrupted", out var interrupted)
            && interrupted.ValueKind == JsonValueKind.True)
        {
            _serverEvents.Writer.TryWrite(new CoachInterruptedEvent());
        }

        if (serverContent.TryGetProperty("generationComplete", out var generationComplete)
            && generationComplete.ValueKind == JsonValueKind.True)
        {
            _serverEvents.Writer.TryWrite(new CoachGenerationCompleteEvent());
        }

        if (serverContent.TryGetProperty("turnComplete", out var turnComplete)
            && turnComplete.ValueKind == JsonValueKind.True)
        {
            _serverEvents.Writer.TryWrite(new CoachTurnCompleteEvent());
        }
    }

    /// <summary>讀取逐字稿子物件的 <c>text</c>（缺失／空白回 null）。</summary>
    private static string? ReadTranscriptText(JsonElement serverContent, string propertyName)
    {
        if (serverContent.TryGetProperty(propertyName, out var transcription)
            && transcription.TryGetProperty("text", out var text)
            && text.ValueKind == JsonValueKind.String)
        {
            var value = text.GetString();
            return string.IsNullOrEmpty(value) ? null : value;
        }

        return null;
    }

    /// <summary>派發 <c>toolCall.functionCalls[]</c>（保留 args 原文 JSON，供上層驗證與解析）。</summary>
    private void DispatchToolCall(JsonElement toolCall)
    {
        if (!toolCall.TryGetProperty("functionCalls", out var functionCalls)
            || functionCalls.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var calls = new List<CoachToolCall>();
        foreach (var call in functionCalls.EnumerateArray())
        {
            if (call.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = call.TryGetProperty("id", out var idElement) && idElement.ValueKind == JsonValueKind.String
                ? idElement.GetString()
                : null;
            var name = call.TryGetProperty("name", out var nameElement) && nameElement.ValueKind == JsonValueKind.String
                ? nameElement.GetString()
                : null;
            var argsJson = call.TryGetProperty("args", out var argsElement)
                ? argsElement.GetRawText()
                : "{}";

            if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(name))
            {
                calls.Add(new CoachToolCall(id, name, argsJson));
            }
        }

        if (calls.Count > 0)
        {
            _serverEvents.Writer.TryWrite(new CoachToolCallEvent(calls));
        }
    }

    // ── setup 組裝 ────────────────────────────────────────────────────────────────

    /// <summary>組 setup 訊息（spec §3.1；model 為完整資源路徑；含兩個 NON_BLOCKING function declaration）。</summary>
    private object BuildSetupMessage(CoachLiveSetup setup, string? resumptionHandle)
    {
        var modelPath =
            $"projects/{_config.Project}/locations/{_config.Region}/publishers/google/models/{_config.Model}";

        return new
        {
            setup = new
            {
                model = modelPath,
                generationConfig = new
                {
                    responseModalities = new[] { "AUDIO" },
                    temperature = 0.8,
                    speechConfig = new
                    {
                        voiceConfig = new { prebuiltVoiceConfig = new { voiceName = _config.Voice } },
                        languageCode = _config.LanguageCode,
                    },
                },
                systemInstruction = new { parts = new[] { new { text = setup.SystemInstruction } } },
                inputAudioTranscription = new { },
                outputAudioTranscription = new { },
                realtimeInputConfig = new
                {
                    automaticActivityDetection = new
                    {
                        disabled = false,
                        startOfSpeechSensitivity = "START_SENSITIVITY_HIGH",
                        endOfSpeechSensitivity = "END_SENSITIVITY_HIGH",
                        prefixPaddingMs = 20,
                        silenceDurationMs = 100,
                    },
                },
                contextWindowCompression = new { slidingWindow = new { }, triggerTokens = _config.TriggerTokens },
                // 空物件＝開啟 resumption；有 handle＝帶回續連（handle 只由伺服器從 DB 取）。
                sessionResumption = string.IsNullOrEmpty(resumptionHandle)
                    ? (object)new { }
                    : new { handle = resumptionHandle },
                tools = new[]
                {
                    new
                    {
                        functionDeclarations = new object[]
                        {
                            BuildAddVocabularyDeclaration(),
                            BuildShowCorrectionDeclaration(),
                        },
                    },
                },
            },
        };
    }

    /// <summary>add_vocabulary function declaration（NON_BLOCKING；學習者遇到生字時把單字加入單字庫）。</summary>
    private static object BuildAddVocabularyDeclaration() => new
    {
        name = "add_vocabulary",
        description = "Add an English word or short phrase the learner wants to remember to their vocabulary list. "
            + "Call this when the learner explicitly asks to save a word, or when you introduce a useful new word.",
        behavior = "NON_BLOCKING",
        parameters = new
        {
            type = "object",
            properties = new
            {
                word = new { type = "string", description = "The English word or short phrase to save." },
                context_sentence = new
                {
                    type = "string",
                    description = "A short example sentence using the word (optional).",
                },
            },
            required = new[] { "word" },
        },
    };

    /// <summary>show_correction function declaration（NON_BLOCKING；把一次糾錯結構化成糾錯卡）。</summary>
    private static object BuildShowCorrectionDeclaration() => new
    {
        name = "show_correction",
        description = "Show a grammar or wording correction card to the learner when you correct their English. "
            + "Provide the original phrasing, the corrected phrasing, a short Chinese explanation, and a better version.",
        behavior = "NON_BLOCKING",
        parameters = new
        {
            type = "object",
            properties = new
            {
                original = new { type = "string", description = "The learner's original phrasing." },
                corrected = new { type = "string", description = "The corrected phrasing." },
                explanation_zh = new { type = "string", description = "A short explanation in Traditional Chinese." },
                better_version = new
                {
                    type = "string",
                    description = "An optional more natural / advanced version.",
                },
            },
            required = new[] { "original", "corrected" },
        },
    };

    /// <summary>等待一條背景迴圈收攏（含逾時，避免 Dispose 卡死）。</summary>
    private static async Task DrainLoopAsync(Task? loop)
    {
        if (loop is null)
        {
            return;
        }

        try
        {
            await loop.WaitAsync(DisposeDrainTimeout);
        }
        catch
        {
            // 逾時或迴圈自身例外：Dispose 不因此失敗（socket 已 Abort）。
        }
    }
}
