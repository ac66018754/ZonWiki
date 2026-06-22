namespace ZonWiki.Domain.Entities;

/// <summary>
/// 畫布↔分類 的多對多關聯（一筆代表「某畫布屬於某分類」）。
/// 雖然擁有權可由 Canvas/CanvasCat 推得，但為了讓使用者隔離（全域過濾 + 最終防線攔截器）能自動生效，
/// 此處冗餘存一份 UserId（建立時自動帶入、與所屬 Canvas 一致）。採硬刪除（無 ValidFlag 軟刪除語意）。
/// </summary>
public class CanvasCategory : AuditableEntity, IUserOwned
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
    /// 分類外鍵。
    /// </summary>
    public Guid CategoryId { get; set; }

    /// <summary>
    /// 所屬畫布（導覽屬性）。
    /// </summary>
    public Canvas? Canvas { get; set; }

    /// <summary>
    /// 所屬分類（導覽屬性）。
    /// </summary>
    public CanvasCat? Category { get; set; }
}
