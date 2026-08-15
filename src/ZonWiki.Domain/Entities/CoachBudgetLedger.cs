namespace ZonWiki.Domain.Entities;

/// <summary>
/// 全站教練功能花費累計帳（其他功能群 Phase 3・英文教練・計費斷路）。
///
/// 定位與慣例（【審修-S1/S2】計費斷路不變式的持久化背板）：
/// - 這是「全站（非單一使用者）」的花費計量帳——用 Vertex Live 回報的 usageMetadata token 累計，
///   跨過每日／每月門檻即整功能降級（停開新課）。故<b>刻意不實作 <see cref="IUserOwned"/></b>
///   （不套使用者隔離全域過濾），僅繼承 <see cref="AuditableEntity"/> 取六稽核欄與命名慣例。
/// - 也<b>不</b>登記進垃圾桶白名單／活動流（內部計量帳，非使用者主資料，比照 TtsAudio 的排除）。
/// - 一律以 UTC 決定期間鍵；一律軟刪除（但此表正常情況不會被刪）。
/// - 由 <c>CoachBudgetService</c>（singleton）以短命 DbContext 累計；每日一列、每月一列。
/// </summary>
public class CoachBudgetLedger : AuditableEntity
{
    /// <summary>期間種類字串常數：每日。</summary>
    public const string ScopeDaily = "daily";

    /// <summary>期間種類字串常數：每月。</summary>
    public const string ScopeMonthly = "monthly";

    /// <summary>
    /// 期間種類："daily"（每日）或 "monthly"（每月）。與 <see cref="PeriodKey"/> 組成唯一鍵。
    /// </summary>
    public string Scope { get; set; } = string.Empty;

    /// <summary>
    /// 期間鍵（UTC 為準）：每日為 "yyyy-MM-dd"、每月為 "yyyy-MM"。與 <see cref="Scope"/> 組成唯一鍵。
    /// </summary>
    public string PeriodKey { get; set; } = string.Empty;

    /// <summary>
    /// 本期間累計的 token 數（usageMetadata.totalTokenCount 加總）。
    /// </summary>
    public long TokenCount { get; set; }

    /// <summary>
    /// 本期間累計的估算花費（美元）。由 token 數乘上估算單價換算（見 <c>CoachBudgetService</c>），
    /// 為粗估值——權威帳單以 GCP 為準。
    /// </summary>
    public decimal EstimatedCostUsd { get; set; }
}
