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
        // 變更摘要（可空）：只在「編輯」時填；上限 500 字元，攔截器產生時亦會截斷。
        builder.Property(e => e.Detail).HasMaxLength(ActivityLog.DetailMaxLength);
        // 來源："web" 或 API 權杖名稱（上限對齊權杖名稱長度）；舊資料預設 "web"。
        builder.Property(e => e.Source).IsRequired().HasMaxLength(128).HasDefaultValue("web");
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依使用者 + 時間倒序列出活動
        builder.HasIndex(e => new { e.UserId, e.CreatedDateTime });
        // 依使用者 + 來源 + 時間：供首頁「AI 最近動作」依來源篩選後倒序列出
        builder.HasIndex(e => new { e.UserId, e.Source, e.CreatedDateTime });
    }
}
