using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Notes;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 筆記渲染快取「啟動一次性收斂」背景服務（對抗式復審 HIGH-1 的配套）。
///
/// 為什麼需要：GET 單篇筆記的自癒是「純記憶體」（見 NoteEndpoints.LoadNoteDetailByIdAsync——
/// 讀取絕不落 DB，否則推進 xmin 會讓其他 session 早先載入的 baseVersion 過期、存檔撞假 409）。
/// 但純記憶體自癒代表每次 GET 過時筆記都要重算一次，且 DB 裡的快取永遠不會收斂——
/// 故由本服務在「應用程式啟動、schema migration 完成之後」背景掃描一次，把全部過時筆記
/// 重算回存，讓記憶體自癒只需要撐「部署後、收斂完成前」的短暫窗口。
///
/// 設計要點：
/// - 不阻塞啟動：BackgroundService 於 host 啟動後才執行（Program.cs 的 MigrateAsync 在
///   app.Run() 之前跑完，故本服務執行時 schema 一定已就緒），先 Task.Yield 讓出啟動路徑。
/// - 跨全部使用者、含所有「有效」筆記：IgnoreQueryFilters（背景無 HTTP 脈絡，CurrentUserId 為空，
///   不繞過濾器會掃不到任何列），顯式帶 ValidFlag 條件（垃圾桶中的筆記待還原後由 GET 記憶體自癒
///   兜底，不在此收斂）。
/// - 逐筆處理：一筆一條 UPDATE，不把全站筆記包進單一大交易（防長交易鎖表/記憶體暴衝）；
///   單筆失敗記 Warning 續走，不中斷整體收斂。
/// - 每筆 log（Information：noteId＋標題）存證，供部署後核對收斂範圍。
/// - 回存走 ExecuteUpdate（不經 SaveChanges 攔截器）：只動衍生快取（ContentHtml/RenderVersion），
///   不產生 NoteRevision、不記 ActivityLog、不動 UpdatedDateTime。
/// - ⚠️ 已知取捨（明文接受）：ExecuteUpdate 會推進 xmin——「部署當下」仍跨版開著編輯的 session
///   可能吃到一次 409（重整即復原），與 schema migration 同級的一次性部署成本；
///   平時讀取（GET）零寫入，不再有跨 session 假 409。
/// - guard 條件 <c>RenderVersion &lt; Current</c>：與使用者「同時正在編輯」（PUT 已把版本寫成
///   Current）的筆記自然跳過，不覆蓋新內容。
/// </summary>
public sealed class NoteRenderMigrationService(
    IServiceScopeFactory scopeFactory,
    ILogger<NoteRenderMigrationService> logger) : BackgroundService
{
    /// <summary>
    /// 背景進入點：讓出啟動路徑後執行一次收斂；整體例外只記 Error（收斂失敗不影響服務可用性，
    /// GET 的記憶體自癒仍能保證顯示正確，下次重啟會再試）。
    /// </summary>
    /// <param name="stoppingToken">應用程式關閉時觸發的取消權杖。</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // 先讓出，避免佔住 host 啟動的同步路徑（BackgroundService.StartAsync 會執行到第一個 await）。
        await Task.Yield();

        try
        {
            await MigrateStaleNotesAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // 正常關閉：安靜結束（未完成的部分下次啟動續跑）。
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "渲染快取一次性收斂發生未預期例外（將於下次啟動重試；GET 記憶體自癒不受影響）。");
        }
    }

    /// <summary>
    /// 收斂核心：掃描全部「有效且渲染版本過時」的筆記，逐筆以現行管線重算 ContentHtml 並回存。
    /// 獨立成公開方法以便整合測試直接呼叫驗證（HostedService 啟動路徑與測試共用同一份邏輯）。
    /// </summary>
    /// <param name="ct">取消權杖。</param>
    /// <returns>非同步作業。</returns>
    public async Task MigrateStaleNotesAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();

        // 先撈「Id＋標題」的輕量清單（不含內文，防全站內文一次進記憶體）；
        // 內文於逐筆處理時單獨讀取。
        var staleNotes = await db.Note
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(n => n.ValidFlag && n.RenderVersion < NoteContentHelpers.CurrentRenderVersion)
            .Select(n => new { n.Id, n.Title })
            .ToListAsync(ct);

        if (staleNotes.Count == 0)
        {
            logger.LogInformation(
                "渲染快取收斂：無過時筆記（RenderVersion 皆 ≥ {CurrentVersion}）。",
                NoteContentHelpers.CurrentRenderVersion);
            return;
        }

        logger.LogInformation(
            "渲染快取收斂開始：{Count} 筆過時筆記（目標版本 {CurrentVersion}）。",
            staleNotes.Count,
            NoteContentHelpers.CurrentRenderVersion);

        var healedCount = 0;
        foreach (var stale in staleNotes)
        {
            ct.ThrowIfCancellationRequested();

            try
            {
                // 逐筆讀原文（清單撈取後內容可能已被編輯——以「此刻」的 ContentRaw 為準）。
                var contentRaw = await db.Note
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(n => n.Id == stale.Id)
                    .Select(n => n.ContentRaw)
                    .FirstOrDefaultAsync(ct);

                if (contentRaw is null)
                {
                    continue; // 清單撈取後剛被硬性移除（理論上不會發生）→ 跳過。
                }

                var refreshedHtml = NoteContentHelpers.RenderToHtml(contentRaw);

                // guard：仍然過時才寫（撈清單後若被使用者編輯，PUT 已寫成 Current → 這裡撲空、不覆蓋）。
                var healed = await db.Note
                    .IgnoreQueryFilters()
                    .Where(n => n.Id == stale.Id
                        && n.ValidFlag
                        && n.RenderVersion < NoteContentHelpers.CurrentRenderVersion)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(n => n.ContentHtml, refreshedHtml)
                        .SetProperty(n => n.RenderVersion, NoteContentHelpers.CurrentRenderVersion), ct);

                if (healed > 0)
                {
                    healedCount++;
                    // 每筆存證：部署後可依此核對收斂範圍。
                    logger.LogInformation(
                        "渲染快取收斂：筆記 {NoteId}「{Title}」已重算回存（→ v{CurrentVersion}）。",
                        stale.Id,
                        stale.Title,
                        NoteContentHelpers.CurrentRenderVersion);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw; // 關閉中：交給上層安靜結束。
            }
            catch (Exception ex)
            {
                // 單筆失敗（原文異常/暫時性 DB 錯誤）不可中斷整體收斂；記 Warning 續走。
                logger.LogWarning(ex,
                    "渲染快取收斂：筆記 {NoteId}「{Title}」重算失敗，略過（GET 記憶體自癒仍會兜底）。",
                    stale.Id,
                    stale.Title);
            }
        }

        logger.LogInformation(
            "渲染快取收斂完成：{HealedCount}/{Total} 筆已回存。",
            healedCount,
            staleNotes.Count);
    }
}
