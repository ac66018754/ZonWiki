using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// CoachBudgetLedger（全站教練花費累計帳）的 EF Core 對應設定（其他功能群 Phase 3・計費斷路）。
/// 重點：<b>唯一索引 (Scope, PeriodKey)</b>（每日一列、每月一列；不含 ValidFlag——此表不走復活軟刪 upsert）、
/// Scope／PeriodKey 設長度上限、EstimatedCostUsd 用 numeric(18,6) 存美元估算。
/// 此表<b>非 IUserOwned</b>（全站計量帳，不套使用者隔離過濾）。
/// 欄名／索引名皆由 <c>ApplyZonWikiNamingConventions</c> 自動產生（CoachBudgetLedger_{Property}）。
/// </summary>
public sealed class CoachBudgetLedgerConfiguration : IEntityTypeConfiguration<CoachBudgetLedger>
{
    /// <summary>
    /// 設定 CoachBudgetLedger 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CoachBudgetLedger> builder)
    {
        builder.HasKey(l => l.Id);

        builder.Property(l => l.Scope).IsRequired().HasMaxLength(16);
        builder.Property(l => l.PeriodKey).IsRequired().HasMaxLength(16);
        // 美元估算：用固定小數精度存，避免浮點誤差累積（18 位總長、6 位小數足夠）。
        builder.Property(l => l.EstimatedCostUsd).HasPrecision(18, 6);
        builder.Property(l => l.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(l => l.UpdatedUser).IsRequired().HasMaxLength(128);

        // 唯一索引 (Scope, PeriodKey)：每個期間（每日／每月）只一列，作為 upsert 累計的鍵。
        builder.HasIndex(l => new { l.Scope, l.PeriodKey }).IsUnique();
    }
}
