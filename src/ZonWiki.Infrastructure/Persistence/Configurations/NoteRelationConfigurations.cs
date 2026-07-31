using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// NoteCategory（筆記↔分類 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class NoteCategoryConfiguration : IEntityTypeConfiguration<NoteCategory>
{
    /// <summary>
    /// 設定 NoteCategory 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteCategory> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasIndex(x => new { x.NoteId, x.CategoryId }).IsUnique();

        builder.HasOne(x => x.Note)
            .WithMany(n => n.NoteCategories)
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Category)
            .WithMany(c => c.NoteCategories)
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// NoteTag（筆記↔標籤 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class NoteTagConfiguration : IEntityTypeConfiguration<NoteTag>
{
    /// <summary>
    /// 設定 NoteTag 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteTag> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasIndex(x => new { x.NoteId, x.TagId }).IsUnique();

        builder.HasOne(x => x.Note)
            .WithMany(n => n.NoteTags)
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Tag)
            .WithMany(t => t.NoteTags)
            .HasForeignKey(x => x.TagId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// NoteLink（筆記↔筆記 連結 / 知識圖譜邊）的 EF Core 對應設定。
/// </summary>
public sealed class NoteLinkConfiguration : IEntityTypeConfiguration<NoteLink>
{
    /// <summary>
    /// 設定 NoteLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteLink> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.AnchorText).IsRequired().HasMaxLength(500);
        builder.HasIndex(x => new { x.UserId, x.SourceNoteId });
        builder.HasIndex(x => x.TargetNoteId);

        builder.HasOne(x => x.SourceNote)
            .WithMany()
            .HasForeignKey(x => x.SourceNoteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.TargetNote)
            .WithMany()
            .HasForeignKey(x => x.TargetNoteId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// NoteRevision（筆記編輯歷史）的 EF Core 對應設定。
/// </summary>
public sealed class NoteRevisionConfiguration : IEntityTypeConfiguration<NoteRevision>
{
    /// <summary>
    /// 設定 NoteRevision 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteRevision> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.ChangeKind).IsRequired().HasMaxLength(16);
        builder.Property(x => x.Title).IsRequired().HasMaxLength(500);
        builder.HasIndex(x => new { x.NoteId, x.RevisionNo }).IsUnique();

        builder.HasOne(x => x.Note)
            .WithMany()
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// NoteOverlaySnapshot（筆記浮層手動快照）的 EF Core 對應設定。
/// </summary>
public sealed class NoteOverlaySnapshotConfiguration : IEntityTypeConfiguration<NoteOverlaySnapshot>
{
    /// <summary>
    /// 設定 NoteOverlaySnapshot 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteOverlaySnapshot> builder)
    {
        builder.HasKey(x => x.Id);
        // ItemsJson 不限長度（塗鴉資料可能較大）；Summary 為顯示用短字串。
        builder.Property(x => x.ItemsJson).IsRequired();
        builder.Property(x => x.Summary).IsRequired().HasMaxLength(NoteOverlaySnapshot.SummaryMaxLength);
        // (NoteId, SnapshotNo) 唯一：取號必須無視查詢過濾器看全部列（同 NoteRevision 的教訓）。
        builder.HasIndex(x => new { x.NoteId, x.SnapshotNo }).IsUnique();

        builder.HasOne(x => x.Note)
            .WithMany()
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// NoteSlugAlias（筆記舊網址代稱）的 EF Core 對應設定。
/// </summary>
public sealed class NoteSlugAliasConfiguration : IEntityTypeConfiguration<NoteSlugAlias>
{
    /// <summary>
    /// 設定 NoteSlugAlias 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteSlugAlias> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Slug).IsRequired().HasMaxLength(NoteSlugAlias.SlugMaxLength);
        builder.Property(x => x.OriginalTitle).IsRequired().HasMaxLength(NoteSlugAlias.SlugMaxLength);

        // (UserId, Slug, NoteId) 唯一——但「只對還有效的列」強制唯一（partial unique index，比照 Note.Slug）。
        // 為什麼要 partial：反覆改名（S→S2→S…）會把同一個 (使用者, slug, 筆記) 的別名在「有效／軟刪」間翻轉，
        // 寫入邏輯以「復活軟刪列」重用同一列（不新增），若唯一索引不分 ValidFlag，被軟刪的別名仍佔住名額，
        // 下一輪復活前的存在檢查與新增就可能撞唯一索引整批 500。加上 WHERE ValidFlag = TRUE 讓軟刪列不佔名額。
        // 註：HasFilter 內為原生 SQL，需用命名慣例產生後的實際欄名 "NoteSlugAlias_ValidFlag"（非屬性名）。
        builder.HasIndex(x => new { x.UserId, x.Slug, x.NoteId })
            .IsUnique()
            .HasFilter("\"NoteSlugAlias_ValidFlag\" = TRUE");

        // 解析查詢用（GET /api/notes/{slug} 以 (UserId, Slug) 找命中的別名）：一般（非唯一）索引。
        builder.HasIndex(x => new { x.UserId, x.Slug });

        builder.HasOne(x => x.Note)
            .WithMany()
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// NoteTaskLink（筆記↔任務卡片 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class NoteTaskLinkConfiguration : IEntityTypeConfiguration<NoteTaskLink>
{
    /// <summary>
    /// 設定 NoteTaskLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NoteTaskLink> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasIndex(x => new { x.NoteId, x.TaskCardId }).IsUnique();

        builder.HasOne(x => x.Note)
            .WithMany()
            .HasForeignKey(x => x.NoteId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.TaskCard)
            .WithMany()
            .HasForeignKey(x => x.TaskCardId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
