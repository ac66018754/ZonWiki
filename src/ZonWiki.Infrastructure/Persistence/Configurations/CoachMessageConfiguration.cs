using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// CoachMessage（教練逐字稿訊息）的 EF Core 對應設定（其他功能群 Phase 3）。
/// 重點：<b>唯一索引 (CoachSessionId, SeqNo)</b>（【審修-A4】單寫者防呆背板，同場序號不得重複）、
/// Role 設長度上限、Content 無界 text、CorrectionJson nullable text。
/// FK→CoachSession 的 Restrict 由 <see cref="CoachSessionConfiguration"/> 的 HasMany 關聯一併定義（不重複設定）。
/// 欄名／索引名皆由 <c>ApplyZonWikiNamingConventions</c> 自動產生（CoachMessage_{Property}）。
/// </summary>
public sealed class CoachMessageConfiguration : IEntityTypeConfiguration<CoachMessage>
{
    /// <summary>
    /// 設定 CoachMessage 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CoachMessage> builder)
    {
        builder.HasKey(m => m.Id);

        builder.Property(m => m.Role).IsRequired().HasMaxLength(32);
        builder.Property(m => m.Content).IsRequired(); // text（逐字稿，不設長度）
        builder.Property(m => m.CorrectionJson); // text，nullable（糾錯卡 JSON）
        builder.Property(m => m.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(m => m.UpdatedUser).IsRequired().HasMaxLength(128);

        // 【審修-A4】唯一索引 (CoachSessionId, SeqNo)：同一場的序號不得重複，作為單寫者的資料庫層防呆背板。
        // 刻意「不含 ValidFlag」：SeqNo 由 max+1 種子，逐字稿不走復活軟刪 upsert，故單純鎖同場序號唯一。
        builder.HasIndex(m => new { m.CoachSessionId, m.SeqNo }).IsUnique();
    }
}
