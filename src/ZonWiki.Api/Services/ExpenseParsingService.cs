using System.Globalization;
using System.Text;
using System.Text.Json;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Services;

/// <summary>
/// 記帳文字解析服務：組 prompt（reasoning 先行 JSON schema、分類 enum、台灣口語 few-shot、相對時間換算）
/// →走 VertexAdc（google/gemini-2.5-flash-lite）解析→嚴格 JSON 解析（圍欄剝除＋保底）。
/// 時間預算由端點以 CancellationToken 施加（本服務只吃 ct）；壞 JSON→降級（Success=false）；供應者 Error→拋例外。
/// </summary>
public sealed class ExpenseParsingService
{
    private readonly AiProviderFactory _providerFactory;
    private readonly ExpenseCategoryService _categoryService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ExpenseParsingService> _logger;

    /// <summary>confidence 低於此門檻即標記 NeedsConfirmation。</summary>
    public const decimal ConfidenceThreshold = 0.7m;

    /// <summary>設定鍵：VertexAdc 模型鍵（對應 DB 的 AiModel.Key）。</summary>
    public const string VertexModelKeyConfigKey = "Expense:VertexModelKey";

    /// <summary>VertexAdc 模型鍵預設值（跨組件契約：Phase 0 種子的 AiModel.Key 必須等於此值）。</summary>
    public const string DefaultVertexModelKey = "vertex-gemini-lite";

