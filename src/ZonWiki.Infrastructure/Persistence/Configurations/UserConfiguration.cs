using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(u => u.Id);

        builder.Property(u => u.GoogleSub).IsRequired().HasMaxLength(255);
        builder.Property(u => u.Email).IsRequired().HasMaxLength(320);
        builder.Property(u => u.DisplayName).IsRequired().HasMaxLength(255);
        builder.Property(u => u.AvatarUrl).HasMaxLength(1024);
        builder.Property(u => u.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(u => u.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(u => u.GoogleSub).IsUnique();
        builder.HasIndex(u => u.Email);
    }
}
