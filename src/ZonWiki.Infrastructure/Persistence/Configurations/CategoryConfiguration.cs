using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Name).IsRequired().HasMaxLength(255);
        // FolderPath 只有「由 docs/notes-seed 匯入」的分類才有值；網頁建立的分類為空字串，故不再全域唯一。
        builder.Property(c => c.FolderPath).IsRequired().HasMaxLength(1024);
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        // 匯入時以 (使用者, 資料夾路徑) 比對；非唯一索引（網頁分類的 FolderPath 皆為空字串）。
        builder.HasIndex(c => new { c.UserId, c.FolderPath });
        builder.HasIndex(c => c.ParentId);

        builder.HasOne(c => c.Parent)
            .WithMany(c => c.Children)
            .HasForeignKey(c => c.ParentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// CategoryTag（分類↔標籤 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class CategoryTagConfiguration : IEntityTypeConfiguration<CategoryTag>
{
    /// <summary>
    /// 設定 CategoryTag 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CategoryTag> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasIndex(x => new { x.CategoryId, x.TagId }).IsUnique();

        builder.HasOne(x => x.Category)
            .WithMany(c => c.CategoryTags)
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Tag)
            .WithMany(t => t.CategoryTags)
            .HasForeignKey(x => x.TagId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
