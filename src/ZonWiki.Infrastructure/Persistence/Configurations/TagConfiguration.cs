using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Tag（標籤）的 EF Core 對應設定：名稱必填，且同一工作區內標籤名稱唯一。
/// </summary>
public sealed class TagConfiguration : IEntityTypeConfiguration<Tag>
{
    /// <summary>
    /// 設定 Tag 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Tag> builder)
    {
        builder.HasKey(t => t.Id);

        builder.Property(t => t.Name).IsRequired().HasMaxLength(128);
        builder.Property(t => t.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(t => t.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(t => new { t.UserId, t.Name }).IsUnique();
    }
}
