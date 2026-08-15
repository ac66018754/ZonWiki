using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Expense（消費紀錄）的 EF Core 對應設定。
/// 重點：金額 decimal(18,2)、時間存 UTC、月報表／清單索引、以及冪等鍵的「過濾式唯一索引」。
/// </summary>
public sealed class ExpenseConfiguration : IEntityTypeConfiguration<Expense>
{
    /// <summary>
    /// 設定 Expense 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Expense> builder)
    {
        builder.HasKey(e => e.Id);

        // 金額以固定精度 decimal 儲存（Npgsql → numeric(18,2)），避免浮點誤差。
        builder.Property(e => e.Amount).HasPrecision(18, 2);
        builder.Property(e => e.Currency).IsRequired().HasMaxLength(8);
        builder.Property(e => e.RawText).IsRequired();
        builder.Property(e => e.Merchant).HasMaxLength(256);
        builder.Property(e => e.Source).IsRequired().HasMaxLength(32);
        builder.Property(e => e.ClientRequestId).HasMaxLength(128);
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 清單／本月彙總：以 (UserId, OccurredDateTime, ValidFlag) 覆蓋「某人某時間區間的有效消費」。
        builder.HasIndex(e => new { e.UserId, e.OccurredDateTime, e.ValidFlag });

        // 分類篩選：以 (UserId, CategoryId, ValidFlag) 覆蓋「某人某分類的有效消費」。
        builder.HasIndex(e => new { e.UserId, e.CategoryId, e.ValidFlag });

        // 冪等鍵：過濾式唯一索引，只約束「非 null 的 ClientRequestId」——同一使用者不會有兩筆
        // 相同 ClientRequestId 的消費；未帶冪等鍵（null）者不受此約束。
        // 濾條件 SQL 用「已映射欄名」Expense_ClientRequestId（由 ApplyZonWikiNamingConventions 產生）。
        builder.HasIndex(e => new { e.UserId, e.ClientRequestId })
            .IsUnique()
            .HasFilter("\"Expense_ClientRequestId\" IS NOT NULL");

        // 關聯在 ExpenseCategoryConfiguration 已定義（HasMany→WithOne），此處不重複配置。
    }
}
