using System.Text;
using Microsoft.Extensions.Logging;
using ZonWiki.Infrastructure.Ai;

namespace ZonWiki.Infrastructure.Notes;

/// <summary>
/// 筆記 AI 服務的「真實」實作：透過既有的 <see cref="AiProviderFactory"/> 解析出的供應者
/// （預設為全站共用的 Gemini 模型 banana-gemini-lite）來進行排版調整與內容美化。
///
/// 設計重點：
/// - 重用既有 AI 供應者層（金鑰解密、HTTP 串流、錯誤處理皆已驗證），不另起一套 Gemini HTTP 呼叫。
/// - 以 modelKey = null 解析 → 取「全站共用預設模型」（不需使用者自行設定金鑰即可使用）。
/// - 串流事件累積成完整字串後回傳；偵測並去除模型可能多包的 ``` 圍欄。
/// - 排版（Reformat）只調整格式不改語意；美化（Beautify）可潤飾措辭與結構。
///   兩者的差別在於送出的「系統提示」不同（排版提示參考 scripts/format-md.ps1）。
/// </summary>
public sealed class GeminiNoteAiService : INoteAiService
{
    private readonly AiProviderFactory _factory;
    private readonly ILogger<GeminiNoteAiService> _logger;

    /// <summary>
    /// 排版調整的系統提示（只改格式、不改語意）。規則對齊 scripts/format-md.ps1 的排版專家提示。
    /// </summary>
    private const string ReformatSystemPrompt =
        "你是一個 Markdown 排版專家。使用者會提供一段 Markdown，請在「完全不改變語意與內容」的前提下，只調整排版格式後輸出。\n" +
        "排版規則：\n" +
        "1. 標題階層正確使用 #、##、###。\n" +
        "2. 無序列表用「- 」，有序列表用「1. 2. 3.」，巢狀用適當縮排。\n" +
        "3. 行內程式碼用反引號，程式碼區塊標註語言。\n" +
        "4. 強調：粗體 **text**、斜體 *text*。\n" +
        "5. 表格使用標準 Markdown 表格格式。\n" +
        "6. 連結與圖片用 [text](url) 與 ![alt](url)。\n" +
        "7. 分隔線用 ---，引用用 >。\n" +
        "8. 移除多餘空行（最多連續兩行），中英文／數字之間加空格，檔尾保留單一換行。\n" +
        "9. 摺疊區塊（可選，純排版收納，不得改動或刪減任何內容）：遇到明顯適合收起來的長區塊" +
        "（完整程式碼/指令/log、冗長補充），可用一行 :::toggle 摘要標題、內容、再一行 ::: 包住" +
        "（預設收合；想預設展開用 :::toggle-open），讓主線更好掃描；但不得把重點或結論藏起來、巢狀勿超過兩層。\n" +
        "只輸出排版後的 Markdown 全文；不要加任何說明文字，也不要用 ``` 圍欄把整篇包起來。";

    /// <summary>
    /// 內容美化的系統提示（保留原意，潤飾措辭、結構與可讀性）。
    /// </summary>
    private const string BeautifySystemPrompt =
        "你是一位專業中文寫作編輯。使用者會提供一段 Markdown，請在「保留原意與所有重要資訊」的前提下，" +
        "潤飾措辭、改善段落結構與邏輯銜接、提升可讀性，並順手修正明顯錯字與排版。\n" +
        "可善用「摺疊區塊」提升可讀性：把較長的補充、完整程式碼/指令、延伸細節或 FAQ 答案" +
        "收進一行 :::toggle 摘要標題、內容、再一行 ::: 之間（預設收合；想預設展開用 :::toggle-open）；" +
        "但須保留原意與所有重要資訊、重點與結論仍留在外面、巢狀勿超過兩層、摺疊標題要能一眼看出內容。\n" +
        "只輸出美化後的 Markdown 全文；不要加任何說明文字，也不要用 ``` 圍欄把整篇包起來。";

    /// <summary>
    /// 建立筆記 AI 服務。
    /// </summary>
    /// <param name="factory">AI 供應者工廠。</param>
    /// <param name="logger">記錄器。</param>
    public GeminiNoteAiService(AiProviderFactory factory, ILogger<GeminiNoteAiService> logger)
    {
        _factory = factory;
        _logger = logger;
    }

    /// <summary>
    /// 排版調整：只調整 Markdown 格式，不改變語意。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>排版後的 Markdown 全文。</returns>
    public Task<string> ReformatAsync(string contentRaw, CancellationToken cancellationToken) =>
        TransformAsync(ReformatSystemPrompt, contentRaw, cancellationToken);

