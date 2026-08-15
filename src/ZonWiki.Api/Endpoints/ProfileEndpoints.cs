using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 個人頁相關端點：個人資料、統計、每日活動、修改 email（需驗證碼）、刪除帳號。
/// 修改密碼沿用既有 /api/auth/change-password；登出沿用 /api/auth/logout。
/// </summary>
public static class ProfileEndpoints
{
    /// <summary>修改顯示名稱（暱稱）請求。</summary>
    public sealed record UpdateProfileRequest(string DisplayName);

    /// <summary>
    /// 註冊個人頁端點。
    /// </summary>
    public static void MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        // 個人資料
        app.MapGet("/api/me/profile", async (HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var u = await db.User.IgnoreQueryFilters()
                .FirstOrDefaultAsync(x => x.Id == userGuid && x.ValidFlag, ct);
            if (u is null) return Results.Unauthorized();
            return Results.Ok(new
            {
                success = true,
                data = new
                {
                    userId = u.Id.ToString(),
                    email = u.Email,
                    displayName = u.DisplayName,
                    avatarUrl = u.AvatarUrl,
                    createdDateTime = u.CreatedDateTime,
                    googleLinked = !string.IsNullOrEmpty(u.GoogleSub),
                },
            });
        }).RequireAuthorization();

        // 修改暱稱（顯示名稱）— 並重新簽發 Cookie 讓 Header 立即反映
        app.MapPut("/api/me/profile", async (
            UpdateProfileRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(req.DisplayName))
                return Results.BadRequest(new { success = false, error = "暱稱不可為空" });

            var u = await db.User.IgnoreQueryFilters()
                .FirstOrDefaultAsync(x => x.Id == userGuid && x.ValidFlag, ct);
            if (u is null) return Results.Unauthorized();

            u.DisplayName = req.DisplayName.Trim();
            u.UpdatedDateTime = DateTime.UtcNow;
            u.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);
            await AuthPasswordEndpoints.SignInUserAsync(http, u); // 重發 Cookie（更新 Name claim）

