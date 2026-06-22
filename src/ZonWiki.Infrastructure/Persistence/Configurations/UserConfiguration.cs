using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(u => u.Id);

        // GoogleSub 可為 null（本機帳號）；不再 IsRequired。
        builder.Property(u => u.GoogleSub).HasMaxLength(255);
        builder.Property(u => u.Email).IsRequired().HasMaxLength(320);
        builder.Property(u => u.DisplayName).IsRequired().HasMaxLength(255);
        builder.Property(u => u.AvatarUrl).HasMaxLength(1024);
        builder.Property(u => u.PasswordHash).HasMaxLength(256); // nullable，本機帳號才有值
        builder.Property(u => u.ShortcutsJson).HasMaxLength(2048); // nullable；只存與預設不同的快捷鍵覆寫 JSON
        builder.Property(u => u.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(u => u.UpdatedUser).IsRequired().HasMaxLength(128);

        // 唯一索引只作用在「有 GoogleSub」的列（本機帳號 GoogleSub 為 null，不參與唯一性）。
        builder.HasIndex(u => u.GoogleSub)
            .IsUnique()
            .HasFilter("\"User_GoogleSub\" IS NOT NULL");
        builder.HasIndex(u => u.Email);
    }
}
