using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// CaptureLink（捕捉項目↔衍生筆記/任務）的 EF Core 對應設定。
/// </summary>
public sealed class CaptureLinkConfiguration : IEntityTypeConfiguration<CaptureLink>
{
    /// <summary>
    /// 設定 CaptureLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CaptureLink> builder)
    {
        builder.HasKey(x => x.Id);

        builder.Property(x => x.TargetType).IsRequired().HasMaxLength(32);
        builder.Property(x => x.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(x => x.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依「捕捉項目」查詢其衍生清單。
        builder.HasIndex(x => new { x.CaptureItemId, x.TargetType });

        // 隸屬於捕捉項目；硬刪除捕捉時連帶刪除其衍生關聯（衍生的筆記/任務本身不動）。
        builder.HasOne(x => x.CaptureItem)
            .WithMany()
            .HasForeignKey(x => x.CaptureItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