    /// <summary>
    /// 內容美化：保留原意下潤飾措辭、結構與可讀性。
    /// </summary>
    /// <param name="contentRaw">原始 Markdown 內容。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>美化後的 Markdown 全文。</returns>
    public Task<string> BeautifyAsync(string contentRaw, CancellationToken cancellationToken) =>
        TransformAsync(BeautifySystemPrompt, contentRaw, cancellationToken);

    /// <summary>
    /// 框選提問：以選取文字為脈絡回答問題（Markdown）。
    /// </summary>
    public Task<string> AskAboutAsync(string selectedText, string question, CancellationToken cancellationToken)
    {
        const string askSystem =
            "你是一位知識助理。使用者會提供一段「選取的文字」與一個「問題」，" +
            "請主要依據該段文字、必要時輔以你的知識，用繁體中文、清楚的 Markdown 回答問題。" +
            "可用標題、清單、表格、程式碼區塊；只輸出回答內容本身，不要重述問題、不要用 ``` 把整篇包起來。";
        var prompt = $"選取的文字：\n「{selectedText}」\n\n問題：{question}";
        return TransformAsync(askSystem, prompt, cancellationToken);
    }

    /// <summary>
    /// 通用文字生成：直接以自訂系統提示 + 內容呼叫供應者（重用 TransformAsync 流程）。
    /// </summary>
    public Task<string> GenerateAsync(string systemPrompt, string userContent, CancellationToken cancellationToken) =>
        TransformAsync(systemPrompt, userContent, cancellationToken);

    /// <summary>
    /// 共用流程：解析供應者 → 以系統提示 + 內容串流呼叫 → 累積完整結果 → 去除外層 ``` 圍欄。
    /// </summary>
    /// <param name="systemPrompt">系統提示（決定排版或美化）。</param>
    /// <param name="contentRaw">使用者目前的 Markdown 內容（作為 user 訊息）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>轉換後的 Markdown 全文。</returns>
    private async Task<string> TransformAsync(
        string systemPrompt,
        string contentRaw,
        CancellationToken cancellationToken)
    {
        // 空內容直接回傳，省一次 API 呼叫。
        if (string.IsNullOrWhiteSpace(contentRaw))
        {
            return contentRaw;
        }

        // modelKey = null → 取全站共用預設模型（banana-gemini-lite）。userId 在此情境不影響解析。
        var resolved = await _factory.ResolveAsync(Guid.Empty, modelKey: null, cancellationToken);

        var accumulated = new StringBuilder();
        string? completedText = null;
        string? errorText = null;

        await foreach (var evt in resolved.Provider.StreamAsync(
            prompt: contentRaw,
            resumeSessionId: null,
            model: resolved.Model,
            systemPrompt: systemPrompt,
            cancellationToken: cancellationToken))
        {
            switch (evt.Type)
            {
                case AiStreamEventType.Delta:
                    accumulated.Append(evt.Text);
                    break;
                case AiStreamEventType.Completed:
                    completedText = evt.Text;
                    break;
                case AiStreamEventType.Error:
                    errorText = evt.Text;
                    break;
            }
        }

        if (errorText is not null)
        {
            _logger.LogError("筆記 AI 轉換失敗：{Error}", errorText);
            throw new InvalidOperationException($"AI 轉換失敗：{errorText}");
        }

        // Completed 通常帶完整答案；若為空則用累積的 Delta。
        var result = !string.IsNullOrEmpty(completedText) ? completedText : accumulated.ToString();
        result = StripCodeFence(result.Trim());

        // 防呆：若模型回空，退回原內容，避免清空使用者筆記。
        return string.IsNullOrWhiteSpace(result) ? contentRaw : result;
    }

    /// <summary>
    /// 去除模型有時會把整篇包起來的外層 ``` / ```markdown 圍欄（只去掉「整段被單一圍欄包住」的情況）。
    /// </summary>
    /// <param name="text">模型輸出文字。</param>
    /// <returns>去除外層圍欄後的文字。</returns>
    private static string StripCodeFence(string text)
    {
        if (!text.StartsWith("```", StringComparison.Ordinal))
        {
            return text;
        }

        var firstLineEnd = text.IndexOf('\n');
        if (firstLineEnd < 0)
        {
            return text;
        }

        var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
        // 結尾圍欄必須在開頭圍欄那行之後，才視為「整段被包住」。
        if (lastFence <= firstLineEnd)
        {
            return text;
        }

        var inner = text.Substring(firstLineEnd + 1, lastFence - (firstLineEnd + 1));
        return inner.TrimEnd('\n', '\r', ' ');
    }
}
