using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Domain.Recurrence;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 重複規則「到期具現化」背景服務（#17）。
///
/// 設計（單人系統，採單純正確做法）：
/// - 設有 <see cref="TaskCard.RecurrenceRule"/> 的卡片視為「母規則（範本）」，本身即序列第 0 次發生。
/// - 本服務於啟動時跑一次、之後每日跑一次，依 RRULE 把「錨點之後、且不晚於現在」的每一次發生，
///   具現化成一張獨立、可打勾完成的實體任務卡（<see cref="TaskCard.RecurrenceSourceId"/> 指回母規則）。
/// - 只往前展開到「現在」，不預先大量產生未來發生；以（母規則, 發生時間）去重（含軟刪除的發生，
///   確保使用者刪掉某次發生後不會被重新產生）。母規則被軟刪除或清掉 RecurrenceRule 即自動停止產生。
///
/// 決策紀錄見 docs/DECISIONS.md（2026-07-06）。
/// </summary>
public sealed class RecurringTaskMaterializationService : BackgroundService
{
    /// <summary>
    /// 每輪掃描間隔（每日一次）。單人系統的重複任務不需要更即時。
    /// </summary>
    private static readonly TimeSpan ScanInterval = TimeSpan.FromHours(24);

    /// <summary>
    /// 單一母規則單輪最多具現化的發生數（安全閥；避免錨點極舊＋每日規則一次灌爆）。
    /// </summary>
    private const int MaxOccurrencesPerRulePerRun = 500;

    /// <summary>
    /// 建立實體卡時記錄的操作者字串（稽核欄位 CreatedUser/UpdatedUser）。
    /// </summary>
    private const string RecurrenceActor = "system:recurrence";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RecurringTaskMaterializationService> _logger;

    /// <summary>
    /// 建立重複規則具現化背景服務。
    /// </summary>
    /// <param name="scopeFactory">服務範圍工廠（每輪建立獨立的 DbContext 範圍）。</param>
    /// <param name="logger">記錄器。</param>
    public RecurringTaskMaterializationService(
        IServiceScopeFactory scopeFactory,
        ILogger<RecurringTaskMaterializationService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>
    /// 背景主迴圈：啟動先跑一次，之後每 <see cref="ScanInterval"/> 跑一次；停止時安靜結束。
    /// </summary>
    /// <param name="stoppingToken">應用程式關閉時觸發的取消權杖。</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await MaterializeAllAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break; // 正常關閉。
            }
            catch (Exception ex)
            {
                // 背景服務不可因單次例外而整組掛掉；記錄後照常等下一輪。
                _logger.LogError(ex, "重複任務具現化背景輪詢發生未預期例外，將於下一輪重試。");
            }

