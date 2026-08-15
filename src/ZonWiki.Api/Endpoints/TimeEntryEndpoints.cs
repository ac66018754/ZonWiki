using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.RateLimiting;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 時間追蹤（TimeEntry）相關的 API 端點：
/// GET /api/time-entries?from=&amp;to=（區間清單）、GET /api/time-entries/running（進行中）、
/// GET /api/time-entries/categories（分類 autocomplete）、
/// POST /api/time-entries（建立＝開始計時）、POST /api/time-entries/{id}/stop（結束）、
/// POST /api/time-entries/stop-latest（結束最近開始的進行中項目；iOS 捷徑一鍵結束）、
/// PUT /api/time-entries/{id}（編輯，含事後補記時間）、DELETE /api/time-entries/{id}（軟刪除）。
///
/// 設計要點（詳見 docs/design/時間追蹤-設計與測試計畫.md）：
/// - 認證：全域 SmartAuth 同時支援 Cookie 與 PAT Bearer，端點無感——iPhone 捷徑帶 Bearer 即可呼叫。
/// - 所有入參 DateTime 一律以 <see cref="NormalizeToUtc"/> 正規化（Npgsql timestamptz 要求 Utc Kind；
///   iOS 捷徑可能送出「無尾碼」或「+08:00」格式）。
/// - 寫入端點掛 PatPolicy 限流（TokenBucket 以 UserId 分區；Cookie 與 PAT 共桶為已接受的取捨）。
/// - 併發：接受 last-write-wins（無版本檢查）——單人低頻資料、衝突損失可再編輯救回。
/// </summary>
public static class TimeEntryEndpoints
{
    /// <summary>項目名稱長度上限（與 TimeEntryConfiguration 的 HasMaxLength 一致）。</summary>
    private const int TitleMaxLength = 200;

    /// <summary>分類長度上限（與 TimeEntryConfiguration 的 HasMaxLength 一致）。</summary>
    private const int CategoryMaxLength = 128;

    /// <summary>備註長度上限（與 TimeEntryConfiguration 的 HasMaxLength 一致）。</summary>
    private const int NoteMaxLength = 1000;

    /// <summary>「既有項目」範本清單回傳上限（避免 iOS 捷徑選單過長）。</summary>
    private const int RecentItemsLimit = 50;

    /// <summary>未分類項目在彙總「依分類」中的顯示名稱。</summary>
    private const string UncategorizedLabel = "未分類";

