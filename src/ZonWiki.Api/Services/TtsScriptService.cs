using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ZonWiki.Domain.Tts;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Services;

/// <summary>
/// 口語稿服務：把筆記 Markdown 轉成「朗讀稿 segments」（供 TTS 分段合成）。
///
/// 走 VertexAdc（flash-lite，重用 <see cref="AiProviderFactory"/>；記帳已定案 Vertex，避免 claude cold start）。
/// 轉換規則（設計書 §6.4，寫死進 system prompt）：表格先報欄位再敘述、程式碼唸用途不唸碼、圖片唸 alt、
/// 標題明確播報＋停頓（＝章節切點）、清單先報數量、連結只唸錨文字。
/// 降級（不 throw）：LLM 回壞 JSON／空 → 回單一 speech 片段（Markdown 去記號後的純文字），保底至少能唸原文。
/// </summary>
public sealed class TtsScriptService
{
    /// <summary>
    /// 口語化 prompt 版本（入快取鍵）。<b>改動 prompt 規則時遞增此值</b>，讓既有快取自然失效重合成。
    /// </summary>
    public const string PromptVersion = "tts-script-v1";

    /// <summary>設定鍵：口語稿模型鍵（對應 DB 的 AiModel.Key；重用記帳 Vertex 列）。</summary>
    public const string ScriptModelKeyConfigKey = "Tts:ScriptModelKey";

    /// <summary>口語稿模型鍵預設值（與記帳共用 VertexAdc 列）。</summary>
    public const string DefaultScriptModelKey = "vertex-gemini-lite";

    private readonly AiProviderFactory _providerFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TtsScriptService> _logger;

