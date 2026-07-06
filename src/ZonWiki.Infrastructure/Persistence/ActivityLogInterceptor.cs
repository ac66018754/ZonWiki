using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

/// <summary>
/// 活動紀錄攔截器：在每次 SaveChanges 時，掃描變更追蹤器，對「使用者關心的實體型別」
/// （筆記 / 任務 / 子任務 / 開問啦節點 / AI 模型(API Key) / 快速紀錄 / 快速連結 / 系統提示詞）
/// 自動產生一筆 <see cref="ActivityLog"/>（標題級，不含完整內容），與本次變更一起存進同一交易。
///
/// 設計重點：
/// - 集中於一處攔截，所有新增/編輯/刪除（含 AI 自動建立的節點）都會被記錄，不需逐一改各端點。
/// - 動作分類：Added→created；Deleted→deleted；Modified 時 ValidFlag true→false 視為 deleted、
///   false→true 視為 restored，其餘有實質欄位變更才記 updated（只動 UpdatedDateTime 不算）。
/// - 必須在 <see cref="AuditingSaveChangesInterceptor"/> 之後註冊：稽核攔截器先跑（設好其他實體的
///   Id/時間），本攔截器再產生紀錄，並「自行」設好紀錄列的 Id/時間/使用者欄位。
/// - 無法歸屬使用者（CurrentUserId 為空，如設計階段）時不記錄，避免污染。
/// </summary>
public sealed class ActivityLogInterceptor : SaveChangesInterceptor
{
    /// <inheritdoc />
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        CaptureActivities(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    /// <inheritdoc />
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        CaptureActivities(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    /// <summary>
    /// 掃描變更、產生活動紀錄並加入本次儲存。
    /// </summary>
    private static void CaptureActivities(DbContext? context)
    {
        if (context is not ZonWikiDbContext db)
        {
            return;
        }

        var userId = db.CurrentUserId;
        if (userId == Guid.Empty)
        {
            return; // 無法歸屬使用者（例如遷移/設計階段）→ 不記錄
        }

        var now = DateTime.UtcNow;
        var userKey = userId.ToString();
        // 操作來源："web"（人類）或 API 權杖名稱（外部 AI，例如 "Claude Code"）。
        var source = db.CurrentSource;
        var pending = new List<ActivityLog>();

        // 先收集，迴圈結束後再 AddRange，避免在列舉變更追蹤器時又改動它。
        foreach (EntityEntry entry in db.ChangeTracker.Entries())
        {
            if (entry.Entity is ActivityLog)
            {
                continue; // 不記錄活動紀錄自己
            }

            var mapped = MapEntity(entry.Entity);
            if (mapped is null)
            {
                continue; // 非關心的實體型別
            }

            var action = ClassifyAction(entry);
            if (action is null)
            {
                continue; // 無實質變更
            }

            var (entityType, title) = mapped.Value;
            var entityId = entry.Entity is AuditableEntity ae ? ae.Id : Guid.Empty;

            pending.Add(new ActivityLog
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                ActionType = action,
                EntityType = entityType,
                EntityId = entityId,
                Title = Truncate(title, 200),
                Source = source,
                CreatedDateTime = now,
                UpdatedDateTime = now,
                CreatedUser = userKey,
                UpdatedUser = userKey,
                ValidFlag = true,
            });
        }

        if (pending.Count > 0)
        {
            db.ActivityLog.AddRange(pending);
        }
    }

    /// <summary>
    /// 把實體對應成 (活動型別字串, 標題)。回傳 null 表示不關心此型別。
    /// </summary>
    private static (string EntityType, string Title)? MapEntity(object entity) => entity switch
    {
        Note n => ("note", n.Title),
        TaskCard t => ("taskcard", t.Title),
        SubTask s => ("subtask", s.Title),
        Node nd => ("node", FirstLine(nd.Content)),
        AiModel m => ("aimodel", string.IsNullOrWhiteSpace(m.Label) ? m.Key : m.Label),
        CaptureItem c => ("capture", FirstLine(c.RawContent)),
        QuickLink q => ("quicklink", q.Title),
        SystemPrompt p => ("prompt", p.Title),
        Expense e => ("expense", string.IsNullOrWhiteSpace(e.Merchant) ? FirstLine(e.RawText) : e.Merchant!),
        ExpenseCategory ec => ("expensecategory", ec.Name),
        _ => null,
    };

    /// <summary>
    /// 依變更狀態判定動作；Modified 需區分軟刪除 / 還原 / 真正編輯。回傳 null 表示不記錄。
    /// </summary>
    private static string? ClassifyAction(EntityEntry entry)
    {
        switch (entry.State)
        {
            case EntityState.Added:
                return "created";
            case EntityState.Deleted:
                return "deleted";
            case EntityState.Modified:
            {
                var validFlagProp = entry.Properties.FirstOrDefault(
                    p => p.Metadata.Name == nameof(AuditableEntity.ValidFlag));
                if (validFlagProp is not null)
                {
                    var wasValid = validFlagProp.OriginalValue as bool? ?? true;
                    var isValid = validFlagProp.CurrentValue as bool? ?? true;
                    if (wasValid && !isValid) return "deleted"; // 軟刪除
                    if (!wasValid && isValid) return "restored"; // 還原
                }

                // 只有「除了 UpdatedDateTime/UpdatedUser 以外」確有欄位變更，才算一次編輯
                var hasRealChange = entry.Properties.Any(p =>
                    p.IsModified &&
                    p.Metadata.Name != nameof(AuditableEntity.UpdatedDateTime) &&
                    p.Metadata.Name != nameof(AuditableEntity.UpdatedUser));
                return hasRealChange ? "updated" : null;
            }
            default:
                return null;
        }
    }

    /// <summary>取首行並去除前後空白（節點/快速紀錄等多行內容用）。</summary>
    private static string FirstLine(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        return s.Split('\n')[0].Trim();
    }

    /// <summary>截斷過長標題（以字元數計；超過加上省略號）。</summary>
    private static string Truncate(string? s, int max)
    {
        s ??= string.Empty;
        return s.Length > max ? s[..max] + "…" : s;
    }
}
