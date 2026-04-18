namespace ZonWiki.Domain.Entities;

public abstract class AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedDateTime { get; set; }
    public string CreatedUser { get; set; } = "system";
    public DateTime UpdatedDateTime { get; set; }
    public string UpdatedUser { get; set; } = "system";
    public bool ValidFlag { get; set; } = true;
}
