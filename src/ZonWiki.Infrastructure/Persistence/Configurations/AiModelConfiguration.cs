using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// AiModel（AI 模型設定）的 EF Core 對應設定：識別鍵必填且全站唯一。
/// </summary>
public sealed class AiModelConfiguration : IEntityTypeConfiguration<AiModel>
{
    /// <summary>
    /// 設定 AiModel 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<AiModel> builder)
    {
        builder.HasKey(m => m.Id);

        builder.Property(m => m.Key).IsRequired().HasMaxLength(128);
        builder.Property(m => m.Label).IsRequired().HasMaxLength(256);
        builder.Property(m => m.Provider).IsRequired().HasMaxLength(64);
        builder.Property(m => m.Kind).IsRequired().HasMaxLength(32);
        builder.Property(m => m.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(m => m.UpdatedUser).IsRequired().HasMaxLength(128);

        // 同一位使用者底下，模型識別鍵不重複。
        builder.HasIndex(m => new { m.UserId, m.Key }).IsUnique();
    }
}
