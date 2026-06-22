using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Comment（留言）的 EF Core 對應設定：內容與錨點欄位、與 Note / User 的關聯，以及查詢索引。
/// </summary>
public sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
{
    /// <summary>
    /// 設定 Comment 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Comment> builder)
    {
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Content).IsRequired();
        builder.Property(c => c.AnchorType).IsRequired().HasMaxLength(32);
        builder.Property(c => c.AnchorData).HasColumnType("jsonb");
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(c => c.NoteId);
        builder.HasIndex(c => c.UserId);

        builder.HasOne(c => c.Note)
            .WithMany(n => n.Comments)
            .HasForeignKey(c => c.NoteId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(c => c.User)
            .WithMany(u => u.Comments)
            .HasForeignKey(c => c.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
