using Microsoft.EntityFrameworkCore;
using ZonWiki.Api.Auth;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 筆記文字標註端點：對一篇筆記的「畫重點 / 做關聯 / 寫備註」做 CRUD。
/// 標註以錨點（文字＋位移＋前後文）定位、不嵌入內文；關聯目標可為其他筆記 / 任務 / 開問啦節點 / 外部網址。
/// 列出時會解析關聯目標的顯示名稱（供前端 hover 浮窗顯示與導航）。
/// </summary>
public static class NoteMarkEndpoints
{
    /// <summary>
    /// 註冊筆記文字標註端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapNoteMarkEndpoints(this IEndpointRouteBuilder app)
    {
        // 列出某筆記的所有標註（並解析關聯目標顯示名稱）
        app.MapGet("/api/notes/{noteId:guid}/marks", async (
            Guid noteId, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            var marks = await db.NoteMark
                .Where(m => m.UserId == userGuid && m.NoteId == noteId && m.ValidFlag)
                .OrderBy(m => m.AnchorStart)
                .ToListAsync(ct);

            // 批次解析「關聯」目標的顯示名稱與（筆記）slug。
            var noteIds = marks.Where(m => m.Kind == "link" && m.TargetType == "note" && m.TargetId.HasValue)
                .Select(m => m.TargetId!.Value).Distinct().ToList();
            var taskIds = marks.Where(m => m.Kind == "link" && m.TargetType == "taskcard" && m.TargetId.HasValue)
                .Select(m => m.TargetId!.Value).Distinct().ToList();
            var nodeIds = marks.Where(m => m.Kind == "link" && m.TargetType == "node" && m.TargetId.HasValue)
                .Select(m => m.TargetId!.Value).Distinct().ToList();

            var noteMap = noteIds.Count == 0 ? new() : await db.Note
                .Where(n => noteIds.Contains(n.Id) && n.ValidFlag)
                .Select(n => new { n.Id, n.Title, n.Slug })
                .ToDictionaryAsync(n => n.Id, ct);
            var taskMap = taskIds.Count == 0 ? new() : await db.TaskCard
                .Where(t => taskIds.Contains(t.Id) && t.ValidFlag)
                .Select(t => new { t.Id, t.Title })
                .ToDictionaryAsync(t => t.Id, ct);
            // 跨帳號隔離：Node 非 IUserOwned、無全域過濾。解析「關聯到節點」的顯示名稱時，
            // 必須以所屬 Canvas 的 UserId 過濾本人擁有的節點，否則只要在自己的標註裡塞一個別人的 NodeId，
            // 就能藉由本端點讀到別人節點的內容片段（跨帳號外洩）。切勿用 IgnoreQueryFilters 繞過。
            var nodeMap = nodeIds.Count == 0 ? new() : await db.Node
                .Where(n => nodeIds.Contains(n.Id) && n.ValidFlag &&
                    n.Canvas != null && n.Canvas.UserId == userGuid && n.Canvas.ValidFlag)
                .Select(n => new { n.Id, n.Content })
                .ToDictionaryAsync(n => n.Id, ct);

            var result = marks.Select(m =>
            {
                string? title = null;
                string? slug = null;
                if (m.Kind == "link")
                {
                    switch (m.TargetType)
                    {
                        case "note" when m.TargetId.HasValue && noteMap.TryGetValue(m.TargetId.Value, out var n):
                            title = n.Title; slug = n.Slug; break;
                        case "taskcard" when m.TargetId.HasValue && taskMap.TryGetValue(m.TargetId.Value, out var t):
                            title = t.Title; break;
                        case "node" when m.TargetId.HasValue && nodeMap.TryGetValue(m.TargetId.Value, out var nd):
                            title = Snippet(nd.Content); break;
                        case "url":
                            title = m.TargetUrl; break;
                    }
                    // 目標已不存在（被刪）→ 顯示提示。
                    if (title is null && m.TargetType != "url") title = "(目標已刪除)";
                }

                return new NoteMarkDto(
                    m.Id, m.Kind, m.AnchorText, m.AnchorStart, m.AnchorEnd,
                    m.AnchorPrefix, m.AnchorSuffix, m.Detached,
                    m.Color, m.TargetType, m.TargetId, m.TargetUrl, title, slug, m.Text);
            }).ToList();

            return Results.Ok(ApiResponse<List<NoteMarkDto>>.Ok(result));
        }).RequireAuthorization();

        // 建立標註
        app.MapPost("/api/notes/{noteId:guid}/marks", async (
            Guid noteId, CreateNoteMarkRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            // 驗證筆記擁有權。
            var owns = await db.Note.AnyAsync(n => n.Id == noteId && n.ValidFlag && n.UserId == userGuid, ct);
            if (!owns) return Results.NotFound(ApiResponse<NoteMarkDto>.Fail("Note not found", 404));

            var kind = (req.Kind ?? "").Trim().ToLowerInvariant();
            if (kind != "highlight" && kind != "link" && kind != "annotation")
                return Results.BadRequest(ApiResponse<NoteMarkDto>.Fail("未知的標註種類", 400));
            if (string.IsNullOrEmpty(req.AnchorText))
                return Results.BadRequest(ApiResponse<NoteMarkDto>.Fail("缺少錨點文字", 400));

            // 跨帳號隔離：若是「關聯到開問啦節點」的標註，必須驗證目標節點為本人所擁有（經其 Canvas）。
            // 否則使用者可在自己的標註塞入他人節點 Id，再透過 GET marks 端點讀到他人節點內容片段。
            if (kind == "link"
                && string.Equals(req.TargetType, "node", StringComparison.OrdinalIgnoreCase)
                && req.TargetId.HasValue)
            {
                var ownsTargetNode = await db.Node.AnyAsync(
                    n => n.Id == req.TargetId.Value && n.ValidFlag &&
                        n.Canvas != null && n.Canvas.UserId == userGuid && n.Canvas.ValidFlag,
                    ct);
                if (!ownsTargetNode)
                    return Results.NotFound(ApiResponse<NoteMarkDto>.Fail("找不到目標節點或無權限", 404));
            }

            var mark = new NoteMark
            {
                UserId = userGuid,
                NoteId = noteId,
                Kind = kind,
                AnchorText = req.AnchorText,
                AnchorStart = req.AnchorStart,
                AnchorEnd = req.AnchorEnd,
                AnchorPrefix = req.AnchorPrefix ?? "",
                AnchorSuffix = req.AnchorSuffix ?? "",
                Detached = false,
                Color = kind == "highlight" ? (req.Color ?? "yellow") : null,
                TargetType = kind == "link" ? req.TargetType : null,
                TargetId = kind == "link" ? req.TargetId : null,
                TargetUrl = kind == "link" ? req.TargetUrl : null,
                Text = kind == "annotation" ? req.Text : null,
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.NoteMark.Add(mark);
            await db.SaveChangesAsync(ct);

            var dto = new NoteMarkDto(
                mark.Id, mark.Kind, mark.AnchorText, mark.AnchorStart, mark.AnchorEnd,
                mark.AnchorPrefix, mark.AnchorSuffix, mark.Detached,
                mark.Color, mark.TargetType, mark.TargetId, mark.TargetUrl, null, null, mark.Text);
            return Results.Ok(ApiResponse<NoteMarkDto>.Ok(dto));
        }).RequireAuthorization();

        // 更新標註（編輯備註文字 / 重點顏色）
        app.MapPut("/api/notes/marks/{markId:guid}", async (
            Guid markId, UpdateNoteMarkRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var mark = await db.NoteMark.FirstOrDefaultAsync(m => m.Id == markId && m.UserId == userGuid && m.ValidFlag, ct);
            if (mark is null) return Results.NotFound(ApiResponse<object>.Fail("Mark not found", 404));

            if (req.Text != null && mark.Kind == "annotation") mark.Text = req.Text;
            if (!string.IsNullOrEmpty(req.Color) && mark.Kind == "highlight") mark.Color = req.Color;
            mark.UpdatedDateTime = DateTime.UtcNow;
            mark.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { id = mark.Id }));
        }).RequireAuthorization();

        // 刪除標註（軟刪除）
        app.MapDelete("/api/notes/marks/{markId:guid}", async (
            Guid markId, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();
            var mark = await db.NoteMark.FirstOrDefaultAsync(m => m.Id == markId && m.UserId == userGuid && m.ValidFlag, ct);
            if (mark is null) return Results.NotFound(ApiResponse<object>.Fail("Mark not found", 404));
            mark.ValidFlag = false;
            mark.DeletedDateTime = DateTime.UtcNow;
            mark.UpdatedDateTime = DateTime.UtcNow;
            mark.UpdatedUser = userGuid.ToString();
            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { id = mark.Id }));
        }).RequireAuthorization();
    }

    /// <summary>取節點內容前 40 字作為顯示摘要。</summary>
    private static string Snippet(string? content)
    {
        var c = (content ?? "").Trim().Replace("\n", " ");
        return c.Length <= 40 ? c : c[..40] + "…";
    }

    /// <summary>從 claim 取出登入使用者 Id。</summary>
    private static bool TryUser(HttpContext http, out Guid userGuid)
    {
        var id = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return Guid.TryParse(id, out userGuid);
    }
}
