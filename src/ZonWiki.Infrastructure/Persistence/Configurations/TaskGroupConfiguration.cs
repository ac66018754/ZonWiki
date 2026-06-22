using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// TaskGroup（任務群組）的 EF Core 對應設定。
/// 設定主鍵、名稱必填、與 TaskCard 的一對多關聯，以及常用查詢索引。
/// </summary>
public sealed class TaskGroupConfiguration : IEntityTypeConfiguration<TaskGroup>
{
    /// <summary>
    /// 設定 TaskGroup 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TaskGroup> builder)
    {
        builder.HasKey(g => g.Id);

        builder.Property(g => g.Name).IsRequired().HasMaxLength(255);
        builder.Property(g => g.Color).HasMaxLength(32);
        builder.Property(g => g.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(g => g.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者 + 排序序號索引（用於按順序載入群組）。
        builder.HasIndex(g => new { g.UserId, g.SortOrder });

        // 群組包含多張卡片；刪除群組時不連動刪除卡片（卡片改為未分組）。
        builder.HasMany(g => g.TaskCards)
            .WithOne(t => t.Group)
            .HasForeignKey(t => t.GroupId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
