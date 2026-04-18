using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Endpoints;
using ZonWiki.Domain.Common;
using ZonWiki.Infrastructure;
using ZonWiki.Infrastructure.Notes;
using ZonWiki.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicyName = "ZonWikiCors";
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:3000"];

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

builder.Services.AddZonWikiInfrastructure(builder.Configuration);
builder.Services.AddZonWikiNotesBackgroundSync();
builder.Services.AddZonWikiAuth(builder.Configuration, out var authConfigured);

var connectionString = builder.Configuration.GetConnectionString(
    DependencyInjection.PostgresConnectionName)
    ?? throw new InvalidOperationException("Postgres connection string missing.");

builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres");

builder.Services.AddOpenApi();

var app = builder.Build();

// Apply migrations on startup (dev convenience).
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();
    await dbContext.Database.MigrateAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors(CorsPolicyName);

if (authConfigured)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

app.MapHealthChecks("/healthz");
app.MapGet("/", () => Results.Ok(new { name = "ZonWiki API", status = "alive", authConfigured }));

app.MapPost("/api/sync/trigger", async (NotesSyncService syncService, CancellationToken ct) =>
{
    var result = await syncService.SyncAllAsync(ct);
    return Results.Ok(ApiResponse<NotesSyncResult>.Ok(result));
});

app.MapZonWikiAuthEndpoints(authConfigured);
app.MapCategoryEndpoints();
app.MapArticleEndpoints();
app.MapCommentEndpoints(authConfigured);

app.Run();

public partial class Program;
