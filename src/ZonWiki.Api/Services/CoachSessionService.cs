using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ZonWiki.Api.Coach;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 英文教練場次的資料層＋護欄服務（其他功能群 Phase 3，純邏輯、不碰 WebSocket）。
///
/// 職責：開課／清單（含<b>懶惰殭屍修正</b>）／取單場（歷史逐字稿）／擁有權驗證／
/// <b>每日分鐘用量計算</b>（權威＝StartedDateTime→(EndedDateTime 或 now)，未收尾 active 以 now 保守計入，
/// MinBilledMinutes 最小計費顆粒）／<b>每人 1 併發原子 claim</b>（供批次 2 的 /ws/coach 端點呼叫）。
///
/// 多租戶隔離鐵則：所有 user-scoped 查詢一律 <c>IgnoreQueryFilters()</c> ＋<b>明確 UserId</b>
/// （比照 <see cref="VocabularyService"/>），不依賴 SetCurrentUserId 呼叫時機，行為在請求／背景／測試皆確定。
/// 時間一律 UTC；一律軟刪除。
/// </summary>
public sealed class CoachSessionService
{
    /// <summary>
    /// 懶惰殭屍判定門檻（小時）：active 場次的 UpdatedDateTime 超過此時數未更新，視為背景已死於重啟／斷線，
    /// 於清單查詢時就地標記為 ended（避免永遠 active 把使用者鎖死、或崩潰場次讓日額度失守）。
    /// </summary>
    public const int ZombieInactivityHours = 2;

    /// <summary>
    /// 全站「使用者→目前作用中的連線識別碼」併發槽（每人只允許一顆作用中連線）。
    /// 因本服務為 Scoped，此表以 static 共享跨請求狀態；claim 以 CAS 迴圈原子化（避免先查後接的 TOCTOU）。
    /// </summary>
    private static readonly ConcurrentDictionary<Guid, Guid> ActiveConnectionByUser = new();

    private readonly ZonWikiDbContext _db;
    private readonly CoachOptions _options;

    /// <summary>
    /// 建立教練場次服務。
    /// </summary>
    /// <param name="db">資料庫內容（Scoped）。</param>
    /// <param name="options">教練子系統設定（護欄門檻等）。</param>
    public CoachSessionService(ZonWikiDbContext db, IOptions<CoachOptions> options)
    {
        _db = db;
        _options = options.Value;
    }

    // ── 開課 ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 開一場新的教練對話（<b>開場即寫 StartedDateTime</b>，作為日分鐘用量的權威起點）。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="title">場次標題（空白則以主題／時間自動命名）。</param>
    /// <param name="topic">主題（可空）。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>新建的教練場次實體（已存檔、已被追蹤）。</returns>
    public async Task<CoachSession> OpenSessionAsync(
        Guid userId,
        string? title,
        string? topic,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var userKey = userId.ToString();
        var resolvedTitle = string.IsNullOrWhiteSpace(title)
            ? BuildDefaultTitle(topic, now)
            : title.Trim();

        var session = new CoachSession
        {
            UserId = userId,
            Title = resolvedTitle,
            Topic = string.IsNullOrWhiteSpace(topic) ? null : topic.Trim(),
            Status = CoachSession.StatusActive,
            Model = _options.Model,
            StartedDateTime = now,
            AccumulatedSeconds = 0,
            EndedDateTime = null,
            CreatedUser = userKey,
            UpdatedUser = userKey,
        };

        _db.CoachSession.Add(session);
        await _db.SaveChangesAsync(cancellationToken);
        return session;
    }

    /// <summary>組預設場次標題（主題優先，否則以開場 UTC 時間）。</summary>
    private static string BuildDefaultTitle(string? topic, DateTime nowUtc)
        => string.IsNullOrWhiteSpace(topic)
            ? $"口說練習 {nowUtc:yyyy-MM-dd HH:mm} UTC"
            : $"口說練習：{topic.Trim()}";

    // ── 清單（含懶惰殭屍修正）───────────────────────────────────────────────────

