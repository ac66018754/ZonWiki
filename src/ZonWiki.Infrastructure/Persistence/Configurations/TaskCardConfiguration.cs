using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// TaskCard（任務卡片）的 EF Core 對應設定：
/// 設定主鍵、標題必填、與 TaskGroup 的選擇性關聯，以及常用查詢索引。
/// </summary>
public sealed class TaskCardConfiguration : IEntityTypeConfiguration<TaskCard>
{
    /// <summary>
    /// 設定 TaskCard 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TaskCard> builder)
    {
        builder.HasKey(t => t.Id);

        // 樂觀鎖（#4/#34）：以 PostgreSQL 系統欄 xmin 當併發權杖（免新增欄位）。
        // 更新時比對載入當下的 xmin；期間被其他來源改過則 SaveChanges 丟
        // DbUpdateConcurrencyException，端點回 409。
        builder.UseXminConcurrencyToken();

        builder.Property(t => t.Title).IsRequired().HasMaxLength(500);
        builder.Property(t => t.Status).IsRequired().HasMaxLength(64);
        builder.Property(t => t.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(t => t.UpdatedUser).IsRequired().HasMaxLength(128);

        builder.HasIndex(t => new { t.UserId, t.Status });
        builder.HasIndex(t => new { t.UserId, t.DueDateTime });
        // 行事曆／排程視圖依「使用者 + 預計時間」查詢，補上複合索引避免全表掃描（#37）。
        builder.HasIndex(t => new { t.UserId, t.PlannedDateTime });
        builder.HasIndex(t => t.GroupId);

        // 卡片可不屬於任何群組；刪除群組不連動刪除卡片（卡片改為未分組）。
        builder.HasOne(t => t.Group)
            .WithMany(g => g.TaskCards)
            .HasForeignKey(t => t.GroupId)
            .OnDelete(DeleteBehavior.SetNull);

        // 自我參照：父任務 ←→ 子任務（#8）。以軟刪除為主，故用 Restrict（刪父任務時由 app 連同處理子任務）。
        builder.HasIndex(t => t.ParentId);
        builder.HasOne(t => t.Parent)
            .WithMany(t => t.Children)
            .HasForeignKey(t => t.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        // 重複規則具現化（#17）：以「母規則 + 發生時間」查已產生的發生卡（含軟刪除，作為去重依據）。
        // RecurrenceSourceId 刻意為純量欄位（無關聯導覽），故不設定 FK，只建查詢索引。
        builder.HasIndex(t => new { t.RecurrenceSourceId, t.RecurrenceOccurrenceDateTime });
    }
}

/// <summary>
/// SubTask（子任務／檢核清單項目）的 EF Core 對應設定：
/// 設定主鍵、標題必填、與所屬 TaskCard 的關聯，以及「卡片內排序」的索引。
/// </summary>
public sealed class SubTaskConfiguration : IEntityTypeConfiguration<SubTask>
{
    /// <summary>
    /// 設定 SubTask 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<SubTask> builder)
    {
        builder.HasKey(s => s.Id);

        builder.Property(s => s.Title).IsRequired().HasMaxLength(500);
        builder.Property(s => s.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(s => s.UpdatedUser).IsRequired().HasMaxLength(128);

        // 依「卡片 + 排序」查詢同一張卡片的子任務清單。
        builder.HasIndex(s => new { s.TaskCardId, s.SortOrder });

        // 子任務隸屬於卡片；硬刪除卡片時連帶刪除子任務（軟刪除則由業務邏輯處理）。
        builder.HasOne(s => s.TaskCard)
            .WithMany(t => t.SubTasks)
            .HasForeignKey(s => s.TaskCardId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// TaskTag（任務卡片↔標籤 多對多，與筆記共用 Tag）的 EF Core 對應設定。
/// </summary>
public sealed class TaskTagConfiguration : IEntityTypeConfiguration<TaskTag>
{
    /// <summary>
    /// 設定 TaskTag 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<TaskTag> builder)
    {
        builder.HasKey(x => x.Id);
        // 每組（卡片, 標籤）至多一列（唯一索引未含 ValidFlag，故復活軟刪除列而非新增）。
        builder.HasIndex(x => new { x.TaskCardId, x.TagId }).IsUnique();

        builder.HasOne(x => x.TaskCard)
            .WithMany(t => t.TaskTags)
            .HasForeignKey(x => x.TaskCardId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Tag)
            .WithMany(t => t.TaskTags)
            .HasForeignKey(x => x.TagId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
