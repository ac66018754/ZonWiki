namespace ZonWiki.Domain.Entities;

/// <summary>
/// 可稽核實體基底（所有資料表共用的六個審計欄位 + 軟刪除時間）。
/// 依全域規範，欄位最終會被映射成 {表名}_{欄名}（例如 Note_CreatedDateTime）。
/// 時間一律以 UTC (UTC+0) 儲存，前端再依使用者時區換算顯示。
/// </summary>
public abstract class AuditableEntity
{
    /// <summary>
    /// 主鍵（GUID）。新增時若為空，會由稽核攔截器自動產生。
    /// </summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    /// 建立時間（UTC）。由稽核攔截器於新增時自動填入。
    /// </summary>
    public DateTime CreatedDateTime { get; set; }

    /// <summary>
    /// 建立者（使用者識別字串，預設 "system"）。
    /// </summary>
    public string CreatedUser { get; set; } = "system";

    /// <summary>
    /// 最後更新時間（UTC）。由稽核攔截器於新增/修改時自動填入。
    /// </summary>
    public DateTime UpdatedDateTime { get; set; }

    /// <summary>
    /// 最後更新者（使用者識別字串，預設 "system"）。
    /// </summary>
    public string UpdatedUser { get; set; } = "system";

    /// <summary>
    /// 有效旗標（軟刪除用）。true = 有效；false = 已軟刪除（進垃圾桶）。
    /// </summary>
    public bool ValidFlag { get; set; } = true;

    /// <summary>
    /// 軟刪除時間（UTC，nullable）。供「跨模組垃圾桶」依刪除時間排序與日後自動清除使用；
    /// 未刪除時為 null。
    /// </summary>
    public DateTime? DeletedDateTime { get; set; }

    /// <summary>
    /// 永久刪除（清除）時間（UTC，nullable）。
    /// 決策：本系統「絕不硬刪除」——垃圾桶的「永久刪除」不再從 DB 移除實體列，
    /// 而是把此欄填上時間（ValidFlag 維持 false），讓項目從垃圾桶清單消失，
    /// 但資料列仍保留在 DB（必要時可由 DB 將 ValidFlag 壓回 true 復活，符合「一切可復原」原則）。
    /// null = 尚未永久刪除（可能仍在垃圾桶，或正常使用中）。
    /// </summary>
    public DateTime? PurgedDateTime { get; set; }
}
