using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// CanvasAnnotation（開問啦畫布標註：便利貼 / 塗鴉 / 圖片板）的 EF Core 對應設定。
/// 與 NoteOverlayItem 對等，但綁定 Canvas 而非 Note。
/// </summary>
public sealed class CanvasAnnotationConfiguration : IEntityTypeConfiguration<CanvasAnnotation>
{
    /// <summary>
    /// 設定 CanvasAnnotation 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CanvasAnnotation> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Kind).IsRequired().HasMaxLength(16);
        builder.Property(e => e.Color).HasMaxLength(32);
        builder.Property(e => e.Text).HasMaxLength(4000);
        // DataJson 不設長度（手繪筆畫可能較大），以 text 儲存。
        builder.Property(e => e.DataJson).HasColumnType("text");
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依畫布查詢其所有標註（含 UserId 利於使用者隔離過濾）。
        builder.HasIndex(e => new { e.UserId, e.CanvasId, e.ValidFlag });

        // 外鍵：刪除畫布時一併移除其標註（與節點/邊一致的串接刪除）。
        builder.HasOne(e => e.Canvas)
            .WithMany()
            .HasForeignKey(e => e.CanvasId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
