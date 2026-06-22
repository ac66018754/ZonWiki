namespace ZonWiki.Domain.Entities;

/// <summary>
/// 畫布↔System Prompt 的多對多關聯（一筆代表「某畫布自己額外選用某 System Prompt」）。
/// 在每個畫布左側的「畫布設定」直接勾選；獨立於全域與分類來源之外。
/// 為了讓使用者隔離（全域過濾 + 最終防線攔截器）能自動生效，此處冗餘存一份 UserId
/// （建立時自動帶入、與所屬 Canvas 一致）。採硬刪除（無 ValidFlag 軟刪除語意）。
/// </summary>
public class CanvasSystemPrompt : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼（與所屬 Canvas 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 畫布外鍵。
    /// </summary>
    public Guid CanvasId { get; set; }

    /// <summary>
    /// System Prompt 外鍵。
    /// </summary>
    public Guid SystemPromptId { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }

    /// <summary>
    /// 所屬 System Prompt（導覽屬性）。
    /// </summary>
    public SystemPrompt? SystemPrompt { get; set; }
}
