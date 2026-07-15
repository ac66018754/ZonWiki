using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// 時間追蹤項目（TimeEntry）的 EF Core 對應設定：
/// 主鍵、欄位長度限制與查詢用複合索引。
/// 欄位名稱前綴（TimeEntry_Xxx）由 ModelBuilderExtensions 全域自動套用，此處不需手動命名。
/// </summary>
public sealed class TimeEntryConfiguration : IEntityTypeConfiguration<TimeEntry>
{
    /// <summary>
    /// 套用 TimeEntry 的資料表對應設定。
    /// </summary>
    /// <param name="builder">實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TimeEntry> builder)
    {
        builder.HasKey(t => t.Id);

        // 項目名稱：必填、最長 200 字（與端點驗證一致）。
        builder.Property(t => t.Title).IsRequired().HasMaxLength(200);

        // 自由文字分類：可空、最長 128 字（與 QuickLink.Category 同款）。
        builder.Property(t => t.Category).HasMaxLength(128);

        builder.Property(t => t.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(t => t.UpdatedUser).IsRequired().HasMaxLength(128);

        // 「日/週/月/年檢視」的區間查詢（WHERE UserId = ? AND StartedDateTime ∈ [from, to)）。
        builder.HasIndex(t => new { t.UserId, t.StartedDateTime });

        // 撈「進行中」項目（WHERE UserId = ? AND EndedDateTime IS NULL）。
        builder.HasIndex(t => new { t.UserId, t.EndedDateTime });
    }
}
