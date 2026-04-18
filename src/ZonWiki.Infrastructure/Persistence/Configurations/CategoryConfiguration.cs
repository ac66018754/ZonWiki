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
        builder.Property(c => c.FolderPath).IsRequired().HasMaxLength(1024);
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(c => c.FolderPath).IsUnique();
        builder.HasIndex(c => c.ParentId);

        builder.HasOne(c => c.Parent)
            .WithMany(c => c.Children)
            .HasForeignKey(c => c.ParentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
