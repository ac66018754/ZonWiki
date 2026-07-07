using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// TtsAudio（筆記朗讀語音快取品）的 EF Core 對應設定。
/// 重點：唯一索引 (UserId, ContentHash) <b>不含 ValidFlag</b>（復活軟刪列 upsert 慣例）、
/// 清理／清單索引 (UserId, NoteId, ValidFlag)、來源筆記單向可空 FK 禁止硬刪連鎖、
/// ScriptJson／ChaptersJson 為無界 text。欄名／索引名／FK 名皆由 <c>ApplyZonWikiNamingConventions</c> 自動產生。
/// </summary>
public sealed class TtsAudioConfiguration : IEntityTypeConfiguration<TtsAudio>
{
    /// <summary>
    /// 設定 TtsAudio 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TtsAudio> builder)
    {
        builder.HasKey(t => t.Id);

        builder.Property(t => t.ContentHash).IsRequired().HasMaxLength(64);
        builder.Property(t => t.ScriptJson).IsRequired(); // text（口語稿，不設長度）
        builder.Property(t => t.ChaptersJson); // text，nullable
        builder.Property(t => t.Status).IsRequired().HasMaxLength(16);
        builder.Property(t => t.VoiceName).IsRequired().HasMaxLength(64);
        builder.Property(t => t.ModelKey).IsRequired().HasMaxLength(64);
        builder.Property(t => t.FilePath).IsRequired().HasMaxLength(512);
        builder.Property(t => t.ContentType).IsRequired().HasMaxLength(64);
        builder.Property(t => t.ErrorText).HasMaxLength(500);
        builder.Property(t => t.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(t => t.UpdatedUser).IsRequired().HasMaxLength(128);

        // 快取鍵唯一索引 (UserId, ContentHash)，刻意「不含 ValidFlag」：同鍵重複走「復活軟刪列」upsert
        //（含 ValidFlag 會造成「同鍵 1 活＋1 死並存、第二次軟刪違反唯一約束」，碼庫慣例）。
        builder.HasIndex(t => new { t.UserId, t.ContentHash }).IsUnique();

        // 清理／清單索引 (UserId, NoteId, ValidFlag)：覆蓋「同一筆記＋聲音重合成即失效舊列」的查詢。
        builder.HasIndex(t => new { t.UserId, t.NoteId, t.ValidFlag });

        // 來源筆記：單向可空 FK；禁止硬刪連鎖（本系統一律軟刪除）。
        builder.HasOne(t => t.Note)
            .WithMany()
            .HasForeignKey(t => t.NoteId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
