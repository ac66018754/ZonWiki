namespace ZonWiki.Domain.Entities;

public class Category : AuditableEntity
{
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FolderPath { get; set; } = string.Empty;

    public Category? Parent { get; set; }
    public ICollection<Category> Children { get; set; } = new List<Category>();
    public ICollection<Article> Articles { get; set; } = new List<Article>();
}