    /// <summary>
    /// 註冊時間追蹤相關的 HTTP 端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapTimeEntryEndpoints(this IEndpointRouteBuilder app)
    {
        /// <summary>
        /// 列出「開始時間」落在 [from, to) 區間內的項目（含已結束與進行中），依開始時間逆序。
        /// GET /api/time-entries?from=&amp;to=
        /// 註：依「開始日」歸組的刻意取捨——昨天開始、還在計時的項目查「今天」不會列出，
        /// 但一律可由 GET /api/time-entries/running 看到。
        /// </summary>
        app.MapGet("/api/time-entries", async (
            DateTime? from,
            DateTime? to,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            if (!from.HasValue || !to.HasValue)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("必須同時提供 from 與 to 查詢參數", 400));
            }

            var fromUtc = NormalizeToUtc(from.Value);
            var toUtc = NormalizeToUtc(to.Value);
            if (fromUtc >= toUtc)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("from 必須早於 to", 400));
            }

            var items = await db.TimeEntry
                .AsNoTracking() // 唯讀查詢不需變更追蹤
                .Where(t => t.UserId == userGuid && t.ValidFlag
                    && t.StartedDateTime >= fromUtc && t.StartedDateTime < toUtc)
                .OrderByDescending(t => t.StartedDateTime)
                .ThenByDescending(t => t.CreatedDateTime)
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<TimeEntryDto>>.Ok(items.Select(MapTimeEntry).ToList()));
        });

        /// <summary>
        /// 列出所有「進行中」的項目（EndedDateTime 為 null），依開始時間逆序。
        /// GET /api/time-entries/running
        /// </summary>
        app.MapGet("/api/time-entries/running", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var items = await db.TimeEntry
                .AsNoTracking() // 唯讀查詢不需變更追蹤
                .Where(t => t.UserId == userGuid && t.ValidFlag && t.EndedDateTime == null)
                .OrderByDescending(t => t.StartedDateTime)
                .ThenByDescending(t => t.CreatedDateTime)
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<TimeEntryDto>>.Ok(items.Select(MapTimeEntry).ToList()));
        });

        /// <summary>
        /// 列出本人用過的所有 distinct 非空分類（依名稱排序；供前端輸入框 autocomplete）。
        /// GET /api/time-entries/categories
        /// </summary>
        app.MapGet("/api/time-entries/categories", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var categories = await db.TimeEntry
                .Where(t => t.UserId == userGuid && t.ValidFlag && t.Category != null)
                .Select(t => t.Category!)
                .Distinct()
                .OrderBy(c => c)
                .ToListAsync(ct);

            return Results.Ok(ApiResponse<List<string>>.Ok(categories));
        });

        /// <summary>
        /// 列出「既有項目」範本：本人歷史用過的 distinct「名稱＋分類」組合，最近用過的排前面。
        /// 供 iOS 捷徑「選既有」快速帶入（例如挑「打LOL／休閒娛樂」直接開始）。
        /// GET /api/time-entries/recent-items
        /// </summary>
        app.MapGet("/api/time-entries/recent-items", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            // 依「名稱＋分類」去重，取每組最後一次開始時間為新近度、逆序，取前 N 筆。
            var rows = await db.TimeEntry
                .AsNoTracking()
                .Where(t => t.UserId == userGuid && t.ValidFlag)
                .GroupBy(t => new { t.Title, t.Category })
                .Select(g => new
                {
                    g.Key.Title,
                    g.Key.Category,
                    LastStarted = g.Max(x => x.StartedDateTime),
                })
                .OrderByDescending(x => x.LastStarted)
                .Take(RecentItemsLimit)
                .ToListAsync(ct);

            var items = rows
                .Select(x => new TimeEntryTemplateDto(x.Title, x.Category))
                .ToList();

            return Results.Ok(ApiResponse<List<TimeEntryTemplateDto>>.Ok(items));
        });

        /// <summary>
        /// 今日／本週彙總（供 iOS 主畫面小工具顯示「做了哪些、各花多少、進行中、依分類」）。
        /// 範圍邊界依「使用者時區」歸日/週（週一為週首）；進行中項目以「查詢當下已經過時間」即時併入。
        /// GET /api/time-entries/summary?scope=day|week（未帶＝day）
        /// </summary>
        app.MapGet("/api/time-entries/summary", async (
            string? scope,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var normalizedScope = string.IsNullOrWhiteSpace(scope) ? "day" : scope.Trim().ToLowerInvariant();
            if (normalizedScope is not ("day" or "week"))
            {
                return Results.BadRequest(ApiResponse<object>.Fail("scope 僅接受 day 或 week", 400));
            }

            // 使用者時區（存 UTC、依時區歸日/週）。
            var timeZoneId = await db.User
                .Where(u => u.Id == userGuid)
                .Select(u => u.TimeZone)
                .FirstOrDefaultAsync(ct);

            var now = DateTime.UtcNow;
            var (fromUtc, toUtc) = ComputeScopeRangeUtc(normalizedScope, timeZoneId, now);

            var entries = await db.TimeEntry
                .AsNoTracking()
                .Where(t => t.UserId == userGuid && t.ValidFlag
                    && t.StartedDateTime >= fromUtc && t.StartedDateTime < toUtc)
                .OrderByDescending(t => t.StartedDateTime)
                .ThenByDescending(t => t.CreatedDateTime)
                .ToListAsync(ct);

            // 進行中項目以「查詢當下已經過時間」計（clamp 非負），與網頁面板同款「含進行中」語意。
            long SecondsOf(TimeEntry entry) => entry.EndedDateTime.HasValue
                ? (long)Math.Round((entry.EndedDateTime.Value - entry.StartedDateTime).TotalSeconds)
                : (long)Math.Max(0, Math.Round((now - entry.StartedDateTime).TotalSeconds));

            var items = entries
                .Select(entry => new TimeEntrySummaryItemDto(
                    entry.Id,
                    entry.Title,
                    entry.Category,
                    SecondsOf(entry),
                    !entry.EndedDateTime.HasValue))
                .ToList();

            var byCategory = entries
                .GroupBy(entry => entry.Category ?? UncategorizedLabel)
                .Select(group => new TimeEntryCategoryTotalDto(
                    group.Key,
                    group.Sum(SecondsOf),
                    group.Count(entry => !entry.EndedDateTime.HasValue)))
                .OrderByDescending(category => category.Seconds)
                .ToList();

            var summary = new TimeEntrySummaryDto(
                normalizedScope,
                fromUtc,
                toUtc,
                items.Sum(item => item.Seconds),
                items.Count(item => item.Running),
                items,
                byCategory);

            return Results.Ok(ApiResponse<TimeEntrySummaryDto>.Ok(summary));
        });

        /// <summary>
        /// 取得單一項目詳情（供 iOS「結束計時（確認）」捷徑帶入 id 後查名稱做二次確認顯示）。
        /// GET /api/time-entries/{id}
        /// </summary>
        app.MapGet("/api/time-entries/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entry = await db.TimeEntry
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);
            if (entry is null)
            {
                return Results.NotFound(ApiResponse<TimeEntryDto>.Fail("找不到該計時項目", 404));
            }

            return Results.Ok(ApiResponse<TimeEntryDto>.Ok(MapTimeEntry(entry)));
        });

        /// <summary>
        /// 建立新項目（＝開始計時）。開始時間未帶＝伺服器當下（UTC）。
        /// POST /api/time-entries
        /// Body: { title, category?, startedDateTime? }
        /// </summary>
        app.MapPost("/api/time-entries", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CreateTimeEntryRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var title = request.Title?.Trim();
            var validationError = ValidateFields(title, request.Category, request.Note, titleRequired: true);
            if (validationError is not null)
            {
                return validationError;
            }

            var entry = new TimeEntry
            {
                Id = Guid.NewGuid(),
                UserId = userGuid,
                Title = title!,
                // 空字串／純空白視為未分類（存 null），與 QuickLink 同款語意。
                Category = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category.Trim(),
                // 空字串／純空白視為無備註（存 null）。
                Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
                StartedDateTime = request.StartedDateTime.HasValue
                    ? NormalizeToUtc(request.StartedDateTime.Value)
                    : DateTime.UtcNow,
                EndedDateTime = null,
                CreatedDateTime = DateTime.UtcNow,
                UpdatedDateTime = DateTime.UtcNow,
                CreatedUser = userId,
                UpdatedUser = userId,
                ValidFlag = true,
            };

            db.TimeEntry.Add(entry);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/time-entries/{entry.Id}",
                ApiResponse<TimeEntryDto>.Ok(MapTimeEntry(entry)));
        }).RequireRateLimiting(RateLimitingExtensions.PatPolicy);

        /// <summary>
        /// 結束「最近開始」的進行中項目（iOS 捷徑「一鍵結束」用；不需 body）。
        /// 平局 tie-break：StartedDateTime DESC → CreatedDateTime DESC → Id DESC（確定性）。
        /// POST /api/time-entries/stop-latest
        /// </summary>
        app.MapPost("/api/time-entries/stop-latest", async (
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entry = await db.TimeEntry
                .Where(t => t.UserId == userGuid && t.ValidFlag && t.EndedDateTime == null)
                .OrderByDescending(t => t.StartedDateTime)
                .ThenByDescending(t => t.CreatedDateTime)
                .ThenByDescending(t => t.Id)
                .FirstOrDefaultAsync(ct);

            if (entry is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("目前沒有進行中的計時項目", 404));
            }

            entry.EndedDateTime = DateTime.UtcNow;
            entry.UpdatedDateTime = DateTime.UtcNow;
            entry.UpdatedUser = userId;
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<TimeEntryDto>.Ok(MapTimeEntry(entry)));
        }).RequireRateLimiting(RateLimitingExtensions.PatPolicy);

        /// <summary>
        /// 結束指定項目的計時。結束時間未帶（或整個 body 省略）＝伺服器當下（UTC）。
        /// POST /api/time-entries/{id}/stop
        /// Body（選擇性）: { endedDateTime? }
        /// </summary>
        app.MapPost("/api/time-entries/{id:guid}/stop", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            StopTimeEntryRequest? request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entry = await db.TimeEntry
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);
            if (entry is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("找不到該計時項目", 404));
            }

            if (entry.EndedDateTime.HasValue)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("此項目已結束，不可重複結束", 400));
            }

            var endedUtc = request?.EndedDateTime.HasValue == true
                ? NormalizeToUtc(request.EndedDateTime!.Value)
                : DateTime.UtcNow;
            if (endedUtc < entry.StartedDateTime)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("結束時間不得早於開始時間", 400));
            }

            entry.EndedDateTime = endedUtc;
            entry.UpdatedDateTime = DateTime.UtcNow;
            entry.UpdatedUser = userId;
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<TimeEntryDto>.Ok(MapTimeEntry(entry)));
        }).RequireRateLimiting(RateLimitingExtensions.PatPolicy);

        /// <summary>
        /// 編輯項目（名稱／分類／開始／結束皆選擇性；null＝不改）。
        /// 可對「進行中」項目補上結束時間（等同結束、可自訂時間）；不能把結束時間清回 null。
        /// PUT /api/time-entries/{id}
        /// </summary>
        app.MapPut("/api/time-entries/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            UpdateTimeEntryRequest request,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entry = await db.TimeEntry
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);
            if (entry is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("找不到該計時項目", 404));
            }

            // 名稱：null = 不改；帶了但空白 = 400（名稱不可清空）。分類/備註長度一併驗。
            string? newTitle = null;
            if (request.Title != null)
            {
                newTitle = request.Title.Trim();
                var validationError = ValidateFields(newTitle, request.Category, request.Note, titleRequired: true);
                if (validationError is not null)
                {
                    return validationError;
                }
            }
            else
            {
                var validationError = ValidateFields(title: null, request.Category, request.Note, titleRequired: false);
                if (validationError is not null)
                {
                    return validationError;
                }
            }

            // 交叉時間驗證：以「更新後」的開始/結束計算（兩個方向都要擋——
            // 只改開始使其晚於既有結束、只改結束使其早於既有開始，皆為 400）。
            var effectiveStart = request.StartedDateTime.HasValue
                ? NormalizeToUtc(request.StartedDateTime.Value)
                : entry.StartedDateTime;
            var effectiveEnd = request.EndedDateTime.HasValue
                ? NormalizeToUtc(request.EndedDateTime.Value)
                : entry.EndedDateTime;
            if (effectiveEnd.HasValue && effectiveEnd.Value < effectiveStart)
            {
                return Results.BadRequest(ApiResponse<object>.Fail("結束時間不得早於開始時間", 400));
            }

            if (newTitle != null)
            {
                entry.Title = newTitle;
            }

            // 分類：null = 不更新；空字串/純空白 = 清為未分類；否則設定（去前後空白）。
            if (request.Category != null)
            {
                entry.Category = string.IsNullOrWhiteSpace(request.Category)
                    ? null
                    : request.Category.Trim();
            }

            // 備註：null = 不更新；空字串/純空白 = 清為無備註；否則設定（去前後空白）。
            if (request.Note != null)
            {
                entry.Note = string.IsNullOrWhiteSpace(request.Note)
                    ? null
                    : request.Note.Trim();
            }

            entry.StartedDateTime = effectiveStart;
            entry.EndedDateTime = effectiveEnd;
            entry.UpdatedDateTime = DateTime.UtcNow;
            entry.UpdatedUser = userId;
            await db.SaveChangesAsync(ct);

            return Results.Ok(ApiResponse<TimeEntryDto>.Ok(MapTimeEntry(entry)));
        }).RequireRateLimiting(RateLimitingExtensions.PatPolicy);

        /// <summary>
        /// 刪除項目（軟刪除：ValidFlag = false；可於統一垃圾桶還原）。
        /// DELETE /api/time-entries/{id}
        /// </summary>
        app.MapDelete("/api/time-entries/{id:guid}", async (
            Guid id,
            ZonWikiDbContext db,
            HttpContext httpContext,
            CancellationToken ct) =>
        {
            var userId = httpContext.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
            {
                return Results.Unauthorized();
            }

            var entry = await db.TimeEntry
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userGuid && t.ValidFlag, ct);
            if (entry is null)
            {
                return Results.NotFound(ApiResponse<object>.Fail("找不到該計時項目", 404));
            }

            entry.ValidFlag = false;
            entry.DeletedDateTime = DateTime.UtcNow; // 進垃圾桶需設刪除時間
            entry.UpdatedDateTime = DateTime.UtcNow;
            entry.UpdatedUser = userId;
            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        }).RequireRateLimiting(RateLimitingExtensions.PatPolicy);
    }

    /// <summary>
    /// 驗證名稱／分類／備註的必填與長度規則；通過回 null，未通過回 400 結果。
    /// </summary>
    /// <param name="title">已修剪的名稱（titleRequired 為 false 時可為 null＝不驗證名稱）。</param>
    /// <param name="category">分類原始值（未修剪；只驗長度，空白語意由呼叫端處理）。</param>
    /// <param name="note">備註原始值（未修剪；只驗長度，空白語意由呼叫端處理）。</param>
    /// <param name="titleRequired">是否要求名稱非空白。</param>
    /// <returns>驗證失敗的 400 結果，或 null（通過）。</returns>
    private static IResult? ValidateFields(string? title, string? category, string? note, bool titleRequired)
    {
        if (titleRequired && string.IsNullOrWhiteSpace(title))
        {
            return Results.BadRequest(ApiResponse<object>.Fail("項目名稱不可空白", 400));
        }

        if (title is not null && title.Length > TitleMaxLength)
        {
            return Results.BadRequest(ApiResponse<object>.Fail($"項目名稱不可超過 {TitleMaxLength} 字", 400));
        }

        if (category is not null && category.Trim().Length > CategoryMaxLength)
        {
            return Results.BadRequest(ApiResponse<object>.Fail($"分類不可超過 {CategoryMaxLength} 字", 400));
        }

        if (note is not null && note.Trim().Length > NoteMaxLength)
        {
            return Results.BadRequest(ApiResponse<object>.Fail($"備註不可超過 {NoteMaxLength} 字", 400));
        }

        return null;
    }

    /// <summary>
    /// 把入參 DateTime 正規化為 UTC Kind（Npgsql timestamptz 只接受 Utc Kind）：
    /// Utc → 原樣；Local（JSON 帶 +08:00 這類 offset 時 System.Text.Json 解成 Local）→ 轉 UTC；
    /// Unspecified（無時區尾碼）→ 依決策視為 UTC 補 Kind。
    /// </summary>
    /// <param name="value">入參時間。</param>
    /// <returns>UTC Kind 的同一時刻。</returns>
    private static DateTime NormalizeToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    /// <summary>
    /// 依「使用者時區」計算某範圍（day/week）的 UTC 半開區間 [from, to)。
    /// day＝當地當天 00:00～隔天 00:00；week＝當地本週一 00:00～下週一 00:00（週一為週首）。
    /// 時區解析失敗退回 Asia/Taipei（與全站其他端點一致）。
    /// </summary>
    /// <param name="scope">範圍："day" 或 "week"。</param>
    /// <param name="timeZoneId">使用者 IANA 時區（可空）。</param>
    /// <param name="nowUtc">目前 UTC 時刻。</param>
    /// <returns>UTC 半開區間（起含、迄不含）。</returns>
    internal static (DateTime FromUtc, DateTime ToUtc) ComputeScopeRangeUtc(
        string scope,
        string? timeZoneId,
        DateTime nowUtc)
    {
        TimeZoneInfo timeZone;
        try
        {
            timeZone = TimeZoneInfo.FindSystemTimeZoneById(
                string.IsNullOrWhiteSpace(timeZoneId) ? "Asia/Taipei" : timeZoneId);
        }
        catch (Exception) // TimeZoneNotFound／InvalidTimeZone／損毀 id 皆退回台北（比照 ProfileEndpoints 的全捕 fallback）
        {
            timeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Taipei");
        }

        // 當地「今天」的午夜（ConvertTimeFromUtc 回傳 Kind=Unspecified，直接取 .Date）。
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, timeZone);
        var localDate = localNow.Date;

        DateTime localStart;
        DateTime localEnd; // 不含
        if (scope == "week")
        {
            // 週一為週首：DayOfWeek 週日=0…週六=6，換算成「距離週一幾天」。
            var daysSinceMonday = ((int)localDate.DayOfWeek + 6) % 7;
            localStart = localDate.AddDays(-daysSinceMonday);
            localEnd = localStart.AddDays(7);
        }
        else
        {
            localStart = localDate;
            localEnd = localDate.AddDays(1);
        }

        return (LocalWallToUtc(localStart, timeZone), LocalWallToUtc(localEnd, timeZone));
    }

    /// <summary>
    /// 把「當地牆上時間」安全轉成 UTC——處理 DST 春進間隙：部分時區把 DST 轉換點設在午夜
    /// （如 America/Santiago），此時「當地 00:00」是不存在的無效時刻，直接 ConvertTimeToUtc 會丟
    /// ArgumentException → 裸 500。遇無效時刻就往後推進到間隙結束（該當地日的第一個有效瞬間）。
    /// </summary>
    /// <param name="localWall">當地牆上時間（將以 Unspecified Kind 處理）。</param>
    /// <param name="timeZone">目標時區。</param>
    /// <returns>對應的 UTC 時刻。</returns>
    private static DateTime LocalWallToUtc(DateTime localWall, TimeZoneInfo timeZone)
    {
        var wall = DateTime.SpecifyKind(localWall, DateTimeKind.Unspecified);

        // 無效時刻（春進間隙）→ 逐步推進到有效瞬間；上限 16×15 分＝4 小時，涵蓋任何真實 DST 間隙。
        var guard = 0;
        while (timeZone.IsInvalidTime(wall) && guard++ < 16)
        {
            wall = wall.AddMinutes(15);
        }

        return TimeZoneInfo.ConvertTimeToUtc(wall, timeZone);
    }

    /// <summary>
    /// 將時間追蹤實體投影為 DTO；時長（秒）＝結束－開始（計時中為 null），即時計算、不落欄位。
    /// </summary>
    /// <param name="entry">時間追蹤實體。</param>
    /// <returns>時間追蹤 DTO。</returns>
    private static TimeEntryDto MapTimeEntry(TimeEntry entry) =>
        new(
            entry.Id,
            entry.Title,
            entry.Category,
            entry.Note,
            entry.StartedDateTime,
            entry.EndedDateTime,
            entry.EndedDateTime.HasValue
                ? (long)Math.Round((entry.EndedDateTime.Value - entry.StartedDateTime).TotalSeconds)
                : null);
}
