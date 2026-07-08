using Microsoft.Extensions.Options;

namespace ZonWiki.Api.Attachments;

/// <summary>
/// 孤兒附件定期清掃背景服務：啟動先跑一輪，之後每 <see cref="AttachmentOptions.OrphanScanIntervalHours"/>
/// 小時跑一輪（預設每日）。實際掃描邏輯在 <see cref="AttachmentOrphanScanner"/>（獨立類別以便測試）。
/// </summary>
public sealed class AttachmentOrphanCleanupService(
    AttachmentOrphanScanner scanner,
    IOptions<AttachmentOptions> options,
    ILogger<AttachmentOrphanCleanupService> logger) : BackgroundService
{
    /// <summary>
    /// 背景主迴圈：啟動先跑一輪，之後依設定間隔輪詢；停止時安靜結束。
    /// </summary>
    /// <param name="stoppingToken">應用程式關閉時觸發的取消權杖。</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromHours(Math.Max(1, options.Value.OrphanScanIntervalHours));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await scanner.ScanOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break; // 正常關閉。
            }
            catch (Exception ex)
            {
                // 背景服務不可因單次例外整組掛掉；記錄後等下一輪。
                logger.LogError(ex, "孤兒附件掃描發生未預期例外，將於下一輪重試。");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