    /// <summary>
    /// 建立口語稿服務。
    /// </summary>
    public TtsScriptService(
        AiProviderFactory providerFactory,
        IConfiguration configuration,
        ILogger<TtsScriptService> logger)
    {
        _providerFactory = providerFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 由筆記標題與 Markdown 產出朗讀稿 segments。
    /// </summary>
    /// <param name="userId">使用者識別碼（供 <see cref="AiProviderFactory.ResolveAsync"/> 解析模型）。</param>
    /// <param name="noteTitle">筆記標題（供 prompt 脈絡）。</param>
    /// <param name="markdown">筆記原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>朗讀稿 segments（至少一個；LLM 失敗時降級為單一 speech 片段）。</returns>
    public async Task<IReadOnlyList<TtsScriptSegment>> GenerateAsync(
        Guid userId,
        string noteTitle,
        string markdown,
        CancellationToken cancellationToken)
    {
        var safeMarkdown = markdown ?? string.Empty;
        var systemPrompt = BuildSystemPrompt();
        var userPrompt = BuildUserPrompt(noteTitle, safeMarkdown);

        string fullText;
        try
        {
            var modelKey = _configuration[ScriptModelKeyConfigKey];
            if (string.IsNullOrWhiteSpace(modelKey))
            {
                modelKey = DefaultScriptModelKey;
            }

            var resolved = await _providerFactory.ResolveAsync(userId, modelKey, cancellationToken);
            fullText = await AccumulateAsync(resolved.Provider, systemPrompt, userPrompt, resolved.Model, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw; // 取消向外傳播（由管線的合成預算 CTS 控制）。
        }
        catch (Exception exception)
        {
            // 供應者建構失敗（ADC 不可用等）／串流 Error → 降級為純文字朗讀（不 throw，保底能唸原文）。
            _logger.LogWarning(exception, "口語稿生成失敗，降級為純文字朗讀。");
            return DegradeToPlainText(safeMarkdown);
        }

        var segments = TryParseSegments(fullText);
        if (segments is not null && segments.Count > 0)
        {
            return segments;
        }

        _logger.LogInformation("口語稿：LLM 未回合法 segments JSON，降級為純文字朗讀。");
        return DegradeToPlainText(safeMarkdown);
    }

    /// <summary>
    /// 組系統提示（設計書 §6.4 六條轉換規則＋輸出 JSON 格式要求）。
    /// </summary>
    /// <returns>系統提示字串。</returns>
    public static string BuildSystemPrompt()
    {
        var builder = new StringBuilder();
        builder.AppendLine("你是把 Markdown 筆記轉成「口語朗讀稿」的助理。目標是讓聽眾用耳朵就能理解筆記內容。");
        builder.AppendLine("請把筆記改寫成適合朗讀的自然口語，並依下列規則處理各種元素：");
        builder.AppendLine("1. 表格：先報「這裡有一張表，欄位是…」，小表逐列轉成敘述、大表只講重點或總結。");
        builder.AppendLine("2. 程式碼區塊：不要逐字唸程式碼，改說「這裡有一段約 N 行的程式碼，功能是…」；行內 code 則唸出字面。");
        builder.AppendLine("3. 圖片：唸出 alt 文字或圖說；沒有 alt 就跳過。");
        builder.AppendLine("4. 標題：明確播報（例如「第一節：…」）並自成一個段落（作為章節切點）。");
        builder.AppendLine("5. 清單：先報「以下有 N 點」，再逐點朗讀。");
        builder.AppendLine("6. 連結：只唸錨點文字，不要唸出網址。");
        builder.AppendLine();
        builder.AppendLine("輸出格式（務必只輸出一個 JSON 物件，不要任何多餘文字、不要用 ``` 圍欄）：");
        builder.AppendLine("{");
        builder.AppendLine("  \"segments\": [");
        builder.AppendLine("    { \"kind\": \"heading\", \"text\": \"章節標題（會被朗讀，同時作為章節切點）\" },");
        builder.AppendLine("    { \"kind\": \"speech\", \"text\": \"一段口語朗讀內容\" }");
        builder.AppendLine("  ]");
        builder.AppendLine("}");
        builder.AppendLine();
        builder.AppendLine("規則：kind 只能是 heading 或 speech；text 為純文字（不含 Markdown 記號、不含 SSML）。");
        builder.AppendLine("每個 Markdown 標題對應一個 heading 片段；標題之間的內容切成一或多個 speech 片段。");

        return builder.ToString();
    }

    /// <summary>組使用者提示（帶標題脈絡＋原始 Markdown）。</summary>
    private static string BuildUserPrompt(string noteTitle, string markdown)
    {
        var builder = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(noteTitle))
        {
            builder.Append("筆記標題：").AppendLine(noteTitle);
            builder.AppendLine();
        }

        builder.AppendLine("筆記內容（Markdown）：");
        builder.Append(markdown);
        return builder.ToString();
    }

    /// <summary>
    /// 累積供應者串流取全文（收 Delta、以 Completed 收尾；Error 事件拋例外；取消向外傳播）。
    /// 照 <see cref="ExpenseParsingService"/> 的累積範式。
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
                    throw new InvalidOperationException(streamEvent.Text);
                default:
                    break;
            }
        }

        return builder.ToString();
    }

    /// <summary>
    /// 圍欄剝除＋解析 <c>segments[]</c>。解析失敗／非物件／空陣列 → 回 null（由呼叫端降級）。
    /// </summary>
    private static IReadOnlyList<TtsScriptSegment>? TryParseSegments(string fullText)
    {
        var text = StripFence((fullText ?? string.Empty).Trim());
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("segments", out var segmentsElement)
                || segmentsElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var segments = new List<TtsScriptSegment>();
            foreach (var element in segmentsElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var kindRaw = element.TryGetProperty("kind", out var kindElement)
                    && kindElement.ValueKind == JsonValueKind.String
                    ? kindElement.GetString()
                    : null;
                var segmentText = element.TryGetProperty("text", out var textElement)
                    && textElement.ValueKind == JsonValueKind.String
                    ? textElement.GetString()
                    : null;

                if (string.IsNullOrWhiteSpace(segmentText))
                {
                    continue;
                }

                var kind = string.Equals(kindRaw, TtsScriptSegment.HeadingKind, StringComparison.OrdinalIgnoreCase)
                    ? TtsScriptSegment.HeadingKind
                    : TtsScriptSegment.SpeechKind;

                segments.Add(new TtsScriptSegment(kind, segmentText!.Trim()));
            }

            return segments.Count > 0 ? segments : null;
        }
    }

    /// <summary>
    /// 降級：把 Markdown 去記號成純文字，回單一 speech 片段（章節＝無）。保底：至少能唸原文。
    /// </summary>
    private static IReadOnlyList<TtsScriptSegment> DegradeToPlainText(string markdown)
    {
        var plain = StripMarkdown(markdown);
        if (string.IsNullOrWhiteSpace(plain))
        {
            return Array.Empty<TtsScriptSegment>();
        }

        return new[] { new TtsScriptSegment(TtsScriptSegment.SpeechKind, plain) };
    }

    /// <summary>去掉整段被 ``` 圍欄包住的情形（比照 <see cref="ExpenseParsingService"/> 的 StripFence）。</summary>
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

    /// <summary>
    /// 輕量 Markdown 去記號（降級朗讀用）：移除圍欄程式碼、圖片/連結記號、標題/強調/清單符號等，
    /// 只保留可朗讀的純文字。非完整 Markdown 解析（保底用途，力求不丟失內容）。
    /// </summary>
    private static string StripMarkdown(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
        {
            return string.Empty;
        }

        var text = markdown;
        // 圍欄程式碼區塊：整段移除（降級不唸碼）。
        text = Regex.Replace(text, "```[\\s\\S]*?```", " ", RegexOptions.None);
        // 圖片 ![alt](url) → 只留 alt。
        text = Regex.Replace(text, "!\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
        // 連結 [text](url) → 只留錨文字。
        text = Regex.Replace(text, "\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
        // 行內 code `x` → 只留 x。
        text = Regex.Replace(text, "`([^`]*)`", "$1");
        // 標題井號、引用符號（行首）。
        text = Regex.Replace(text, "(?m)^[ \\t]*#{1,6}[ \\t]*", string.Empty);
        text = Regex.Replace(text, "(?m)^[ \\t]*>[ \\t]?", string.Empty);
        // 清單符號（行首 - * + 或數字.）。
        text = Regex.Replace(text, "(?m)^[ \\t]*[-*+][ \\t]+", string.Empty);
        text = Regex.Replace(text, "(?m)^[ \\t]*\\d+\\.[ \\t]+", string.Empty);
        // 強調符號 ** * __ _ ~~。
        text = text.Replace("**", string.Empty, StringComparison.Ordinal)
            .Replace("__", string.Empty, StringComparison.Ordinal)
            .Replace("~~", string.Empty, StringComparison.Ordinal);
        // 折疊多餘空白行。
        text = Regex.Replace(text, "\\n{3,}", "\n\n");

        return text.Trim();
    }
}
