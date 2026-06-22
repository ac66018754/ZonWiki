using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 行事曆相關的 API 端點：
/// GET /api/calendar（查詢特定時間範圍內的任務與日記）。
/// 供月/週/日視圖使用，依計劃時間、到期時間、日記日期傳回。
/// </summary>
public static class CalendarEndpoints
{
    /// <summary>
    /// 註冊行事曆相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapCalendarEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 查詢某時間範圍內的任務卡片與日記。
        /// GET /api/calendar?from={ISO8601}&to={ISO8601}
        /// 傳回該範圍內的 TaskCard（依 PlannedDateTime/DueDateTime）與 Note（Kind=journal，依 JournalDate）。
        /// 時間以 UTC 計算，前端根據時區顯示。
        /// </summary>
        app.MapGet("/api/calendar", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            DateTime? from,
            DateTime? to,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 若未指定時間範圍，預設取當週
            var now = DateTime.UtcNow;
            var startDate = from ?? GetWeekStart(now);
            var endDate = to ?? startDate.AddDays(7);

            // 查詢「時間範圍與 [startDate,endDate) 有重疊」的任務卡片——支援跨日任務（橫條）：
            // 任務的最早點 = COALESCE(Planned, Due)、最晚點 = COALESCE(Due, Planned)；
            // 重疊條件 = 最早點 < endDate 且 最晚點 >= startDate。
            // （舊版只取「Planned 或 Due 落在視窗內」，會漏掉「橫跨整個視窗、但兩端都在視窗外」的長任務。）
            var tasks = await db.TaskCard
                .Where(t =>
                    t.UserId == userGuid &&
                    t.ValidFlag &&
                    (t.PlannedDateTime.HasValue || t.DueDateTime.HasValue) &&
                    (t.PlannedDateTime ?? t.DueDateTime) < endDate &&
                    (t.DueDateTime ?? t.PlannedDateTime) >= startDate)
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
                    t.CreatedDateTime))
                .ToListAsync(ct);

            // 查詢該範圍內的日記（JournalDate 在範圍內）
            var journalNotes = await db.Note
                .Where(n =>
                    n.UserId == userGuid &&
                    n.ValidFlag &&
                    n.Kind == "journal" &&
                    n.JournalDate.HasValue &&
                    n.JournalDate >= startDate.Date &&
                    n.JournalDate <= endDate.Date)
                .OrderBy(n => n.JournalDate)
                .Select(n => new NoteSummaryDto(
                    n.Id,
                    n.Title,
                    n.Slug,
                    n.Kind,
                    n.IsDraft,
                    n.UpdatedDateTime))
                .ToListAsync(ct);

            var result = new CalendarViewDto(tasks, journalNotes, startDate, endDate);
            return Results.Ok(ApiResponse<CalendarViewDto>.Ok(result));
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
