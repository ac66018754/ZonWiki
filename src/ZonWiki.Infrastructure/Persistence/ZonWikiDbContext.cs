using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

public sealed class ZonWikiDbContext(DbContextOptions<ZonWikiDbContext> options) : DbContext(options)
{
    public DbSet<User> User => Set<User>();
    public DbSet<Category> Category => Set<Category>();
    public DbSet<Article> Article => Set<Article>();
    public DbSet<Comment> Comment => Set<Comment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ZonWikiDbContext).Assembly);
        modelBuilder.ApplyZonWikiNamingConventions();
    }
}
