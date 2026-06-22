using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// EntityLink（通用實體關聯）的 EF Core 對應設定。
/// 多型關聯（型別字串 + Id），故不設外鍵導覽；查詢以索引加速兩個方向。
/// </summary>
public sealed class EntityLinkConfiguration : IEntityTypeConfiguration<EntityLink>
{
    /// <summary>
    /// 設定 EntityLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<EntityLink> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.SourceType).IsRequired().HasMaxLength(32);
        builder.Property(e => e.TargetType).IsRequired().HasMaxLength(32);
        builder.Property(e => e.Kind).IsRequired().HasMaxLength(64);
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依「來源」與「目標」查詢的索引（含 UserId 以利使用者隔離過濾）。
        builder.HasIndex(e => new { e.UserId, e.SourceType, e.SourceId });
        builder.HasIndex(e => new { e.UserId, e.TargetType, e.TargetId });
        // 同一對（方向化）+ 種類只記一筆，避免重複關聯。
        builder.HasIndex(e => new { e.UserId, e.SourceType, e.SourceId, e.TargetType, e.TargetId, e.Kind })
            .IsUnique()
            .HasDatabaseName("UX_EntityLink_Pair");
    }
}
