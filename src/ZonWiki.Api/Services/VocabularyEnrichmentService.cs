using System.Text;
using System.Text.Json;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Services;

/// <summary>
/// 單字補釋義服務：組 prompt（要求只回 JSON：{phonetic, partOfSpeech, definitionEn, definitionZh, exampleSentence}）
/// →走 VertexAdc（google/gemini-2.5-flash-lite，記帳已定案 Vertex，reuse AiProviderFactory 既有解析）
/// →嚴格 JSON 解析（圍欄剝除＋保底）。時間預算由端點以 CancellationToken 施加（本服務只吃 ct）；
/// 壞 JSON→降級（Success=false）；供應者 Error→拋 <see cref="VocabularyEnrichException"/>（端點 catch 降級）。
///
/// VertexAdc 解析邏輯零改動沿用 <see cref="AiProviderFactory.ResolveAsync"/>（含三道安全防線）。
/// </summary>
public sealed class VocabularyEnrichmentService
{
    private readonly AiProviderFactory _providerFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<VocabularyEnrichmentService> _logger;

    /// <summary>設定鍵：VertexAdc 模型鍵（對應 DB 的 AiModel.Key）。</summary>
    public const string VertexModelKeyConfigKey = "Vocabulary:VertexModelKey";

    /// <summary>VertexAdc 模型鍵預設值（與記帳共用同一 Vertex 種子列；跨組件契約：Phase 0 種子 Key 須等於此值）。</summary>
    public const string DefaultVertexModelKey = "vertex-gemini-lite";

