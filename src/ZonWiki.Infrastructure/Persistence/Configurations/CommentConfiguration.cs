using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
{
    public void Configure(EntityTypeBuilder<Comment> builder)
    {
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Content).IsRequired();
        builder.Property(c => c.AnchorType).IsRequired().HasMaxLength(32);
        builder.Property(c => c.AnchorData).HasColumnType("jsonb");
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(c => c.ArticleId);
        builder.HasIndex(c => c.UserId);

        builder.HasOne(c => c.Article)
            .WithMany(a => a.Comments)
            .HasForeignKey(c => c.ArticleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(c => c.User)
            .WithMany(u => u.Comments)
            .HasForeignKey(c => c.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
