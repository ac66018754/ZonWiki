using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;

namespace ZonWiki.Infrastructure.Ai;

/// <summary>
/// 後援鏈中的一「家」供應者：顯示名稱、實際供應者、以及要帶給它的模型代號。
/// </summary>
/// <param name="Label">佇列/log 顯示用的供應者名稱（如「Claude CLI」「Google AI Studio」「banana」）。</param>
/// <param name="Provider">實際串流的供應者。</param>
/// <param name="Model">傳給該供應者的模型代號（可空；ClaudeCli 作為 --model，OpenAiCompatible 已綁在實例上時可忽略）。</param>
public sealed record ChainLink(string Label, IAiProvider Provider, string? Model);

/// <summary>
/// 「後援鏈」AI 供應者：依序嘗試多家供應者，每家失敗後重試固定次數，仍失敗才換下一家；任一家成功即停。
///
/// 設計重點（詳見 docs/design/AI後援鏈-設計與測試計畫.md）：
/// - **逐字直送**：成功路徑上把內層供應者的 <see cref="AiStreamEventType.Delta"/> 即時轉發出去（不緩衝），保留逐字體驗。
/// - **失敗就清空重試**：每次嘗試開始先發一個 <see cref="AiStageKind.AttemptStart"/> 階段事件；
///   消費端收到時若已串出過 Delta（前一次失敗殘留）應清空。某次失敗發 <see cref="AiStageKind.AttemptFailed"/>（帶去敏錯誤）。
/// - **失敗定義**：內層吐 <see cref="AiStreamEventType.Error"/>、StreamAsync 拋例外、或「Completed 去空白為空且整段無非空白 Delta」（空白回應）→ 算一次失敗。
/// - **取消**：外部 <see cref="CancellationToken"/> 取消時立即停止、不再換家、轉拋 <see cref="OperationCanceledException"/>（與既有行為一致）。
/// - 全部嘗試失敗 → 最後吐一個 <see cref="AiStreamEventType.Error"/>，內容為各次嘗試的去敏錯誤彙整。
/// </summary>
public sealed class FallbackChainProvider : IAiProvider
{
    private readonly IReadOnlyList<ChainLink> _links;
    private readonly int _attemptsPerProvider;

    /// <summary>
    /// 建立後援鏈。
    /// </summary>
    /// <param name="links">有序的供應者清單（第一家優先）。不可為空。</param>
    /// <param name="attemptsPerProvider">每家供應者的嘗試次數（含第一次），預設 2（失敗後再試一次）。</param>
    /// <exception cref="ArgumentException">links 為空時。</exception>
    public FallbackChainProvider(IReadOnlyList<ChainLink> links, int attemptsPerProvider = 2)
    {
        if (links is null || links.Count == 0)
        {
            throw new ArgumentException("後援鏈至少需要一家供應者。", nameof(links));
        }
        _links = links;
        _attemptsPerProvider = attemptsPerProvider < 1 ? 1 : attemptsPerProvider;
    }

