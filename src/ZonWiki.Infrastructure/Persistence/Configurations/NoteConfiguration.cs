using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Note（筆記）的 EF Core 對應設定：欄位限制、slug 於使用者範圍內唯一，以及常用查詢索引。
/// </summary>
public sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    /// <summary>
    /// 設定 Note 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Note> builder)
    {
        builder.HasKey(n => n.Id);

        builder.Property(n => n.Title).IsRequired().HasMaxLength(500);
        builder.Property(n => n.Slug).IsRequired().HasMaxLength(500);
        builder.Property(n => n.ContentHash).IsRequired().HasMaxLength(128);
        builder.Property(n => n.ContentRaw).IsRequired();
        builder.Property(n => n.ContentHtml).IsRequired();
        builder.Property(n => n.SourceFilePath).HasMaxLength(1024);
        builder.Property(n => n.Kind).IsRequired().HasMaxLength(32);
        builder.Property(n => n.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(n => n.UpdatedUser).IsRequired().HasMaxLength(128);

        // 同一位使用者底下 slug 唯一。
        builder.HasIndex(n => new { n.UserId, n.Slug }).IsUnique();
        // 匯入時以 (使用者, 來源檔路徑) 比對。
        builder.HasIndex(n => new { n.UserId, n.SourceFilePath });
        // 日記依日期查詢。
        builder.HasIndex(n => new { n.UserId, n.Kind, n.JournalDate });
    }
}
