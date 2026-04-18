using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Infrastructure.Auth;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure;

public static class DependencyInjection
{
    public const string PostgresConnectionName = "Postgres";

    public static IServiceCollection AddZonWikiInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString(PostgresConnectionName)
            ?? throw new InvalidOperationException(
                $"Connection string '{PostgresConnectionName}' is not configured.");

        services.AddSingleton<AuditingSaveChangesInterceptor>();

        services.AddDbContext<ZonWikiDbContext>((sp, options) =>
        {
            options
                .UseNpgsql(connectionString, npgsql =>
                    npgsql.MigrationsAssembly(typeof(ZonWikiDbContext).Assembly.FullName))
                .AddInterceptors(sp.GetRequiredService<AuditingSaveChangesInterceptor>());
        });

        services.AddOptions<NotesSyncOptions>()
            .Bind(configuration.GetSection(NotesSyncOptions.SectionName))
            .ValidateOnStart();

        services.AddScoped<NotesSyncService>();
        services.AddScoped<UserProvisioningService>();

        return services;
    }

    public static IServiceCollection AddZonWikiNotesBackgroundSync(this IServiceCollection services)
    {
        services.AddHostedService<NotesSyncBackgroundService>();
        return services;
    }
}