    /// <summary>
    /// 建立記帳解析服務。
    /// </summary>
    public ExpenseParsingService(
        AiProviderFactory providerFactory,
        ExpenseCategoryService categoryService,
        IConfiguration configuration,
        ILogger<ExpenseParsingService> logger)
    {
        _providerFactory = providerFactory;
        _categoryService = categoryService;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 解析一句話成一筆消費（不入庫，入庫由端點負責）。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="rawText">原始輸入文字（如「剛剛在7-11花300買書」）。</param>
    /// <param name="deviceNowIso">裝置目前時間 ISO8601（供相對時間換算；可空）。</param>
    /// <param name="timeZone">IANA 時區（如 Asia/Taipei；供相對時間換算；可空）。</param>
    /// <param name="cancellationToken">
    /// 取消權杖（端點以「10–15 秒硬預算」linked 到 request ct 施加）。取消時例外向外傳播，
    /// 由端點以「未取消的權杖」建 CaptureItem 保底。
    /// </param>
    /// <returns>解析結果；Success=false 表示需降級（端點改建 CaptureItem）。</returns>
    public async Task<ExpenseParseOutcome> ParseAsync(
        Guid userId,
        string rawText,
        string? deviceNowIso,
        string? timeZone,
        CancellationToken cancellationToken)
    {
        // 1) 取使用者現有分類名稱（含惰性種子）→ 組 enum 嵌入 prompt。
        var categories = await _categoryService.ListAsync(userId, cancellationToken);
        var categoryNames = categories.Select(c => c.Name).ToList();

        var systemPrompt = BuildSystemPrompt(categoryNames, deviceNowIso, timeZone);

        // 2) 解析供應者（指定 VertexAdc 模型鍵；測試模式 Fake 會短路）。
        var modelKey = _configuration[VertexModelKeyConfigKey];
        if (string.IsNullOrWhiteSpace(modelKey))
        {
            modelKey = DefaultVertexModelKey;
        }

        var resolved = await _providerFactory.ResolveAsync(userId, modelKey, cancellationToken);

        // 3) 累積串流取全文（Error 事件→拋 ExpenseParseException；取消→OperationCanceledException 向外傳播）。
        var fullText = await AccumulateAsync(
            resolved.Provider, systemPrompt, rawText, resolved.Model, cancellationToken);

        // 4) 圍欄剝除＋嚴格 JSON 解析（保底：解析失敗回降級結果）。
        return ParseJson(fullText);
    }

    /// <summary>
    /// 組系統提示（reasoning 先行 JSON schema、分類 enum、相對時間換算、台灣口語 few-shot、只輸出 JSON）。
    /// </summary>
    /// <param name="categoryNames">使用者現有分類名稱（嵌入 category enum）。</param>
    /// <param name="deviceNowIso">裝置目前時間 ISO8601（供相對時間換算；可空）。</param>
    /// <param name="timeZone">IANA 時區（供相對時間換算；可空）。</param>
    /// <returns>系統提示字串。</returns>
    public static string BuildSystemPrompt(
        IReadOnlyList<string> categoryNames,
        string? deviceNowIso,
        string? timeZone)
    {
        var categoryEnum = categoryNames.Count > 0
            ? string.Join(" / ", categoryNames)
            : ExpenseCategoryService.FallbackCategoryName;

        var nowLine = string.IsNullOrWhiteSpace(deviceNowIso)
            ? "（未提供裝置時間，相對時間以你認定的當下為準，並輸出 UTC。）"
            : $"裝置目前時間（deviceNowIso）：{deviceNowIso}";
        var zoneLine = string.IsNullOrWhiteSpace(timeZone)
            ? "（未提供時區，預設 Asia/Taipei。）"
            : $"裝置時區（IANA timeZone）：{timeZone}";

        var builder = new StringBuilder();
        builder.AppendLine("你是台灣的記帳解析助理。使用者會用一句口語描述一筆消費，請把它解析成一個 JSON 物件。");
        builder.AppendLine("你必須只輸出一個 JSON 物件（不要任何多餘文字、不要用 ``` 圍欄）。");
        builder.AppendLine();
        builder.AppendLine("JSON 欄位（請先在 reasoning 推理再填答，避免先選分類再自圓其說）：");
        builder.AppendLine("{");
        builder.AppendLine("  \"reasoning\": \"string（先推理再填答）\",");
        builder.AppendLine("  \"amount\": number（金額，台灣口語數字：300塊=300、三百五=350、1千2=1200）,");
        builder.AppendLine("  \"currency\": \"TWD\",");
        builder.AppendLine("  \"merchant\": \"string（商家，正規化）\",");
        builder.AppendLine("  \"items\": [\"品項1\", \"品項2\"],");
        builder.AppendLine($"  \"category\": \"enum（只能是：{categoryEnum}；無法歸類→其他）\",");
        builder.AppendLine("  \"occurredAt\": \"ISO8601 UTC，例如 2026-07-06T04:30:00Z\",");
        builder.AppendLine("  \"confidence\": number（0~1）,");
        builder.AppendLine("  \"needsConfirmation\": boolean（confidence < 0.7 時 true）");
        builder.AppendLine("}");
        builder.AppendLine();
        builder.AppendLine("相對時間換算（剛剛／今天早上／昨天中午）：依下列裝置時間與時區換算後，一律輸出 UTC：");
        builder.AppendLine(nowLine);
        builder.AppendLine(zoneLine);
        builder.AppendLine();
        builder.AppendLine("商家正規化 few-shot：");
        builder.AppendLine("  小七／7-11／seven → 統一超商");
        builder.AppendLine("  全家／FamilyMart → 全家便利商店");
        builder.AppendLine("金額 few-shot：三百五→350、1千2→1200、300塊→300。");

        return builder.ToString();
    }

    /// <summary>
    /// 累積供應者串流取全文：收 Delta、以 Completed 收尾（優先取其完整文字）；遇 Error 事件拋
    /// <see cref="ExpenseParseException"/>；取消時 <see cref="OperationCanceledException"/> 向外傳播（不吞）。
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
                    throw new ExpenseParseException(streamEvent.Text);
                default:
                    // Stage 等其它事件：忽略。
                    break;
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// 圍欄剝除＋嚴格 JSON 解析。解析失敗或缺必要欄位（金額）→ 回降級結果（Success=false）。
    /// </summary>
    private ExpenseParseOutcome ParseJson(string fullText)
    {
        var text = StripFence((fullText ?? string.Empty).Trim());

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            _logger.LogInformation("記帳解析：AI 未回合法 JSON，降級為暫存。");
            return ExpenseParseOutcome.Degraded("AI 未回合法 JSON");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return ExpenseParseOutcome.Degraded("JSON 非物件");
            }

            // 金額為必要欄位；缺失／不可解析／非正 → 降級（改建 CaptureItem，一句話永不丟失）。
            if (!TryReadDecimal(root, "amount", out var amount) || amount <= 0m)
            {
                _logger.LogInformation("記帳解析：金額缺失或非正，降級為暫存。");
                return ExpenseParseOutcome.Degraded("金額缺失或非正");
            }

            var currency = ReadString(root, "currency");
            if (string.IsNullOrWhiteSpace(currency))
            {
                currency = "TWD";
            }

            var merchant = ReadString(root, "merchant");
            var itemsJson = ReadItemsJson(root);
            var categoryName = ReadString(root, "category") ?? string.Empty;
            var reasoning = ReadString(root, "reasoning");
            var occurredUtc = ReadOccurredUtc(root);

            var confidence = TryReadDecimal(root, "confidence", out var conf) ? conf : 1.0m;
            var needsConfirmation = confidence < ConfidenceThreshold;
            if (root.TryGetProperty("needsConfirmation", out var nc) && nc.ValueKind == JsonValueKind.True)
            {
                needsConfirmation = true;
            }

            return new ExpenseParseOutcome(
                Success: true,
                Amount: amount,
                Currency: currency!,
                Merchant: merchant,
                ItemsJson: itemsJson,
                CategoryName: categoryName,
                OccurredDateTimeUtc: occurredUtc,
                NeedsConfirmation: needsConfirmation,
                Reasoning: reasoning);
        }
    }

    /// <summary>讀取 occurredAt（ISO8601）並轉 UTC；缺失／不可解析 → 保底為 <see cref="DateTime.UtcNow"/>。</summary>
    private static DateTime ReadOccurredUtc(JsonElement root)
    {
        if (root.TryGetProperty("occurredAt", out var occurred)
            && occurred.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                occurred.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed.UtcDateTime;
        }

        return DateTime.UtcNow;
    }

    /// <summary>讀取字串屬性（非字串或缺失回 null）。</summary>
    private static string? ReadString(JsonElement root, string propertyName)
        => root.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>讀取 items 陣列並原樣序列化成 JSON 字串（非陣列或缺失回 null）。</summary>
    private static string? ReadItemsJson(JsonElement root)
        => root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array
            ? items.GetRawText()
            : null;

    /// <summary>讀取 decimal 屬性（容忍數字或字串外型）。</summary>
    private static bool TryReadDecimal(JsonElement root, string propertyName, out decimal value)
    {
        value = 0m;
        if (!root.TryGetProperty(propertyName, out var element))
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out var number))
        {
            value = number;
            return true;
        }

        if (element.ValueKind == JsonValueKind.String
            && decimal.TryParse(element.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            value = parsed;
            return true;
        }

        return false;
    }

    /// <summary>去掉整段被 ``` 圍欄包住的情形（比照 RefineService.StripFence）。</summary>
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
