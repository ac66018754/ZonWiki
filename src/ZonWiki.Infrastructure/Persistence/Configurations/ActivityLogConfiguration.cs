using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// ActivityLog（活動紀錄）的 EF Core 對應設定。
/// 以 (UserId, CreatedDateTime) 建索引，供「依時間倒序列出某使用者的活動」查詢加速。
/// </summary>
public sealed class ActivityLogConfiguration : IEntityTypeConfiguration<ActivityLog>
{
    /// <summary>
    /// 設定 ActivityLog 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<ActivityLog> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.ActionType).IsRequired().HasMaxLength(32);
        builder.Property(e => e.EntityType).IsRequired().HasMaxLength(32);
        builder.Property(e => e.Title).IsRequired().HasMaxLength(256);
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依使用者 + 時間倒序列出活動
        builder.HasIndex(e => new { e.UserId, e.CreatedDateTime });
    }
}
