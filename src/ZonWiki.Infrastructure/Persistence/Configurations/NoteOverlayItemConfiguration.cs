using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// NoteOverlayItem（筆記浮層元件：便利貼 / 塗鴉 / 圖片輪播）的 EF Core 對應設定。
/// </summary>
public sealed class NoteOverlayItemConfiguration : IEntityTypeConfiguration<NoteOverlayItem>
{
    /// <summary>
    /// 設定 NoteOverlayItem 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteOverlayItem> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Kind).IsRequired().HasMaxLength(16);
        builder.Property(e => e.Color).HasMaxLength(32);
        builder.Property(e => e.Text).HasMaxLength(4000);
        // DataJson 不設長度（手繪筆畫可能較大），以 text 儲存。
        builder.Property(e => e.DataJson).HasColumnType("text");
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依筆記查詢其所有浮層元件（含 UserId 利於使用者隔離過濾）。
        builder.HasIndex(e => new { e.UserId, e.NoteId, e.ValidFlag });
    }
}