    /// <summary>
    /// 列出本人有效的教練場次（近期在前）。<b>先做懶惰殭屍修正</b>：把「active 且 UpdatedDateTime 超過
    /// <see cref="ZombieInactivityHours"/> 小時未更新」的場次就地標記 ended（EndedDateTime＝最後活動時間），
    /// 再回傳清單——讓卡死的場次不再無限計入日用量、也不再擋住「每人 1 併發」。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>本人有效場次（依 UpdatedDateTime 遞減）。</returns>
    public async Task<IReadOnlyList<CoachSession>> ListSessionsAsync(
        Guid userId,
        CancellationToken cancellationToken)
    {
        await FixZombieSessionsAsync(userId, cancellationToken);

        return await _db.CoachSession.IgnoreQueryFilters()
            .Where(s => s.UserId == userId && s.ValidFlag)
            .OrderByDescending(s => s.UpdatedDateTime)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// 懶惰殭屍修正（單一 UPDATE 條件）：active 且逾時未更新的場次 → ended。
    /// EndedDateTime 取「原 UpdatedDateTime（最後活動）」以公平計費（不多計死後空轉的時間）；
    /// 同一 UPDATE 內另把 UpdatedDateTime 推到 now（SQL 以 RHS 原值運算，故 EndedDateTime 拿到的是舊值）。
    /// ExecuteUpdate 繞過稽核攔截器，故手動寫 UpdatedUser/UpdatedDateTime。
    /// </summary>
    /// <returns>被修正（標記 ended）的場次列數。</returns>
    public async Task<int> FixZombieSessionsAsync(Guid userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddHours(-ZombieInactivityHours);
        return await _db.CoachSession.IgnoreQueryFilters()
            .Where(s => s.UserId == userId
                && s.ValidFlag
                && s.Status == CoachSession.StatusActive
                && s.UpdatedDateTime < cutoff)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(s => s.Status, CoachSession.StatusEnded)
                    .SetProperty(s => s.EndedDateTime, s => s.UpdatedDateTime)
                    .SetProperty(s => s.UpdatedUser, userId.ToString())
                    .SetProperty(s => s.UpdatedDateTime, now),
                cancellationToken);
    }

    // ── 取單場（含逐字稿）＋擁有權驗證 ───────────────────────────────────────────

