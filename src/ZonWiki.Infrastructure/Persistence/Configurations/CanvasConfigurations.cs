using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// Canvas（畫布）的 EF Core 對應設定。
/// </summary>
public sealed class CanvasConfiguration : IEntityTypeConfiguration<Canvas>
{
    /// <summary>
    /// 設定 Canvas 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Canvas> builder)
    {
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Title).IsRequired().HasMaxLength(500);
        builder.Property(c => c.Description).HasMaxLength(2000);
        builder.Property(c => c.StateJson).IsRequired();
        builder.Property(c => c.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(c => c.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者範圍內的常用查詢索引。
        builder.HasIndex(c => new { c.UserId, c.CreatedDateTime });
        builder.HasIndex(c => new { c.UserId, c.ValidFlag });

        builder.HasMany(c => c.Nodes)
            .WithOne(n => n.Canvas)
            .HasForeignKey(n => n.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(c => c.Edges)
            .WithOne(e => e.Canvas)
            .HasForeignKey(e => e.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(c => c.CanvasCategories)
            .WithOne(cc => cc.Canvas)
            .HasForeignKey(cc => cc.CanvasId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(c => c.CanvasSystemPrompts)
            .WithOne(csp => csp.Canvas)
            .HasForeignKey(csp => csp.CanvasId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(c => c.InlineLinks)
            .WithOne(il => il.Canvas)
            .HasForeignKey(il => il.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// Node（節點）的 EF Core 對應設定。
/// </summary>
public sealed class NodeConfiguration : IEntityTypeConfiguration<Node>
{
    /// <summary>
    /// 設定 Node 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Node> builder)
    {
        builder.HasKey(n => n.Id);

        builder.Property(n => n.Title).HasMaxLength(500);
        builder.Property(n => n.Content).IsRequired();
        builder.Property(n => n.Origin).IsRequired().HasMaxLength(32);
        builder.Property(n => n.Model).HasMaxLength(64);
        builder.Property(n => n.Color).HasMaxLength(32);
        builder.Property(n => n.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(n => n.UpdatedUser).IsRequired().HasMaxLength(128);

        // 畫布內的節點查詢與自我參考索引。
        builder.HasIndex(n => new { n.CanvasId, n.ValidFlag });
        builder.HasIndex(n => new { n.ParentId, n.ValidFlag });

        builder.HasOne(n => n.Canvas)
            .WithMany(c => c.Nodes)
            .HasForeignKey(n => n.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(n => n.Parent)
            .WithMany(p => p.Children)
            .HasForeignKey(n => n.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(n => n.Children)
            .WithOne(c => c.Parent)
            .HasForeignKey(c => c.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(n => n.Revisions)
            .WithOne(nr => nr.Node)
            .HasForeignKey(nr => nr.NodeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(n => n.Images)
            .WithOne(ni => ni.Node)
            .HasForeignKey(ni => ni.NodeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(n => n.Highlights)
            .WithOne(h => h.Node)
            .HasForeignKey(h => h.NodeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// Edge（連線）的 EF Core 對應設定。
/// </summary>
public sealed class EdgeConfiguration : IEntityTypeConfiguration<Edge>
{
    /// <summary>
    /// 設定 Edge 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Edge> builder)
    {
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Kind).IsRequired().HasMaxLength(32);
        builder.Property(e => e.Label).HasMaxLength(500);
        builder.Property(e => e.SourceHandle).HasMaxLength(8);
        builder.Property(e => e.TargetHandle).HasMaxLength(8);
        builder.Property(e => e.DataJson).IsRequired();
        builder.Property(e => e.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(e => e.UpdatedUser).IsRequired().HasMaxLength(128);

        // 來源與目標節點的連線查詢索引。
        builder.HasIndex(e => new { e.SourceNodeId, e.ValidFlag });
        builder.HasIndex(e => new { e.TargetNodeId, e.ValidFlag });

        builder.HasOne(e => e.Canvas)
            .WithMany(c => c.Edges)
            .HasForeignKey(e => e.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// SystemPrompt（系統提示）的 EF Core 對應設定。
/// </summary>
public sealed class SystemPromptConfiguration : IEntityTypeConfiguration<SystemPrompt>
{
    /// <summary>
    /// 設定 SystemPrompt 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<SystemPrompt> builder)
    {
        builder.HasKey(sp => sp.Id);

        builder.Property(sp => sp.Title).IsRequired().HasMaxLength(500);
        builder.Property(sp => sp.Content).IsRequired();
        builder.Property(sp => sp.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(sp => sp.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者範圍內的查詢索引。
        builder.HasIndex(sp => new { sp.UserId, sp.IsGlobal });
        builder.HasIndex(sp => new { sp.UserId, sp.ValidFlag });

        builder.HasMany(sp => sp.CategorySystemPrompts)
            .WithOne(csp => csp.SystemPrompt)
            .HasForeignKey(csp => csp.SystemPromptId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(sp => sp.CanvasSystemPrompts)
            .WithOne(csp => csp.SystemPrompt)
            .HasForeignKey(csp => csp.SystemPromptId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// CanvasCat（畫布分類，為避免與筆記 Category 衝突而改名）的 EF Core 對應設定。
/// </summary>
public sealed class CanvasCatConfiguration : IEntityTypeConfiguration<CanvasCat>
{
    /// <summary>
    /// 設定 CanvasCat 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CanvasCat> builder)
    {
        builder.HasKey(cc => cc.Id);

        builder.Property(cc => cc.Name).IsRequired().HasMaxLength(500);
        builder.Property(cc => cc.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(cc => cc.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者範圍內的查詢索引。
        builder.HasIndex(cc => new { cc.UserId, cc.ValidFlag });

        builder.HasMany(cc => cc.CanvasCategories)
            .WithOne(c => c.Category)
            .HasForeignKey(c => c.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(cc => cc.CategorySystemPrompts)
            .WithOne(csp => csp.Category)
            .HasForeignKey(csp => csp.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// CanvasCategory（畫布↔分類 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class CanvasCategoryConfiguration : IEntityTypeConfiguration<CanvasCategory>
{
    /// <summary>
    /// 設定 CanvasCategory 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CanvasCategory> builder)
    {
        builder.HasKey(cc => cc.Id);
        builder.HasIndex(cc => new { cc.CanvasId, cc.CategoryId }).IsUnique();
        builder.HasIndex(cc => cc.CategoryId);

        builder.HasOne(cc => cc.Canvas)
            .WithMany(c => c.CanvasCategories)
            .HasForeignKey(cc => cc.CanvasId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(cc => cc.Category)
            .WithMany(c => c.CanvasCategories)
            .HasForeignKey(cc => cc.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// CategorySystemPrompt（分類↔System Prompt 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class CategorySystemPromptConfiguration : IEntityTypeConfiguration<CategorySystemPrompt>
{
    /// <summary>
    /// 設定 CategorySystemPrompt 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CategorySystemPrompt> builder)
    {
        builder.HasKey(csp => csp.Id);
        builder.HasIndex(csp => new { csp.CategoryId, csp.SystemPromptId }).IsUnique();
        builder.HasIndex(csp => csp.SystemPromptId);

        builder.HasOne(csp => csp.Category)
            .WithMany(c => c.CategorySystemPrompts)
            .HasForeignKey(csp => csp.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(csp => csp.SystemPrompt)
            .WithMany(sp => sp.CategorySystemPrompts)
            .HasForeignKey(csp => csp.SystemPromptId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// CanvasSystemPrompt（畫布↔System Prompt 多對多）的 EF Core 對應設定。
/// </summary>
public sealed class CanvasSystemPromptConfiguration : IEntityTypeConfiguration<CanvasSystemPrompt>
{
    /// <summary>
    /// 設定 CanvasSystemPrompt 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<CanvasSystemPrompt> builder)
    {
        builder.HasKey(csp => csp.Id);
        builder.HasIndex(csp => new { csp.CanvasId, csp.SystemPromptId }).IsUnique();
        builder.HasIndex(csp => csp.SystemPromptId);

        builder.HasOne(csp => csp.Canvas)
            .WithMany(c => c.CanvasSystemPrompts)
            .HasForeignKey(csp => csp.CanvasId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(csp => csp.SystemPrompt)
            .WithMany(sp => sp.CanvasSystemPrompts)
            .HasForeignKey(csp => csp.SystemPromptId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// InlineLink（行內連結）的 EF Core 對應設定。
/// </summary>
public sealed class InlineLinkConfiguration : IEntityTypeConfiguration<InlineLink>
{
    /// <summary>
    /// 設定 InlineLink 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<InlineLink> builder)
    {
        builder.HasKey(il => il.Id);

        builder.Property(il => il.AnchorText).IsRequired().HasMaxLength(1000);
        builder.Property(il => il.AnchorPrefix).HasMaxLength(500);
        builder.Property(il => il.AnchorSuffix).HasMaxLength(500);
        builder.Property(il => il.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(il => il.UpdatedUser).IsRequired().HasMaxLength(128);

        // 來源與目標節點的連結查詢索引。
        builder.HasIndex(il => new { il.SourceNodeId, il.ValidFlag });
        builder.HasIndex(il => new { il.TargetNodeId, il.ValidFlag });

        builder.HasOne(il => il.Canvas)
            .WithMany(c => c.InlineLinks)
            .HasForeignKey(il => il.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(il => il.SourceNode)
            .WithMany()
            .HasForeignKey(il => il.SourceNodeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(il => il.TargetNode)
            .WithMany()
            .HasForeignKey(il => il.TargetNodeId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// Highlight（重點標記）的 EF Core 對應設定。
/// </summary>
public sealed class HighlightConfiguration : IEntityTypeConfiguration<Highlight>
{
    /// <summary>
    /// 設定 Highlight 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<Highlight> builder)
    {
        builder.HasKey(h => h.Id);

        builder.Property(h => h.AnchorText).IsRequired().HasMaxLength(1000);
        builder.Property(h => h.AnchorPrefix).HasMaxLength(500);
        builder.Property(h => h.AnchorSuffix).HasMaxLength(500);
        builder.Property(h => h.Color).IsRequired().HasMaxLength(32);
        builder.Property(h => h.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(h => h.UpdatedUser).IsRequired().HasMaxLength(128);

        // 節點內的重點標記查詢索引。
        builder.HasIndex(h => new { h.NodeId, h.ValidFlag });

        builder.HasOne(h => h.Node)
            .WithMany(n => n.Highlights)
            .HasForeignKey(h => h.NodeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// NodeImage（節點圖片）的 EF Core 對應設定。
/// </summary>
public sealed class NodeImageConfiguration : IEntityTypeConfiguration<NodeImage>
{
    /// <summary>
    /// 設定 NodeImage 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NodeImage> builder)
    {
        builder.HasKey(ni => ni.Id);

        builder.Property(ni => ni.Prompt).IsRequired();
        builder.Property(ni => ni.Model).IsRequired().HasMaxLength(128);
        builder.Property(ni => ni.FilePath).IsRequired().HasMaxLength(1024);
        builder.Property(ni => ni.ContentType).IsRequired().HasMaxLength(64);
        builder.Property(ni => ni.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(ni => ni.UpdatedUser).IsRequired().HasMaxLength(128);

        // 節點與畫布的圖片查詢索引。
        builder.HasIndex(ni => new { ni.NodeId, ni.ValidFlag });
        builder.HasIndex(ni => new { ni.CanvasId, ni.ValidFlag });

        builder.HasOne(ni => ni.Node)
            .WithMany(n => n.Images)
            .HasForeignKey(ni => ni.NodeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(ni => ni.Canvas)
            .WithMany()
            .HasForeignKey(ni => ni.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// NodeRevision（節點編輯紀錄）的 EF Core 對應設定。
/// </summary>
public sealed class NodeRevisionConfiguration : IEntityTypeConfiguration<NodeRevision>
{
    /// <summary>
    /// 設定 NodeRevision 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<NodeRevision> builder)
    {
        builder.HasKey(nr => nr.Id);

        builder.Property(nr => nr.Content).IsRequired();
        builder.Property(nr => nr.Source).IsRequired().HasMaxLength(32);
        builder.Property(nr => nr.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(nr => nr.UpdatedUser).IsRequired().HasMaxLength(128);

        // 節點的編輯紀錄查詢索引。
        builder.HasIndex(nr => new { nr.NodeId, nr.ValidFlag });

        builder.HasOne(nr => nr.Node)
            .WithMany(n => n.Revisions)
            .HasForeignKey(nr => nr.NodeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>
/// AiSession（AI 提問紀錄）的 EF Core 對應設定。
/// </summary>
public sealed class AiSessionConfiguration : IEntityTypeConfiguration<AiSession>
{
    /// <summary>
    /// 設定 AiSession 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<AiSession> builder)
    {
        builder.HasKey(ai => ai.Id);

        builder.Property(ai => ai.Kind).IsRequired().HasMaxLength(32);
        builder.Property(ai => ai.PromptText).IsRequired();
        builder.Property(ai => ai.Status).IsRequired().HasMaxLength(32);
        builder.Property(ai => ai.TokenUsageJson).IsRequired();
        builder.Property(ai => ai.QuestionText).HasMaxLength(2000);
        builder.Property(ai => ai.AnchorText).HasMaxLength(2000);
        builder.Property(ai => ai.ErrorText).HasMaxLength(1000);
        builder.Property(ai => ai.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(ai => ai.UpdatedUser).IsRequired().HasMaxLength(128);

        // 使用者與畫布範圍的 AI Session 查詢索引。
        builder.HasIndex(ai => new { ai.UserId, ai.CreatedDateTime });
        builder.HasIndex(ai => new { ai.CanvasId, ai.ValidFlag });

        builder.HasMany(ai => ai.Messages)
            .WithOne(am => am.Session)
            .HasForeignKey(am => am.SessionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(ai => ai.Canvas)
            .WithMany()
            .HasForeignKey(ai => ai.CanvasId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(ai => ai.AskNode)
            .WithMany()
            .HasForeignKey(ai => ai.AskNodeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(ai => ai.ResultNode)
            .WithMany()
            .HasForeignKey(ai => ai.ResultNodeId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

/// <summary>
/// AiMessage（AI 訊息串流）的 EF Core 對應設定。
/// </summary>
public sealed class AiMessageConfiguration : IEntityTypeConfiguration<AiMessage>
{
    /// <summary>
    /// 設定 AiMessage 實體的對應規則。
    /// </summary>
    /// <param name="builder">EF Core 提供的實體型別建構器。</param>
    public void Configure(EntityTypeBuilder<AiMessage> builder)
    {
        builder.HasKey(am => am.Id);

        builder.Property(am => am.Role).IsRequired().HasMaxLength(32);
        builder.Property(am => am.Content).IsRequired();
        builder.Property(am => am.RawJsonLine).IsRequired();
        builder.Property(am => am.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(am => am.UpdatedUser).IsRequired().HasMaxLength(128);

        // Session 內的訊息順序索引。
        builder.HasIndex(am => new { am.SessionId, am.SeqNo });

        builder.HasOne(am => am.Session)
            .WithMany(ai => ai.Messages)
            .HasForeignKey(am => am.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
