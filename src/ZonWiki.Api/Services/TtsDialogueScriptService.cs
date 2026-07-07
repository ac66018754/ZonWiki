using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ZonWiki.Domain.Tts;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Api.Services;

/// <summary>
/// 雙主持人 Podcast 對談腳本服務：把筆記 Markdown 轉成「2 人對談」JSON turns（供多講者 TTS 分段合成）。
///
/// 走 VertexAdc（<c>vertex-gemini-lite</c>，重用 <see cref="AiProviderFactory"/>，仿 <see cref="TtsScriptService"/>）；
/// system prompt 要求輸出 <c>{turns:[{speaker:"A"|"B",text}]}</c>（圍欄剝除＋保底解析）。
/// 降級（不 throw，【審修-A7】不裸 500）：LLM 回壞 JSON／空／查不到共用模型列 → 回單一 A 講者朗讀
/// （Markdown 去記號後的純文字），保底至少能唸原文。
/// </summary>
public sealed class TtsDialogueScriptService
{
    /// <summary>
    /// 對談 prompt 版本（入快取鍵）。<b>改動 prompt 規則時遞增此值</b>，讓既有對談快取自然失效重合成。
    /// </summary>
    public const string PromptVersion = "podcast-dialogue-v1";

    private readonly AiProviderFactory _providerFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TtsDialogueScriptService> _logger;

    /// <summary>
    /// 建立對談腳本服務。
    /// </summary>
    /// <param name="providerFactory">AI 供應者工廠（解析共用 VertexAdc 模型）。</param>
    /// <param name="configuration">設定（讀對談腳本模型鍵，重用 <see cref="TtsScriptService.ScriptModelKeyConfigKey"/>）。</param>
    /// <param name="logger">記錄器。</param>
    public TtsDialogueScriptService(
        AiProviderFactory providerFactory,
        IConfiguration configuration,
        ILogger<TtsDialogueScriptService> logger)
    {
        _providerFactory = providerFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 由筆記標題與 Markdown 產出雙主持人對談 turns。
    /// </summary>
    /// <param name="userId">使用者識別碼（供 <see cref="AiProviderFactory.ResolveAsync"/> 解析模型）。</param>
    /// <param name="noteTitle">筆記標題（供 prompt 脈絡）。</param>
    /// <param name="markdown">筆記原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>對談 turns（至少一個；LLM 失敗時降級為單一 A 講者純文字）。</returns>
    public async Task<IReadOnlyList<TtsDialogueTurn>> GenerateAsync(
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
            var modelKey = _configuration[TtsScriptService.ScriptModelKeyConfigKey];
            if (string.IsNullOrWhiteSpace(modelKey))
            {
                modelKey = TtsScriptService.DefaultScriptModelKey;
            }

            var resolved = await _providerFactory.ResolveAsync(userId, modelKey, cancellationToken);
            fullText = await AccumulateAsync(resolved.Provider, systemPrompt, userPrompt, resolved.Model, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw; // 取消向外傳播（由合成預算 CTS 控制）。
        }
        catch (Exception exception)
        {
            // 供應者建構失敗（查不到共用列／ADC 不可用等）／串流 Error → 降級為單一 A 講者純文字（不 throw）。
            _logger.LogWarning(exception, "對談腳本生成失敗，降級為單一講者純文字朗讀。");
            return DegradeToSingleSpeaker(safeMarkdown);
        }

        var turns = TryParseTurns(fullText);
        if (turns is not null && turns.Count > 0)
        {
            return turns;
        }

        _logger.LogInformation("對談腳本：LLM 未回合法 turns JSON，降級為單一講者純文字朗讀。");
        return DegradeToSingleSpeaker(safeMarkdown);
    }

    /// <summary>
    /// 組系統提示（要求輸出雙主持人對談 JSON turns 格式）。
    /// </summary>
    /// <returns>系統提示字串。</returns>
    public static string BuildSystemPrompt()
    {
        var builder = new StringBuilder();
        builder.AppendLine("你是把 Markdown 筆記改寫成「雙主持人 Podcast 對談」的助理。");
        builder.AppendLine("有兩位主持人：A（負責拋話題、提問、串場）與 B（負責解說、補充、舉例）。");
        builder.AppendLine("請把筆記內容改寫成兩人一來一往、口語自然的對談，讓聽眾用耳朵就能理解整篇筆記的重點。");
        builder.AppendLine("規則：");
        builder.AppendLine("1. 只有兩位講者，speaker 只能是 \"A\" 或 \"B\"，且要交錯發言（不要同一人連講太多回合）。");
        builder.AppendLine("2. text 為純文字口語（不含 Markdown 記號、不含 SSML、不要唸出網址）。");
        builder.AppendLine("3. 開頭由 A 簡短歡迎與破題，結尾做重點回顧。");
        builder.AppendLine("4. 表格／程式碼不要逐字唸，改用口語摘要說明用途或重點。");
        builder.AppendLine();
        builder.AppendLine("輸出格式（務必只輸出一個 JSON 物件，不要任何多餘文字、不要用 ``` 圍欄）：");
        builder.AppendLine("{");
        builder.AppendLine("  \"turns\": [");
        builder.AppendLine("    { \"speaker\": \"A\", \"text\": \"歡迎回到節目，今天我們聊聊這篇筆記…\" },");
        builder.AppendLine("    { \"speaker\": \"B\", \"text\": \"沒錯，我先幫大家整理三個重點…\" }");
        builder.AppendLine("  ]");
        builder.AppendLine("}");

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
    /// 與 <see cref="TtsScriptService"/> 相同的累積範式。
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
    /// 圍欄剝除＋解析 <c>turns[]</c>。解析失敗／非物件／空陣列 → 回 null（由呼叫端降級）。
    /// speaker 一律正規化為 "A"／"B"（不留未定義講者）。
    /// </summary>
    private static IReadOnlyList<TtsDialogueTurn>? TryParseTurns(string fullText)
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
                || !document.RootElement.TryGetProperty("turns", out var turnsElement)
                || turnsElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var turns = new List<TtsDialogueTurn>();
            foreach (var element in turnsElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var speakerRaw = element.TryGetProperty("speaker", out var speakerElement)
                    && speakerElement.ValueKind == JsonValueKind.String
                    ? speakerElement.GetString()
                    : null;
                var turnText = element.TryGetProperty("text", out var textElement)
                    && textElement.ValueKind == JsonValueKind.String
                    ? textElement.GetString()
                    : null;

                if (string.IsNullOrWhiteSpace(turnText))
                {
                    continue;
                }

                turns.Add(new TtsDialogueTurn(TtsDialogueTurn.NormalizeSpeaker(speakerRaw), turnText!.Trim()));
            }

            return turns.Count > 0 ? turns : null;
        }
    }