    /// <summary>
    /// 依 Id 查本人的「有效」教練場次（IgnoreQueryFilters ＋明確 UserId ＋ValidFlag）。
    /// 供擁有權驗證使用（批次 2 的 /ws/coach 帶既有 sessionId 時，先驗過才載入 handle／summary）。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="sessionId">教練場次 Id。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>教練場次；不存在或非本人／已軟刪回 null。</returns>
    public Task<CoachSession?> FindSessionAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
        => _db.CoachSession.IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                s => s.Id == sessionId && s.UserId == userId && s.ValidFlag, cancellationToken);

    /// <summary>
    /// 取本人單一場次的歷史逐字稿（場次＋依 SeqNo 遞增的訊息）。非本人／不存在回 null。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="sessionId">教練場次 Id。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>(場次, 逐字稿訊息清單)；非本人／不存在回 null。</returns>
    public async Task<(CoachSession Session, IReadOnlyList<CoachMessage> Messages)?> GetSessionWithTranscriptAsync(
        Guid userId,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var session = await _db.CoachSession.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(
                s => s.Id == sessionId && s.UserId == userId && s.ValidFlag, cancellationToken);
        if (session is null)
        {
            return null;
        }

        var messages = await _db.CoachMessage.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.CoachSessionId == sessionId && m.UserId == userId && m.ValidFlag)
            .OrderBy(m => m.SeqNo)
            .ToListAsync(cancellationToken);

        return (session, messages);
    }

    // ── 每日分鐘用量（權威計量）──────────────────────────────────────────────────

    /// <summary>
    /// 計算本人「今日（UTC 日界）」已用的教練秒數。
    ///
    /// 算法（【審修-S9】不依賴清理才算對）：
    /// - <b>先做懶惰殭屍修正</b>——把「已死卻仍 active」的場次收尾，否則它會以 now 一路累加，
    ///   可能虛增用量甚至把使用者整天鎖死（正是計畫要避免的「永遠 active 把使用者鎖死」）。
    /// - 只計「與今日 [00:00, 隔日00:00) UTC 有交集」的場次，並<b>裁切到今日交集部分</b>
    ///   （起點 max(開場, 今日起)、終點 min(收尾 或 now, now)），使跨午夜場次的今日部分正確計入、
    ///   昨日部分不重複計。未收尾 active 場以 now 保守封頂。
    /// - 每場今日部分再套<b>最小計費顆粒</b>（<see cref="CoachOptions.MinBilledMinutes"/>），
    ///   讓「連 &lt;1 分鐘就斷」的抖動也照樣吃日額度。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>今日已用秒數（已含最小計費顆粒）。</returns>
    public async Task<long> GetDailyUsedSecondsAsync(Guid userId, CancellationToken cancellationToken)
    {
        // 讀路徑自我修復：先收尾殭屍場次，避免死掉的 active 場以 now 一路累加而虛增用量／鎖死使用者。
        await FixZombieSessionsAsync(userId, cancellationToken);

        var now = DateTime.UtcNow;
        var todayStartUtc = now.Date;                    // 今日 UTC 00:00
        var tomorrowStartUtc = todayStartUtc.AddDays(1); // 隔日 UTC 00:00

        // 與今日區間有交集的場次：開場早於明日，且（未收尾 或 收尾落在今日起之後）。
        var sessions = await _db.CoachSession.IgnoreQueryFilters()
            .Where(s => s.UserId == userId
                && s.ValidFlag
                && s.StartedDateTime < tomorrowStartUtc
                && (s.EndedDateTime == null || s.EndedDateTime >= todayStartUtc))
            .Select(s => new { s.StartedDateTime, s.EndedDateTime })
            .ToListAsync(cancellationToken);

        var minBilledSeconds = (long)Math.Max(0, _options.MinBilledMinutes) * 60L;
        long totalSeconds = 0;
        foreach (var session in sessions)
        {
            // 裁切到今日交集：起點取 max(開場, 今日起)；終點＝收尾時間，未收尾 active 以 now 保守計入。
            //（收尾時間一律由伺服器以當下 UTC 寫入，恆為過去，故不需再對終點封頂到 now。）
            var effectiveStart = session.StartedDateTime < todayStartUtc ? todayStartUtc : session.StartedDateTime;
            var effectiveEnd = session.EndedDateTime ?? now;

            var elapsed = (long)Math.Max(0, (effectiveEnd - effectiveStart).TotalSeconds);
            totalSeconds += Math.Max(elapsed, minBilledSeconds);
        }

        return totalSeconds;
    }

    /// <summary>
    /// 今日教練用量是否已達每日分鐘上限（<see cref="CoachOptions.DailyMinuteLimit"/>）。
    /// 供批次 2 的 /ws/coach 在建線前判斷是否拒絕新場。<=0 的上限視為「不設限」。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    /// <returns>已達或超過每日上限時為 true。</returns>
    public async Task<bool> IsDailyLimitReachedAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (_options.DailyMinuteLimit <= 0)
        {
            return false; // 未設上限＝不設限。
        }

        var usedSeconds = await GetDailyUsedSecondsAsync(userId, cancellationToken);
        return usedSeconds >= (long)_options.DailyMinuteLimit * 60L;
    }

    // ── 每人 1 併發原子 claim（供批次 2 端點呼叫）──────────────────────────────────

    /// <summary>
    /// 原子搶佔某使用者的併發槽：<b>新連線一律勝出並頂替舊連線</b>（【審修-A5】以 CAS 迴圈原子化，
    /// 不先查後接以避免 TOCTOU）。回傳被頂替的舊連線識別碼（若有），供呼叫端（批次 2）令舊 proxy 立即釋放。
    /// 效果：任一時刻每位使用者只有一顆作用中連線。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="connectionId">本次新連線的識別碼（由端點產生）。</param>
    /// <returns>搶佔結果（是否接受、被頂替的舊連線 Id）。</returns>
    public static CoachConcurrencyClaim ClaimConcurrencySlot(Guid userId, Guid connectionId)
    {
        // CAS 迴圈：要嘛對既有槽 TryUpdate（回報被頂替者），要嘛 TryAdd（無既有槽）。失敗即重試，直到原子成功。
        while (true)
        {
            if (ActiveConnectionByUser.TryGetValue(userId, out var existing))
            {
                if (ActiveConnectionByUser.TryUpdate(userId, connectionId, existing))
                {
                    return new CoachConcurrencyClaim(Accepted: true, DisplacedConnectionId: existing);
                }
            }
            else if (ActiveConnectionByUser.TryAdd(userId, connectionId))
            {
                return new CoachConcurrencyClaim(Accepted: true, DisplacedConnectionId: null);
            }

            // 期間被別的連線改動 → 重試（極短暫的自旋，實務上至多一兩圈即收斂）。
        }
    }

    /// <summary>
    /// 釋放併發槽——<b>只在目前擁有者正是此連線時</b>才移除（原子條件移除），
    /// 避免「已被頂替的舊連線」在收尾時誤刪新擁有者的槽。
    /// </summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="connectionId">要釋放的連線識別碼。</param>
    /// <returns>確實由此連線釋放（是其擁有者）時為 true。</returns>
    public static bool ReleaseConcurrencySlot(Guid userId, Guid connectionId)
        => ((ICollection<KeyValuePair<Guid, Guid>>)ActiveConnectionByUser)
            .Remove(new KeyValuePair<Guid, Guid>(userId, connectionId));

    /// <summary>取某使用者目前作用中的連線識別碼（無則 null）。供測試與批次 2 診斷用。</summary>
    /// <param name="userId">使用者識別碼。</param>
    /// <returns>作用中連線 Id 或 null。</returns>
    public static Guid? GetActiveConnection(Guid userId)
        => ActiveConnectionByUser.TryGetValue(userId, out var id) ? id : null;
}

/// <summary>
/// 併發槽搶佔的結果。
/// </summary>
/// <param name="Accepted">是否接受本次連線（新連線一律接受）。</param>
/// <param name="DisplacedConnectionId">被本次連線頂替的舊連線 Id（無舊連線時為 null；呼叫端據此令舊 proxy 釋放）。</param>
public sealed record CoachConcurrencyClaim(bool Accepted, Guid? DisplacedConnectionId);