    /// <summary>
    /// 建立單字補釋義服務。
    /// </summary>
    /// <param name="providerFactory">AI 供應者工廠（解析 VertexAdc）。</param>
    /// <param name="configuration">設定（讀 VertexAdc 模型鍵）。</param>
    /// <param name="logger">記錄器。</param>
    public VocabularyEnrichmentService(
        AiProviderFactory providerFactory,
        IConfiguration configuration,
        ILogger<VocabularyEnrichmentService> logger)
    {
        _providerFactory = providerFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 補釋義：以 VertexAdc 依 word（＋可選 context）補 IPA／詞性／雙語釋義／例句。
    /// </summary>
    /// <param name="userId">使用者識別碼（供 AiProviderFactory 解析共用 Vertex 列）。</param>
    /// <param name="word">單字（正規化後）。</param>
    /// <param name="context">上下文/例句（可空；供補釋義更精準）。</param>
    /// <param name="cancellationToken">
    /// 取消權杖（端點以「硬時間預算」linked 到 request ct 施加）。取消時例外向外傳播，由端點吞成降級。
    /// </param>
    /// <returns>補釋義結果；Success=false 表示需降級（端點仍存 word、僅不填釋義）。</returns>
    public async Task<VocabularyEnrichmentOutcome> EnrichAsync(
        Guid userId,
        string word,
        string? context,
        CancellationToken cancellationToken)
    {
        var systemPrompt = BuildSystemPrompt(word, context);

        // 解析供應者（指定 VertexAdc 模型鍵；測試模式 Fake 會短路）。
        var modelKey = _configuration[VertexModelKeyConfigKey];
        if (string.IsNullOrWhiteSpace(modelKey))
        {
            modelKey = DefaultVertexModelKey;
        }

        var resolved = await _providerFactory.ResolveAsync(userId, modelKey, cancellationToken);

        // 使用者提示帶入 word（context 已含在 systemPrompt）。
        var fullText = await AccumulateAsync(resolved.Provider, systemPrompt, word, resolved.Model, cancellationToken);

        return ParseJson(fullText);
    }

    /// <summary>
    /// 組系統提示：要求只輸出一個含五個釋義欄位的 JSON 物件（含 word 與可選 context）。
    /// </summary>
    /// <param name="word">單字。</param>
    /// <param name="context">上下文/例句（可空）。</param>
    /// <returns>系統提示字串。</returns>
    public static string BuildSystemPrompt(string word, string? context)
    {
        var contextLine = string.IsNullOrWhiteSpace(context)
            ? "（未提供上下文，依單字最常見的意義補釋義。）"
            : $"上下文（供判斷詞義）：{context}";

        var builder = new StringBuilder();
        builder.AppendLine("你是英語詞典助理。使用者會給你一個英文單字，請補上它的釋義資訊，輸出成一個 JSON 物件。");
        builder.AppendLine("你必須只輸出一個 JSON 物件（不要任何多餘文字、不要用 ``` 圍欄）。");
        builder.AppendLine();
        builder.AppendLine($"目標單字（word）：{word}");
        builder.AppendLine(contextLine);
        builder.AppendLine();
        builder.AppendLine("JSON 欄位：");
        builder.AppendLine("{");
        builder.AppendLine("  \"phonetic\": \"string（IPA 音標，如 /rɪˈzɪliənt/）\",");
        builder.AppendLine("  \"partOfSpeech\": \"string（詞性，如 noun / verb / adjective）\",");
        builder.AppendLine("  \"definitionEn\": \"string（英文釋義，一句話）\",");
        builder.AppendLine("  \"definitionZh\": \"string（繁體中文釋義，一句話）\",");
        builder.AppendLine("  \"exampleSentence\": \"string（一個自然的英文例句）\"");
        builder.AppendLine("}");

        return builder.ToString();
    }

    /// <summary>
    /// 累積供應者串流取全文：收 Delta、以 Completed 收尾（優先取其完整文字）；遇 Error 事件拋
    /// <see cref="VocabularyEnrichException"/>；取消時 <see cref="OperationCanceledException"/> 向外傳播（不吞）。
    /// </summary>
    private static async Task<string> AccumulateAsync(
        IAiProvider provider,
        string systemPrompt,
        string userPrompt,
        string? model,
        CancellationToken cancellationToken)
    {
        var builder = new StringBuilder();

        await foreach (var streamEvent in provider.StreamAsync(
            userPrompt,
            resumeSessionId: null,
            model: model,
            systemPrompt: systemPrompt,
            cancellationToken: cancellationToken))
        {
            switch (streamEvent.Type)
            {
                case AiStreamEventType.Delta:
                    builder.Append(streamEvent.Text);
                    break;
                case AiStreamEventType.Completed:
                    return string.IsNullOrEmpty(streamEvent.Text) ? builder.ToString() : streamEvent.Text;
                case AiStreamEventType.Error:
                    throw new VocabularyEnrichException(streamEvent.Text);
                default:
                    // Stage 等其它事件：忽略。
                    break;
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// 圍欄剝除＋嚴格 JSON 解析。解析失敗或非物件→回降級結果（Success=false）。
    /// </summary>
    private VocabularyEnrichmentOutcome ParseJson(string fullText)
    {
        var text = StripFence((fullText ?? string.Empty).Trim());

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            _logger.LogInformation("單字補釋義：AI 未回合法 JSON，降級（僅存 word）。");
            return VocabularyEnrichmentOutcome.Degraded("AI 未回合法 JSON");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return VocabularyEnrichmentOutcome.Degraded("JSON 非物件");
            }

            return new VocabularyEnrichmentOutcome(
                Success: true,
                Phonetic: ReadString(root, "phonetic"),
                PartOfSpeech: ReadString(root, "partOfSpeech"),
                DefinitionEn: ReadString(root, "definitionEn"),
                DefinitionZh: ReadString(root, "definitionZh"),
                ExampleSentence: ReadString(root, "exampleSentence"),
                Reasoning: ReadString(root, "reasoning"));
        }
    }

    /// <summary>讀取字串屬性（非字串／缺失／空白回 null）。</summary>
    private static string? ReadString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = value.GetString();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    /// <summary>去掉整段被 ``` 圍欄包住的情形（比照 ExpenseParsingService.StripFence）。</summary>
    private static string StripFence(string text)
    {
        if (!text.StartsWith("```", StringComparison.Ordinal))
        {
            return text;
        }

        var firstNewLine = text.IndexOf('\n');
        if (firstNewLine < 0)
        {
            return text;
        }

        var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
        if (lastFence <= firstNewLine)
        {
            return text;
        }

        return text[(firstNewLine + 1)..lastFence].Trim();
    }
}