    /// <summary>
    /// 降級：把 Markdown 去記號成純文字，回單一 A 講者回合。保底：至少能唸原文。
    /// </summary>
    private static IReadOnlyList<TtsDialogueTurn> DegradeToSingleSpeaker(string markdown)
    {
        var plain = StripMarkdown(markdown);
        if (string.IsNullOrWhiteSpace(plain))
        {
            return Array.Empty<TtsDialogueTurn>();
        }

        return new[] { new TtsDialogueTurn(TtsDialogueTurn.SpeakerA, plain) };
    }

    /// <summary>去掉整段被 ``` 圍欄包住的情形（與 <see cref="TtsScriptService"/> 一致）。</summary>
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
    /// 輕量 Markdown 去記號（降級用）：移除圍欄程式碼、圖片/連結記號、標題/強調/清單符號等，
    /// 只保留可朗讀的純文字。非完整 Markdown 解析（保底用途）。
    /// </summary>
    private static string StripMarkdown(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
        {
            return string.Empty;
        }

        var text = markdown;
        text = Regex.Replace(text, "```[\\s\\S]*?```", " ", RegexOptions.None);
        text = Regex.Replace(text, "!\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
        text = Regex.Replace(text, "\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
        text = Regex.Replace(text, "`([^`]*)`", "$1");
        text = Regex.Replace(text, "(?m)^[ \\t]*#{1,6}[ \\t]*", string.Empty);
        text = Regex.Replace(text, "(?m)^[ \\t]*>[ \\t]?", string.Empty);
        text = Regex.Replace(text, "(?m)^[ \\t]*[-*+][ \\t]+", string.Empty);
        text = Regex.Replace(text, "(?m)^[ \\t]*\\d+\\.[ \\t]+", string.Empty);
        text = text.Replace("**", string.Empty, StringComparison.Ordinal)
            .Replace("__", string.Empty, StringComparison.Ordinal)
            .Replace("~~", string.Empty, StringComparison.Ordinal);
        text = Regex.Replace(text, "\\n{3,}", "\n\n");

        return text.Trim();
    }
}
