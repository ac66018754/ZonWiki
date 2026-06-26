using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 首頁聚合相關的 API 端點：
/// GET /api/home（一次回傳首頁所需的所有資料：當週日曆、今日待辦、常用連結、最近捕捉）。
/// 供首頁使用，精簡展示各功能的重點資訊。完整功能在各頁面（筆記、日程、開問啦等）。
/// </summary>
public static class HomePageEndpoints
{
    /// <summary>
    /// 註冊首頁相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapHomePageEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 取得首頁聚合資料（當週日曆 + 今日待辦 + 常用連結 + 最近捕捉）。
        /// GET /api/home
        /// 一次呼叫回傳所有首頁元件所需資料，減少前端往返。
        /// </summary>
        app.MapGet("/api/home", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var now = DateTime.UtcNow;
            var todayDate = now.Date;

            // 1. 當週日曆（週一至週日）
            var weekStart = GetWeekStart(now);
            var weekEnd = weekStart.AddDays(7);

            var weeklyTasks = await db.TaskCard
                .Where(t =>
                    t.UserId == userGuid &&
                    t.ValidFlag &&
                    ((t.PlannedDateTime.HasValue && t.PlannedDateTime >= weekStart && t.PlannedDateTime < weekEnd) ||
                     (t.DueDateTime.HasValue && t.DueDateTime >= weekStart && t.DueDateTime < weekEnd)))
                .OrderBy(t => t.PlannedDateTime ?? t.DueDateTime ?? DateTime.MaxValue)
                .Select(t => new TaskCardSummaryDto(
                    t.Id,
                    t.Title,
                    t.Status,
                    t.Priority,
                    t.PlannedDateTime,
                    t.DueDateTime,
                    t.GroupId,
                    t.SortOrder,
                    t.CreatedDateTime,
                    0,
                    0,
                    null,
                    null,
                    null,
                    t.IsLongTerm,
                    t.TargetDateTime,
                    t.TargetGranularity,
                    t.IsPinnedToHome,
                    t.HomeSortOrder))
                .ToListAsync(ct);

            var weeklyJournals = await db.Note
                .Where(n =>
                    n.UserId == userGuid &&
                    n.ValidFlag &&
                    n.Kind == "journal" &&
                    n.JournalDate.HasValue &&
                    n.JournalDate >= weekStart.Date &&
                    n.JournalDate <= weekEnd.Date)
                .OrderBy(n => n.JournalDate)
                .Select(n => new NoteSummaryDto(
                    n.Id,
                    n.Title,
                    n.Slug,
                    n.Kind,
                    n.IsDraft,
                    n.UpdatedDateTime))
                .ToListAsync(ct);

            var weeklyCalendar = new WeeklyCalendarSummaryDto(weekStart, weekEnd, weeklyTasks, weeklyJournals);

            // 2. 今日待辦（status = todo 或 doing，且（PlannedDateTime 或 DueDateTime）在今天）
            var todayTodos = await db.TaskCard
                .Where(t =>
                    t.UserId == userGuid &&
                    t.ValidFlag &&
                    (t.Status == "todo" || t.Status == "doing") &&
                    ((t.PlannedDateTime.HasValue && t.PlannedDateTime.Value.Date == todayDate) ||
                     (t.DueDateTime.HasValue && t.DueDateTime.Value.Date == todayDate)))
                .OrderBy(t => t.Priority)
                .ThenBy(t => t.SortOrder)
                .Select(t => new TaskCardSummaryDto(
                    t.Id,
                    t.Title,
                    t.Status,
                    t.Priority,
                    t.PlannedDateTime,
                    t.DueDateTime,
                    t.GroupId,
                    t.SortOrder,
                    t.CreatedDateTime,
                    0,
                    0,
                    null,
                    null,
                    null,
                    t.IsLongTerm,
                    t.TargetDateTime,
                    t.TargetGranularity,
                    t.IsPinnedToHome,
                    t.HomeSortOrder))
                .ToListAsync(ct);

            // 3. 常用連結卡（依排序序號）
            // 先載入實體（含標籤關聯），再於記憶體投影（巢狀標籤投影無法被 EF 翻譯）。
            var quickLinkEntities = await db.QuickLink
                .Where(ql => ql.UserId == userGuid && ql.ValidFlag)
                .Include(ql => ql.QuickLinkTags)
                    .ThenInclude(qt => qt.Tag)
                .OrderBy(ql => ql.SortOrder)
                .ToListAsync(ct);
            var quickLinks = quickLinkEntities.Select(QuickLinkEndpoints.MapQuickLink).ToList();

            // 4. 最近 5 個捕捉項目（待分流或已歸檔，依建立時間倒序）
            var recentCaptures = await db.CaptureItem
                .Where(ci => ci.UserId == userGuid && ci.ValidFlag)
                .OrderByDescending(ci => ci.CreatedDateTime)
                .Take(5)
                .Select(ci => new CaptureItemDto(
                    ci.Id,
                    ci.Source,
                    ci.RawContent,
                    ci.AudioPath,
                    ci.Status,
                    ci.FiledTargetType,
                    ci.FiledTargetId,
                    ci.CreatedDateTime))
                .ToListAsync(ct);

            // 5. 釘選到首頁的任務卡片（含標籤與子任務計數）
            var pinnedTaskEntities = await db.TaskCard
                .Where(t => t.UserId == userGuid && t.IsPinnedToHome && t.ValidFlag)
                .Include(t => t.Children)
                .Include(t => t.TaskTags)
                    .ThenInclude(tt => tt.Tag)
                .OrderBy(t => t.HomeSortOrder)
                .ThenBy(t => t.CreatedDateTime)
                .ToListAsync(ct);

            var pinnedTasks = pinnedTaskEntities.Select(TaskEndpoints.MapToSummaryDtoPublic).ToList();

            var result = new HomePageAggregateDto(
                weeklyCalendar,
                todayTodos,
                quickLinks,
                recentCaptures,
                pinnedTasks);

            return Results.Ok(ApiResponse<HomePageAggregateDto>.Ok(result));
        });
    }

    /// <summary>
    /// 計算給定日期所在週的開始日期（週一）。
    /// </summary>
    /// <param name="date">給定日期。</param>
    /// <returns>該週的週一（UTC）。</returns>
    private static DateTime GetWeekStart(DateTime date)
    {
        int daysFromMonday = (int)date.DayOfWeek - 1;
        if (daysFromMonday < 0)
        {
            daysFromMonday = 6; // Sunday 算前一週週一
        }

        return date.AddDays(-daysFromMonday).Date;
    }
}
