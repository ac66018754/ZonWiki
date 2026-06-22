using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// QuickLink（常用連結卡）的 EF Core 對應設定：主鍵、必填欄位與常用查詢索引。
/// </summary>
public sealed class QuickLinkConfiguration : IEntityTypeConfiguration<QuickLink>
{
    /// <summary>
    /// 設定 QuickLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<QuickLink> builder)
    {
        builder.HasKey(q => q.Id);

        builder.Property(q => q.Title).IsRequired().HasMaxLength(500);
        builder.Property(q => q.Url).IsRequired().HasMaxLength(2048);
        builder.Property(q => q.Category).HasMaxLength(128);
        builder.Property(q => q.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(q => q.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依「使用者 + 排序」列出常用連結；以及依分類分組查詢。
        builder.HasIndex(q => new { q.UserId, q.SortOrder });
        builder.HasIndex(q => new { q.UserId, q.Category });
    }
}

/// <summary>
/// QuickLinkTag（常用連結卡↔標籤 多對多，與筆記/任務共用 Tag）的 EF Core 對應設定。
/// </summary>
public sealed class QuickLinkTagConfiguration : IEntityTypeConfiguration<QuickLinkTag>
{
    /// <summary>
    /// 設定 QuickLinkTag 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<QuickLinkTag> builder)
    {
        builder.HasKey(x => x.Id);
        // 每組（連結卡, 標籤）至多一列（唯一索引未含 ValidFlag，故復活軟刪除列而非新增）。
        builder.HasIndex(x => new { x.QuickLinkId, x.TagId }).IsUnique();

        builder.HasOne(x => x.QuickLink)
            .WithMany(q => q.QuickLinkTags)
            .HasForeignKey(x => x.QuickLinkId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Tag)
            .WithMany(t => t.QuickLinkTags)
            .HasForeignKey(x => x.TagId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
