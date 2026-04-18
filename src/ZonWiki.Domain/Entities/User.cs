namespace ZonWiki.Domain.Entities;

public class User : AuditableEntity
{
    public string GoogleSub { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }

    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
