using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// TaskRelation（任務卡片對等關聯）的 EF Core 對應設定：
/// 兩端都指向 TaskCard；為避免多重級聯路徑，刪除卡片時關聯改為限制 (Restrict)。
/// </summary>
public sealed class TaskRelationConfiguration : IEntityTypeConfiguration<TaskRelation>
{
    /// <summary>
    /// 設定 TaskRelation 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TaskRelation> builder)
    {
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Kind).IsRequired().HasMaxLength(64);
        builder.Property(r => r.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(r => r.UpdatedUser).IsRequired().HasMaxLength(128);

        // 同一對卡片、同一種關聯只記一筆。
        builder.HasIndex(r => new { r.SourceTaskCardId, r.TargetTaskCardId, r.Kind }).IsUnique();

        builder.HasOne(r => r.SourceTaskCard)
            .WithMany()
            .HasForeignKey(r => r.SourceTaskCardId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(r => r.TargetTaskCard)
            .WithMany()
            .HasForeignKey(r => r.TargetTaskCardId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
