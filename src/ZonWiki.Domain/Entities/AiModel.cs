namespace ZonWiki.Domain.Entities;

/// <summary>
/// AI 模型設定（取代開問啦原本的 ai-models.json 檔）。
/// 可代表「本機 claude CLI（免金鑰）」或「任何 OpenAI 相容 HTTP 端點」。
/// 每位使用者各自維護自己的模型與金鑰（可在設定頁新增/修改）。
/// API 金鑰以「可逆加密」形式儲存（非雜湊）：存入時加密、呼叫 API 前解密還原成原始金鑰，故仍可正常呼叫。
/// </summary>
public class AiModel : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此模型設定的使用者識別碼。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 穩定識別鍵（前端下拉的 value、節點記錄使用的模型鍵）。例如 "claude-opus"、"groq"。
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// 顯示名稱（前端下拉的文字）。例如 "Claude Opus"。
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// 供應者類型："ClaudeCli"（本機 claude CLI）或 "OpenAiCompatible"（OpenAI 相容 HTTP 端點）。
    /// </summary>
    public string Provider { get; set; } = "ClaudeCli";

    /// <summary>
    /// 模型用途："chat"（文字問答，預設）或 "image"（圖片生成）。
    /// </summary>
    public string Kind { get; set; } = "chat";

    /// <summary>
    /// 是否啟用（停用者不會出現在前端清單，也不能被選用）。
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// 傳給供應者的模型代號。ClaudeCli 作為 --model（如 opus/sonnet/haiku）；
    /// OpenAiCompatible 作為請求 body 的 model 欄位。可空。
    /// </summary>
    public string? ModelId { get; set; }

    /// <summary>
    /// OpenAI 相容端點的基底 URL（需含正確路徑前綴，如 .../v1）。ClaudeCli 不需要。
    /// </summary>
    public string? BaseUrl { get; set; }

    /// <summary>
    /// 加密後的 API 金鑰（以 ASP.NET Core Data Protection 加密；資料庫不存明碼）。
    /// 解密後若值為 "${環境變數名}" 佔位，仍支援由環境變數解析（相容舊設定）。nullable。
    /// </summary>
    public string? ApiKeyEncrypted { get; set; }

    /// <summary>
    /// HTTP 串流逾時秒數（OpenAiCompatible 用）。預設 300。
    /// </summary>
    public int TimeoutSeconds { get; set; } = 300;

    /// <summary>
    /// 給使用者看的備註（設定提示）。不影響行為。nullable。
    /// </summary>
    public string? Notes { get; set; }
}
