using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// CoachSession（英文教練場次）的 EF Core 對應設定（其他功能群 Phase 3）。
/// 重點：清單索引 (UserId, Status, UpdatedDateTime)、Title／Model／Status 設長度上限、
/// SummaryText／ResumptionHandle 為無界／nullable text、
/// 子訊息關聯 <c>Messages</c> 禁止硬刪連鎖（OnDelete.Restrict，軟刪不連鎖硬刪）。
/// 欄名／索引名／FK 名皆由 <c>ApplyZonWikiNamingConventions</c> 自動產生（CoachSession_{Property}）。
/// </summary>
public sealed class CoachSessionConfiguration : IEntityTypeConfiguration<CoachSession>
{
    /// <summary>
    /// 設定 CoachSession 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CoachSession> builder)
    {
        builder.HasKey(s => s.Id);

        builder.Property(s => s.Title).IsRequired().HasMaxLength(200);
        builder.Property(s => s.Topic).HasMaxLength(200);
        builder.Property(s => s.Status).IsRequired().HasMaxLength(16);
        builder.Property(s => s.Model).IsRequired().HasMaxLength(128);
        builder.Property(s => s.SummaryText); // text（整場摘要，不設長度）
        builder.Property(s => s.ResumptionHandle); // text，nullable（opaque 續連句柄，長度不定）
        builder.Property(s => s.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(s => s.UpdatedUser).IsRequired().HasMaxLength(128);

        // 清單／日分鐘計量索引 (UserId, Status, UpdatedDateTime)：覆蓋「某人 active 場次／近期場次」查詢，
        // 以及懶惰殭屍修正（active 且 UpdatedDateTime < now-2h）。
        builder.HasIndex(s => new { s.UserId, s.Status, s.UpdatedDateTime });

        // 子訊息：禁止硬刪連鎖（本系統一律軟刪除；此關聯同時定義 CoachMessage.CoachSessionId 這個 FK）。
        builder.HasMany(s => s.Messages)
            .WithOne(m => m.CoachSession)
            .HasForeignKey(m => m.CoachSessionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