            try
            {
                await Task.Delay(ScanInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>
    /// 掃描全體使用者的母規則卡並具現化到期發生。
    /// 於獨立範圍執行、以 <c>IgnoreQueryFilters</c> 跨使用者查詢（背景無 HttpContext；建立時明確帶回母規則的 UserId）。
    /// </summary>
    /// <param name="ct">取消權杖。</param>
    private async Task MaterializeAllAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ZonWikiDbContext>();

        var now = DateTime.UtcNow;

        // 母規則＝有 RecurrenceRule 且本身不是別人的發生（RecurrenceSourceId 為 null）、且有效。
        var mothers = await db.TaskCard
            .IgnoreQueryFilters()
            .Where(t => t.RecurrenceRule != null
                        && t.RecurrenceSourceId == null
                        && t.ValidFlag)
            .ToListAsync(ct);

        var totalCreated = 0;
        foreach (var mother in mothers)
        {
            ct.ThrowIfCancellationRequested();
            totalCreated += await MaterializeOneAsync(db, mother, now, ct);
        }

        if (totalCreated > 0)
        {
            await db.SaveChangesAsync(ct);
            _logger.LogInformation(
                "重複任務具現化：本輪為 {MotherCount} 個母規則新增 {CreatedCount} 張發生卡。",
                mothers.Count,
                totalCreated);
        }
    }

    /// <summary>
    /// 具現化單一母規則到期未產生的發生（僅將新實體加入變更追蹤，實際寫入由呼叫端統一 SaveChanges）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="mother">母規則卡。</param>
    /// <param name="now">目前時間（UTC，展開上界）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>本次為此母規則新增的發生卡數量。</returns>
    private async Task<int> MaterializeOneAsync(
        ZonWikiDbContext db,
        TaskCard mother,
        DateTime now,
        CancellationToken ct)
    {
        // 錨點：優先採排定（Planned），否則截止（Due）。兩者皆無 → 無從展開，略過。
        var anchoredOnPlanned = mother.PlannedDateTime.HasValue;
        var anchor = mother.PlannedDateTime ?? mother.DueDateTime;
        if (!anchor.HasValue)
        {
            return 0;
        }

        // 對齊到「秒」精度：避免 DB timestamptz 微秒往返與去重比對不一致。
        var anchorUtc = TruncateToSeconds(DateTime.SpecifyKind(anchor.Value, DateTimeKind.Utc));

        // Planned 與 Due 皆有時的固定間隔（讓具現化卡也保留「開始→截止」的跨距）。
        TimeSpan? dueOffset = anchoredOnPlanned && mother.DueDateTime.HasValue
            ? mother.DueDateTime.Value - mother.PlannedDateTime!.Value
            : null;

        var occurrences = RecurrenceRuleExpander.Expand(
            mother.RecurrenceRule,
            anchorUtc,
            now,
            MaxOccurrencesPerRulePerRun);
        if (occurrences.Count == 0)
        {
            return 0;
        }

        // 已存在的發生時間（含軟刪除；使用者刪掉某次發生後不應被重新產生）。
        var existingRaw = await db.TaskCard
            .IgnoreQueryFilters()
            .Where(t => t.RecurrenceSourceId == mother.Id && t.RecurrenceOccurrenceDateTime != null)
            .Select(t => t.RecurrenceOccurrenceDateTime!.Value)
            .ToListAsync(ct);

        var existing = existingRaw
            .Select(d => TruncateToSeconds(DateTime.SpecifyKind(d, DateTimeKind.Utc)))
            .ToHashSet();
        // 錨點（第 0 次發生）＝母規則本身，視為已具現化，永不重複產生。
        existing.Add(anchorUtc);

        var created = 0;
        foreach (var occurrence in occurrences)
        {
            var occ = TruncateToSeconds(occurrence);
            if (existing.Contains(occ))
            {
                continue;
            }
            existing.Add(occ); // 防同批重複。

            db.TaskCard.Add(BuildOccurrenceCard(mother, occ, anchoredOnPlanned, dueOffset));
            created++;
        }

        return created;
    }

    /// <summary>
    /// 由母規則與發生時間組出一張獨立、可打勾完成的實體發生卡。
    /// </summary>
    /// <param name="mother">母規則卡（複製標題/內容/優先度/分類/擁有者）。</param>
    /// <param name="occurrence">此次發生時間（UTC，秒精度）。</param>
    /// <param name="anchoredOnPlanned">錨點是否落在 Planned（決定發生時間寫入 Planned 或 Due）。</param>
    /// <param name="dueOffset">Planned→Due 的固定間隔（母規則兩者皆有時），否則 null。</param>
    /// <returns>新的發生卡實體（尚未寫入）。</returns>
    private static TaskCard BuildOccurrenceCard(
        TaskCard mother,
        DateTime occurrence,
        bool anchoredOnPlanned,
        TimeSpan? dueOffset)
    {
        var card = new TaskCard
        {
            Id = Guid.NewGuid(),
            UserId = mother.UserId,
            Title = mother.Title,
            Content = mother.Content,
            Status = "todo",
            Priority = mother.Priority,
            GroupId = mother.GroupId,
            SortOrder = mother.SortOrder,
            // 發生卡本身不再帶重複規則（它是具體的一次，不再自我繁殖）。
            RecurrenceRule = null,
            RecurrenceSourceId = mother.Id,
            RecurrenceOccurrenceDateTime = occurrence,
            ParentId = null,
            CompletedDateTime = null,
            IsLongTerm = false,
            CreatedUser = RecurrenceActor,
            UpdatedUser = RecurrenceActor,
            ValidFlag = true,
        };

        if (anchoredOnPlanned)
        {
            card.PlannedDateTime = occurrence;
            card.DueDateTime = dueOffset.HasValue ? occurrence + dueOffset.Value : null;
        }
        else
        {
            card.DueDateTime = occurrence;
        }

        return card;
    }

    /// <summary>
    /// 將時間截斷到「秒」（去除毫秒與更細的刻度），用於穩定的去重比對。
    /// </summary>
    /// <param name="value">原始時間（UTC）。</param>
    /// <returns>秒精度的 UTC 時間。</returns>
    private static DateTime TruncateToSeconds(DateTime value) =>
        new(
            value.Year,
            value.Month,
            value.Day,
            value.Hour,
            value.Minute,
            value.Second,
            DateTimeKind.Utc);
}
