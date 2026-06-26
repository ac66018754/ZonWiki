using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Note（筆記）的 EF Core 對應設定：欄位限制、slug 於使用者範圍內唯一，以及常用查詢索引。
/// </summary>
public sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    /// <summary>
    /// 設定 Note 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Note> builder)
    {
        builder.HasKey(n => n.Id);

        builder.Property(n => n.Title).IsRequired().HasMaxLength(500);
        builder.Property(n => n.Slug).IsRequired().HasMaxLength(500);
        builder.Property(n => n.ContentHash).IsRequired().HasMaxLength(128);
        builder.Property(n => n.ContentRaw).IsRequired();
        builder.Property(n => n.ContentHtml).IsRequired();
        builder.Property(n => n.SourceFilePath).HasMaxLength(1024);
        builder.Property(n => n.Kind).IsRequired().HasMaxLength(32);
        builder.Property(n => n.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(n => n.UpdatedUser).IsRequired().HasMaxLength(128);

        // 同一位使用者底下 slug 唯一——但「只對還活著的筆記」強制唯一（partial unique index）。
        // 決策（見 docs：軟刪除不該佔用 slug 名額）：唯一索引加上 WHERE "Note_ValidFlag" = TRUE，
        // 讓「已軟刪除（進垃圾桶）/ 已永久刪除（purged）」的筆記不再佔住 slug；否則「建立又刪除、
        // 再用同名重建」會撞唯一索引而回 500（建立端的去重迴圈只看有效筆記，與此 partial 條件一致）。
        // 還原時若同 slug 已被有效筆記佔用，由 TrashEndpoints 的還原流程自動為被還原者加序號避免衝突。
        // 註：HasFilter 內為原生 SQL，需用「命名慣例產生後」的實際欄名 "Note_ValidFlag"（非屬性名）。
        builder.HasIndex(n => new { n.UserId, n.Slug })
            .IsUnique()
            .HasFilter("\"Note_ValidFlag\" = TRUE");
        // 匯入時以 (使用者, 來源檔路徑) 比對。
        builder.HasIndex(n => new { n.UserId, n.SourceFilePath });
        // 日記依日期查詢。
        builder.HasIndex(n => new { n.UserId, n.Kind, n.JournalDate });
    }
}