            return Results.Ok(new { success = true, data = new { displayName = u.DisplayName } });
        }).RequireAuthorization();

        // 統計數據（筆記/任務/畫布/節點/常用連結/快速記錄/標籤/分類）
        app.MapGet("/api/me/stats", async (HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            // 以 IgnoreQueryFilters + 明確 UserId 計數（清楚、不倚賴全域過濾器）。
            var notes = await db.Note.IgnoreQueryFilters().CountAsync(n => n.UserId == userGuid && n.ValidFlag, ct);
            var tasks = await db.TaskCard.IgnoreQueryFilters().CountAsync(t => t.UserId == userGuid && t.ValidFlag, ct);
            var canvases = await db.Canvas.IgnoreQueryFilters().CountAsync(c => c.UserId == userGuid && c.ValidFlag, ct);
            var nodes = await db.Node.IgnoreQueryFilters()
                .CountAsync(n => n.ValidFlag && n.Canvas != null && n.Canvas.UserId == userGuid && n.Canvas.ValidFlag, ct);
            var quickLinks = await db.QuickLink.IgnoreQueryFilters().CountAsync(q => q.UserId == userGuid && q.ValidFlag, ct);
            var captures = await db.CaptureItem.IgnoreQueryFilters().CountAsync(c => c.UserId == userGuid && c.ValidFlag, ct);
            var tags = await db.Tag.IgnoreQueryFilters().CountAsync(t => t.UserId == userGuid && t.ValidFlag, ct);
            var categories = await db.Category.IgnoreQueryFilters().CountAsync(c => c.UserId == userGuid && c.ValidFlag, ct);

            return Results.Ok(new
            {
                success = true,
                data = new { notes, tasks, canvases, nodes, quickLinks, captures, tags, categories },
            });
        }).RequireAuthorization();

        // 每日活動：近 N 天，依使用者時區把建立時間歸日、按型別計數
        app.MapGet("/api/me/activity", async (HttpContext http, ZonWikiDbContext db, int days, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            if (days < 1 || days > 365) days = 30;

            var user = await db.User.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == userGuid, ct);
            var tz = ResolveTimeZone(user?.TimeZone);
            var from = DateTime.UtcNow.AddDays(-days);

            async Task<List<DateTime>> Stamps(IQueryable<DateTime> q) => await q.ToListAsync(ct);

            var noteTs = await Stamps(db.Note.IgnoreQueryFilters().Where(n => n.UserId == userGuid && n.ValidFlag && n.CreatedDateTime >= from).Select(n => n.CreatedDateTime));
            var taskTs = await Stamps(db.TaskCard.IgnoreQueryFilters().Where(t => t.UserId == userGuid && t.ValidFlag && t.CreatedDateTime >= from).Select(t => t.CreatedDateTime));
            var canvasTs = await Stamps(db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == userGuid && c.ValidFlag && c.CreatedDateTime >= from).Select(c => c.CreatedDateTime));
            var nodeTs = await Stamps(db.Node.IgnoreQueryFilters().Where(n => n.ValidFlag && n.Canvas != null && n.Canvas.UserId == userGuid && n.CreatedDateTime >= from).Select(n => n.CreatedDateTime));
            var captureTs = await Stamps(db.CaptureItem.IgnoreQueryFilters().Where(c => c.UserId == userGuid && c.ValidFlag && c.CreatedDateTime >= from).Select(c => c.CreatedDateTime));

            // 依使用者時區把 UTC 時間歸到日期（yyyy-MM-dd）
            var buckets = new Dictionary<string, Dictionary<string, int>>();
            void Bucket(List<DateTime> stamps, string type)
            {
                foreach (var utc in stamps)
                {
                    var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz);
                    var key = local.ToString("yyyy-MM-dd");
                    if (!buckets.TryGetValue(key, out var counts)) { counts = new(); buckets[key] = counts; }
                    counts[type] = counts.GetValueOrDefault(type) + 1;
                }
            }
            Bucket(noteTs, "notes");
            Bucket(taskTs, "tasks");
            Bucket(canvasTs, "canvases");
            Bucket(nodeTs, "nodes");
            Bucket(captureTs, "captures");

            var result = buckets
                .OrderByDescending(kv => kv.Key)
                .Select(kv => new
                {
                    date = kv.Key,
                    notes = kv.Value.GetValueOrDefault("notes"),
                    tasks = kv.Value.GetValueOrDefault("tasks"),
                    canvases = kv.Value.GetValueOrDefault("canvases"),
                    nodes = kv.Value.GetValueOrDefault("nodes"),
                    captures = kv.Value.GetValueOrDefault("captures"),
                    total = kv.Value.Values.Sum(),
                })
                .ToList();

            return Results.Ok(new { success = true, data = result });
        }).RequireAuthorization();

        // 活動明細：逐筆列出最近的操作紀錄（新增/編輯/刪除/還原，標題級）
        app.MapGet("/api/me/activity-log", async (
            HttpContext http, ZonWikiDbContext db, int? days, int? take, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var dayWindow = days is >= 1 and <= 365 ? days.Value : 30;
            var limit = take is >= 1 and <= 500 ? take.Value : 200;
            var from = DateTime.UtcNow.AddDays(-dayWindow);

            var items = await db.ActivityLog
                .Where(a => a.UserId == userGuid && a.ValidFlag && a.CreatedDateTime >= from)
                .OrderByDescending(a => a.CreatedDateTime)
                .Take(limit)
                .Select(a => new
                {
                    id = a.Id,
                    action = a.ActionType,
                    entityType = a.EntityType,
                    entityId = a.EntityId,
                    title = a.Title,
                    detail = a.Detail,
                    at = a.CreatedDateTime,
                })
                .ToListAsync(ct);

            // 為「筆記」項目補上該筆記「目前」的分類完整路徑（用於在活動明細中區分同名筆記；
            // 註：這是查詢當下的分類，非動作發生時的歷史快照——ActivityLog 不存分類歷史，取捨見 DECISIONS）。
            var noteEntityIds = items
                .Where(i => i.entityType == "note")
                .Select(i => i.entityId)
                .Distinct()
                .ToList();

            var categoriesByNote = new Dictionary<Guid, List<string>>();
            if (noteEntityIds.Count > 0)
            {
                var categoryRows = await db.Category.AsNoTracking()
                    .Where(c => c.UserId == userGuid && c.ValidFlag)
                    .Select(c => new { c.Id, c.ParentId, c.Name })
                    .ToListAsync(ct);
                var hierarchy = CategoryHierarchy.Build(
                    categoryRows.Select(c => (c.Id, c.ParentId, c.Name)));

                var noteCategoryLinks = await db.NoteCategory.AsNoTracking()
                    .Where(nc => nc.UserId == userGuid && nc.ValidFlag && noteEntityIds.Contains(nc.NoteId))
                    .Select(nc => new { nc.NoteId, nc.CategoryId })
                    .ToListAsync(ct);

                categoriesByNote = noteCategoryLinks
                    .GroupBy(link => link.NoteId)
                    .ToDictionary(
                        group => group.Key,
                        group => group
                            .Select(link => hierarchy.BuildPath(link.CategoryId))
                            .Where(path => !string.IsNullOrEmpty(path))
                            .ToList());
            }

            var result = items.Select(i => new
            {
                i.id,
                i.action,
                i.entityType,
                i.entityId,
                i.title,
                i.detail,
                i.at,
                // 筆記→目前分類路徑（可能為空陣列）；其他型別→null（前端據此只對筆記顯示分類）。
                categories = i.entityType == "note"
                    ? (categoriesByNote.TryGetValue(i.entityId, out var paths) ? paths : new List<string>())
                    : null,
            });

            return Results.Ok(new { success = true, data = result });
        }).RequireAuthorization();

        // 首頁「AI 最近動作」：列出由「外部 AI（API 權杖）」對知識庫做的 CRUD 軌跡，
        // 支援來源 / 實體型別 / 動作 / 關鍵字篩選與分頁；並回傳「有哪些 AI 來源」供前端做下拉。
        // source 規則：未給＝只看 AI（Source != "web"）；"all"＝含人類網頁操作；其餘＝指定來源（權杖名）。
        app.MapGet("/api/home/ai-activity", async (
            HttpContext http,
            ZonWikiDbContext db,
            string? source,
            string? entityType,
            string? action,
            string? q,
            int? days,
            int? take,
            int? skip,
            CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var dayWindow = days is >= 1 and <= 365 ? days.Value : 30;
            var limit = take is >= 1 and <= 200 ? take.Value : 50;
            var offset = skip is >= 0 ? skip.Value : 0;
            var from = DateTime.UtcNow.AddDays(-dayWindow);

            var baseQuery = db.ActivityLog
                .Where(a => a.UserId == userGuid && a.ValidFlag && a.CreatedDateTime >= from);

            if (string.IsNullOrWhiteSpace(source))
            {
                baseQuery = baseQuery.Where(a => a.Source != "web"); // 預設只看 AI
            }
            else if (!string.Equals(source, "all", StringComparison.OrdinalIgnoreCase))
            {
                baseQuery = baseQuery.Where(a => a.Source == source);
            }

            if (!string.IsNullOrWhiteSpace(entityType))
            {
                baseQuery = baseQuery.Where(a => a.EntityType == entityType);
            }
            if (!string.IsNullOrWhiteSpace(action))
            {
                baseQuery = baseQuery.Where(a => a.ActionType == action);
            }
            if (!string.IsNullOrWhiteSpace(q))
            {
                baseQuery = baseQuery.Where(a => EF.Functions.ILike(a.Title, $"%{q}%"));
            }

            var total = await baseQuery.CountAsync(ct);
            var items = await baseQuery
                .OrderByDescending(a => a.CreatedDateTime)
                .Skip(offset)
                .Take(limit)
                .Select(a => new
                {
                    id = a.Id,
                    source = a.Source,
                    action = a.ActionType,
                    entityType = a.EntityType,
                    entityId = a.EntityId,
                    title = a.Title,
                    at = a.CreatedDateTime,
                })
                .ToListAsync(ct);

            // 近窗內的 AI 來源清單（含筆數），供前端做來源下拉篩選。
            var sources = await db.ActivityLog
                .Where(a => a.UserId == userGuid && a.ValidFlag && a.CreatedDateTime >= from && a.Source != "web")
                .GroupBy(a => a.Source)
                .Select(g => new { source = g.Key, count = g.Count() })
                .OrderByDescending(x => x.count)
                .ToListAsync(ct);

            return Results.Ok(new { success = true, data = new { items, total, sources } });
        }).RequireAuthorization();

        // 刪除帳號（軟刪除）並立即登出
        app.MapDelete("/api/me", async (HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var u = await db.User.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == userGuid, ct);
            if (u is not null)
            {
                u.ValidFlag = false;
                u.DeletedDateTime = DateTime.UtcNow;
                u.UpdatedDateTime = DateTime.UtcNow;
                u.UpdatedUser = userGuid.ToString();
                await db.SaveChangesAsync(ct);
            }
            await http.SignOutAsync(); // 立即登出
            return Results.Ok(new { success = true });
        }).RequireAuthorization();
    }

    /// <summary>從 HttpContext 取出當前使用者 GUID。</summary>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var id = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(id, out userGuid);
    }

    /// <summary>解析使用者時區（IANA）；空或無效則回退 Asia/Taipei。</summary>
    private static TimeZoneInfo ResolveTimeZone(string? tz)
    {
        if (!string.IsNullOrWhiteSpace(tz))
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(tz); } catch { /* fall through */ }
        }
        try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Taipei"); } catch { return TimeZoneInfo.Utc; }
    }

}
