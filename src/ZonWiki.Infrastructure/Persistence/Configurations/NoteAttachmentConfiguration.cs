using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// NoteAttachment（筆記附件：貼上/上傳的圖片中繼資料）的 EF Core 對應設定。
/// </summary>
public sealed class NoteAttachmentConfiguration : IEntityTypeConfiguration<NoteAttachment>
{
    /// <summary>
    /// 設定 NoteAttachment 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteAttachment> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.FileName).IsRequired().HasMaxLength(255);
        builder.Property(e => e.FilePath).IsRequired().HasMaxLength(1024);
        builder.Property(e => e.ContentType).IsRequired().HasMaxLength(64);
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者容量配額加總（SUM FileSizeBytes）與隔離查詢用。
        builder.HasIndex(e => new { e.UserId, e.ValidFlag });

        // 孤兒掃描用：找「有效且建立時間早於寬限期」的候選附件。
        builder.HasIndex(e => new { e.ValidFlag, e.CreatedDateTime });
    }
}
