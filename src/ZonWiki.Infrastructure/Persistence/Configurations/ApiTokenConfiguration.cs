using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// ApiToken（API 個人存取權杖）的 EF Core 對應設定。
/// 重點：以「權杖雜湊」建立唯一索引，讓驗證時可用雜湊 O(1) 查到對應權杖；
/// 另以 UserId 建索引，加速個人頁列出「我的權杖」。
/// </summary>
public sealed class ApiTokenConfiguration : IEntityTypeConfiguration<ApiToken>
{
    /// <summary>
    /// 設定 ApiToken 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<ApiToken> builder)
    {
        builder.HasKey(t => t.Id);

        builder.Property(t => t.Name).IsRequired().HasMaxLength(128);

        // SHA-256 十六進位固定 64 字元；設上限以利索引。
        builder.Property(t => t.TokenHash).IsRequired().HasMaxLength(128);

        builder.Property(t => t.TokenPrefix).IsRequired().HasMaxLength(32);
        builder.Property(t => t.Scopes).IsRequired().HasMaxLength(256);
        builder.Property(t => t.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(t => t.UpdatedUser).IsRequired().HasMaxLength(128);

        // 權杖雜湊全域唯一：驗證時依雜湊查找（亂數權杖碰撞機率可忽略）。
        builder.HasIndex(t => t.TokenHash).IsUnique();

        // 個人頁「列出我的權杖」用。
        builder.HasIndex(t => t.UserId);
    }
}
