using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// VocabularyWord（單字卡）的 EF Core 對應設定。
/// 重點：唯一索引 (UserId, Word) <b>不含 ValidFlag</b>（復活軟刪列 upsert 慣例）、到期佇列索引
/// (UserId, Due, ValidFlag)、State 明示存 int、來源筆記單向可空 FK 禁止硬刪連鎖。
/// 欄名／索引名／FK 名皆由 <c>ApplyZonWikiNamingConventions</c> 自動產生（VocabularyWord_{Property}）。
/// </summary>
public sealed class VocabularyWordConfiguration : IEntityTypeConfiguration<VocabularyWord>
{
    /// <summary>
    /// 設定 VocabularyWord 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<VocabularyWord> builder)
    {
        builder.HasKey(v => v.Id);

        builder.Property(v => v.Word).IsRequired().HasMaxLength(200);
        builder.Property(v => v.Phonetic).HasMaxLength(128);
        builder.Property(v => v.PartOfSpeech).HasMaxLength(64);
        builder.Property(v => v.DefinitionEn); // text（不設長度）
        builder.Property(v => v.DefinitionZh);
        builder.Property(v => v.ExampleSentence);
        builder.Property(v => v.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(v => v.UpdatedUser).IsRequired().HasMaxLength(128);

        // enum→int（明示，對齊設計書 _State(int)；換 FSRS 時重算不動表）。
        builder.Property(v => v.State).HasConversion<int>();

        // 唯一索引 (UserId, Word)，刻意「不含 ValidFlag」：同字重複入庫走「復活軟刪列」upsert
        //（含 ValidFlag 會造成「同字 1 活＋1 死並存、第二次軟刪違反唯一約束」）。
        builder.HasIndex(v => new { v.UserId, v.Word }).IsUnique();

        // 到期佇列索引 (UserId, Due, ValidFlag)：覆蓋「某人今日到期的有效卡」查詢（GET /due）。
        builder.HasIndex(v => new { v.UserId, v.Due, v.ValidFlag });

        // 來源筆記：單向可空 FK；禁止硬刪連鎖（本系統一律軟刪除）。
        builder.HasOne(v => v.SourceNote)
            .WithMany()
            .HasForeignKey(v => v.SourceNoteId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
