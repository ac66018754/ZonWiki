using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ZonWiki.Infrastructure.Notes;

public sealed class NotesSyncBackgroundService(
    IServiceScopeFactory scopeFactory,
    IOptions<NotesSyncOptions> options,
    ILogger<NotesSyncBackgroundService> logger)
    : BackgroundService
{
    private readonly NotesSyncOptions _options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunSyncAsync(stoppingToken);

        using var timer = new PeriodicTimer(_options.ScanInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunSyncAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown
        }
    }

    private async Task RunSyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var sync = scope.ServiceProvider.GetRequiredService<NotesSyncService>();
            await sync.SyncAllAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Notes sync failed in background service");
        }
    }
}
