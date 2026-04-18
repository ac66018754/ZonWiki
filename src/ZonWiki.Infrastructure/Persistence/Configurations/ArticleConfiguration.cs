using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class ArticleConfiguration : IEntityTypeConfiguration<Article>
{
    public void Configure(EntityTypeBuilder<Article> builder)
    {
        builder.HasKey(a => a.Id);

        builder.Property(a => a.Title).IsRequired().HasMaxLength(500);
        builder.Property(a => a.Slug).IsRequired().HasMaxLength(500);
        builder.Property(a => a.FilePath).IsRequired().HasMaxLength(1024);
        builder.Property(a => a.ContentHash).IsRequired().HasMaxLength(128);
        builder.Property(a => a.ContentRaw).IsRequired();
        builder.Property(a => a.ContentHtml).IsRequired();
        builder.Property(a => a.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(a => a.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(a => a.FilePath).IsUnique();
        builder.HasIndex(a => a.Slug).IsUnique();
        builder.HasIndex(a => a.CategoryId);

        builder.HasOne(a => a.Category)
            .WithMany(c => c.Articles)
            .HasForeignKey(a => a.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
