namespace ZonWiki.Domain.Entities;

/// <summary>
/// 分類↔System Prompt 的多對多關聯（一筆代表「某分類吃到某 System Prompt」）。
/// 在「畫布分類區」設定；屬於該分類的畫布都會自動吃到這些 System Prompt。
/// 為了讓使用者隔離（全域過濾 + 最終防線攔截器）能自動生效，此處冗餘存一份 UserId
/// （建立時自動帶入、與所屬 CanvasCat 一致）。採硬刪除（無 ValidFlag 軟刪除語意）。
/// </summary>
public class CategorySystemPrompt : AuditableEntity, IUserOwned
{
    /// <summary>
    /// 擁有此關聯的使用者識別碼（與所屬 CanvasCat 的 UserId 一致；冗餘存放以支援使用者隔離）。
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 分類外鍵。
    /// </summary>
    public Guid CategoryId { get; set; }

    /// <summary>
    /// System Prompt 外鍵。
    /// </summary>
    public Guid SystemPromptId { get; set; }

    /// <summary>
    /// 所屬分類（導覽屬性）。
    /// </summary>
    public CanvasCat? Category { get; set; }

    /// <summary>
    /// 所屬 System Prompt（導覽屬性）。
    /// </summary>
    public SystemPrompt? SystemPrompt { get; set; }
}
