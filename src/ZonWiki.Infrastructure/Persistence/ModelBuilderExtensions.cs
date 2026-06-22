using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// Applies the global naming rule from CLAUDE.md:
///   - Table names: PascalCase, no underscores (uses the entity class name)
///   - Column names: {TableName}_{PropertyName}
///   - Every auditable entity has the six mandatory audit fields
/// </summary>
public static class ModelBuilderExtensions
{
    public static void ApplyZonWikiNamingConventions(this ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            var clrType = entityType.ClrType;
            if (!typeof(AuditableEntity).IsAssignableFrom(clrType))
            {
                continue;
            }

            var tableName = clrType.Name;
            entityType.SetTableName(tableName);

            foreach (var property in entityType.GetProperties())
            {
                property.SetColumnName($"{tableName}_{property.Name}");
            }

            foreach (var key in entityType.GetKeys())
            {
                key.SetName($"PK_{tableName}");
            }

            foreach (var foreignKey in entityType.GetForeignKeys())
            {
                var principalTable = foreignKey.PrincipalEntityType.ClrType.Name;
                var columns = string.Join("_", foreignKey.Properties.Select(p => p.Name));
                foreignKey.SetConstraintName($"FK_{tableName}_{principalTable}_{columns}");
            }

            foreach (var index in entityType.GetIndexes())
            {
                var columns = string.Join("_", index.Properties.Select(p => p.Name));
                var prefix = index.IsUnique ? "UX" : "IX";
                index.SetDatabaseName($"{prefix}_{tableName}_{columns}");
            }
        }
    }
}
