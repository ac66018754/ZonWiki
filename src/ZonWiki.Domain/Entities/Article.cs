namespace ZonWiki.Domain.Entities;

public class Article : AuditableEntity
{
    public Guid CategoryId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public string ContentHash { get; set; } = string.Empty;
    public string ContentRaw { get; set; } = string.Empty;
    public string ContentHtml { get; set; } = string.Empty;
    public bool PublishedFlag { get; set; } = true;

    public Category? Category { get; set; }
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
