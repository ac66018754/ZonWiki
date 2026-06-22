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
