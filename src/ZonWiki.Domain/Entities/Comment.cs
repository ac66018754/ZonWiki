namespace ZonWiki.Domain.Entities;

public class Comment : AuditableEntity
{
    public Guid ArticleId { get; set; }
    public Guid UserId { get; set; }
    public string Content { get; set; } = string.Empty;
    public string AnchorType { get; set; } = "full";
    public string? AnchorData { get; set; }

    public Article? Article { get; set; }
    public User? User { get; set; }
}