    /// <summary>
    /// 依序嘗試各家供應者並串流回應。詳見類別說明。
    /// 注意：後援鏈為一次性（one-shot），不沿用 <paramref name="resumeSessionId"/>（接續對話屬「有選模型」單一供應者路徑，不走鏈）。
    /// </summary>
    public async IAsyncEnumerable<AiStreamEvent> StreamAsync(
        string prompt,
        string? resumeSessionId = null,
        string? model = null,
        string? systemPrompt = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var failureSummaries = new List<string>();
        var attemptInChain = 0;

        for (var providerIndex = 0; providerIndex < _links.Count; providerIndex++)
        {
            var link = _links[providerIndex];

            for (var attemptInProvider = 1; attemptInProvider <= _attemptsPerProvider; attemptInProvider++)
            {
                attemptInChain++;

                // 階段事件：開始嘗試這一家／這一次。消費端據此「清空重來」（若先前有殘留 Delta）。
                yield return new AiStreamEvent(
                    AiStreamEventType.Stage,
                    string.Empty,
                    StageKind: AiStageKind.AttemptStart,
                    ProviderLabel: link.Label,
                    ProviderIndex: providerIndex + 1,
                    AttemptInProvider: attemptInProvider,
                    AttemptInChain: attemptInChain);

                // 逐字嘗試這一家；回傳 (是否成功, Completed 事件, 失敗訊息)。
                // 成功路徑上會在 enumerator 推進時即時把 Delta yield 出去（逐字直送）。
                var sawNonWhitespaceDelta = false;
                string? completedText = null;
                string? completedSessionId = null;
                string? failure = null;

                await using var inner = link.Provider
                    .StreamAsync(prompt, resumeSessionId: null, model: link.Model, systemPrompt: systemPrompt, cancellationToken)
                    .GetAsyncEnumerator(cancellationToken);

                while (true)
                {
                    // 在 try 內推進、捕捉例外；yield 必須在 try-catch 之外（C# 限制）。
                    bool hasNext;
                    AiStreamEvent current = default;
                    try
                    {
                        hasNext = await inner.MoveNextAsync();
                        if (hasNext)
                        {
                            current = inner.Current;
                        }
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        // 外部取消：立即停止整鏈、不再換家、向上拋（與既有單一供應者行為一致）。
                        throw;
                    }
                    catch (Exception ex)
                    {
                        failure = ex.Message;
                        break;
                    }

                    if (!hasNext)
                    {
                        break;
                    }

                    switch (current.Type)
                    {
                        case AiStreamEventType.Delta:
                            if (HasNonWhitespace(current.Text))
                            {
                                sawNonWhitespaceDelta = true;
                            }
                            // 逐字直送：成功與否未定，但 Delta 先即時轉發（保留逐字體驗）；
                            // 若這家最終失敗，消費端會在下一個 AttemptStart（或終局 Error）時清空。
                            yield return current;
                            break;

                        case AiStreamEventType.Completed:
                            completedText = current.Text;
                            completedSessionId = current.SessionId;
                            break;

                        case AiStreamEventType.Error:
                            failure = current.Text;
                            break;

                        default:
                            // 其他（含內層意外的 Stage）忽略。
                            break;
                    }

                    if (failure is not null)
                    {
                        break;
                    }
                }

                // 判定成功／失敗。成功 = 無錯誤 且（Completed 有非空白內容 或 串過非空白 Delta）。
                var hasUsableOutput = HasNonWhitespace(completedText) || sawNonWhitespaceDelta;
                if (failure is null && hasUsableOutput)
                {
                    // 成功：補吐 Completed（Delta 已於上面逐字送出），整鏈結束。
                    yield return new AiStreamEvent(
                        AiStreamEventType.Completed,
                        completedText ?? string.Empty,
                        SessionId: completedSessionId);
                    yield break;
                }

                // 失敗（含「空白回應」）：記錄去敏摘要、發 AttemptFailed 階段事件，續下一次/下一家。
                var reason = failure ?? "供應者回應為空白。";
                var safeReason = AiErrorSanitizer.Sanitize(reason);
                failureSummaries.Add($"{link.Label}({attemptInProvider}/{_attemptsPerProvider})：{safeReason}");

                yield return new AiStreamEvent(
                    AiStreamEventType.Stage,
                    safeReason,
                    StageKind: AiStageKind.AttemptFailed,
                    ProviderLabel: link.Label,
                    ProviderIndex: providerIndex + 1,
                    AttemptInProvider: attemptInProvider,
                    AttemptInChain: attemptInChain);
            }
        }

        // 全部嘗試皆失敗：吐終局 Error，彙整各次去敏摘要。
        yield return new AiStreamEvent(
            AiStreamEventType.Error,
            $"後援鏈全部 {attemptInChain} 次嘗試皆失敗。{string.Join("；", failureSummaries)}");
    }

    /// <summary>
    /// 是否含至少一個非空白字元。null/空/全空白 → false。
    /// </summary>
    private static bool HasNonWhitespace(string? text) => !string.IsNullOrWhiteSpace(text);
}

/// <summary>
/// AI 錯誤訊息去敏工具：在把供應者錯誤寫進 AiSession/AiMessage（使用者可見）之前，
/// 移除可能外洩的金鑰與檔案路徑。遵守全域安全鐵則（錯誤訊息不得外洩敏感資訊）。
/// </summary>
public static partial class AiErrorSanitizer
{
    /// <summary>
    /// 去敏：遮蔽常見金鑰樣式（Bearer token、key=、sk-、AIza、AQ. 開頭）與絕對路徑後，截斷到合理長度。
    /// </summary>
    /// <param name="message">原始錯誤訊息（可空）。</param>
    /// <returns>去敏後、單行、最長 500 字的安全摘要。</returns>
    public static string Sanitize(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return "未知錯誤";
        }

        // 只取第一行（避免堆疊追蹤）。
        var firstLine = message.Split('\n')[0].Trim();

        // 遮蔽金鑰樣式。
        firstLine = BearerRegex().Replace(firstLine, "Bearer ***");
        firstLine = KeyParamRegex().Replace(firstLine, "key=***");
        firstLine = TokenLikeRegex().Replace(firstLine, "***");
        // 遮蔽 Windows/Unix 絕對路徑。
        firstLine = WindowsPathRegex().Replace(firstLine, "<path>");
        firstLine = UnixPathRegex().Replace(firstLine, "<path>");

        return firstLine.Length > 500 ? firstLine[..500] : firstLine;
    }

    [GeneratedRegex(@"Bearer\s+[A-Za-z0-9._\-]+", RegexOptions.IgnoreCase)]
    private static partial Regex BearerRegex();

    [GeneratedRegex(@"(?i)\bkey=[^\s&]+")]
    private static partial Regex KeyParamRegex();

    // sk-...、AIza...、AQ.... 等常見金鑰前綴。
    [GeneratedRegex(@"\b(sk-[A-Za-z0-9._\-]+|AIza[A-Za-z0-9._\-]+|AQ\.[A-Za-z0-9._\-]+)")]
    private static partial Regex TokenLikeRegex();

    [GeneratedRegex(@"[A-Za-z]:\\[^\s""']+")]
    private static partial Regex WindowsPathRegex();

    [GeneratedRegex(@"(?<![A-Za-z0-9])/(?:home|usr|var|etc|app|root|opt)/[^\s""']+")]
    private static partial Regex UnixPathRegex();
}
