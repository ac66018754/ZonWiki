using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// NoteMark（筆記文字標註：重點 / 關聯 / 備註）的 EF Core 對應設定。
/// 以錨點（文字＋位移＋前後文）定位，不嵌入內文；目標為多型（型別字串＋Id 或外部網址），故不設外鍵導覽。
/// </summary>
public sealed class NoteMarkConfiguration : IEntityTypeConfiguration<NoteMark>
{
    /// <summary>
    /// 設定 NoteMark 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteMark> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Kind).IsRequired().HasMaxLength(16);
        builder.Property(e => e.AnchorText).IsRequired().HasMaxLength(1000);
        builder.Property(e => e.AnchorPrefix).IsRequired().HasMaxLength(500);
        builder.Property(e => e.AnchorSuffix).IsRequired().HasMaxLength(500);
        builder.Property(e => e.Color).HasMaxLength(32);
        builder.Property(e => e.TargetType).HasMaxLength(32);
        builder.Property(e => e.TargetUrl).HasMaxLength(2048);
        builder.Property(e => e.Text).HasMaxLength(4000);
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依筆記查詢此筆記的所有標註（含 UserId 利於使用者隔離過濾）。
        builder.HasIndex(e => new { e.UserId, e.NoteId, e.ValidFlag });
    }
}
