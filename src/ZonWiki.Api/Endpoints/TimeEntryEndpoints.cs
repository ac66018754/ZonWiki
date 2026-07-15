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
            var validationError = ValidateTitleAndCategory(title, request.Category, titleRequired: true);
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

            // 名稱：null = 不改；帶了但空白 = 400（名稱不可清空）。
            string? newTitle = null;
            if (request.Title != null)
            {
                newTitle = request.Title.Trim();
                var validationError = ValidateTitleAndCategory(newTitle, request.Category, titleRequired: true);
                if (validationError is not null)
                {
                    return validationError;
                }
            }
            else
            {
                var validationError = ValidateTitleAndCategory(title: null, request.Category, titleRequired: false);
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
    /// 驗證名稱與分類的必填/長度規則；通過回 null，未通過回 400 結果。
    /// </summary>
    /// <param name="title">已修剪的名稱（titleRequired 為 false 時可為 null＝不驗證名稱）。</param>
    /// <param name="category">分類原始值（未修剪；只驗長度，空白語意由呼叫端處理）。</param>
    /// <param name="titleRequired">是否要求名稱非空白。</param>
    /// <returns>驗證失敗的 400 結果，或 null（通過）。</returns>
    private static IResult? ValidateTitleAndCategory(string? title, string? category, bool titleRequired)
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
    /// 將時間追蹤實體投影為 DTO；時長（秒）＝結束－開始（計時中為 null），即時計算、不落欄位。
    /// </summary>
    /// <param name="entry">時間追蹤實體。</param>
    /// <returns>時間追蹤 DTO。</returns>
    private static TimeEntryDto MapTimeEntry(TimeEntry entry) =>
        new(
            entry.Id,
            entry.Title,
            entry.Category,
            entry.StartedDateTime,
            entry.EndedDateTime,
            entry.EndedDateTime.HasValue
                ? (long)Math.Round((entry.EndedDateTime.Value - entry.StartedDateTime).TotalSeconds)
                : null);
}
