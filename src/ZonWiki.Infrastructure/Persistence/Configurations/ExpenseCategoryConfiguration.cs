using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// ExpenseCategory（記帳分類）的 EF Core 對應設定。
/// 重點：名稱必填、同一使用者內名稱唯一（不含 ValidFlag → 軟刪後採復活慣例）。
/// </summary>
public sealed class ExpenseCategoryConfiguration : IEntityTypeConfiguration<ExpenseCategory>
{
    /// <summary>
    /// 設定 ExpenseCategory 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<ExpenseCategory> builder)
    {
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Name).IsRequired().HasMaxLength(128);
        builder.Property(c => c.Icon).HasMaxLength(32);
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        // 同一使用者內分類名稱唯一；刻意「不含 ValidFlag」，讓「名稱式找不到就建」在
        // 捷徑重試／並發下不會建重複列，而是復活既有的軟刪列（比照 TagConfiguration）。
        builder.HasIndex(c => new { c.UserId, c.Name }).IsUnique();

        // 一對多：一個分類底下有多筆消費。禁止硬刪連鎖（本系統一律軟刪除）。
        builder.HasMany(c => c.Expenses)
            .WithOne(e => e.Category)
            .HasForeignKey(e => e.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
