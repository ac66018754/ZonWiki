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

            // referencedBy（僅 anchor 需要）：一次查詢反查「誰的 link 指向這些 anchor」，避免逐個 anchor N+1。
            // 依 anchor 分組 → 去重來源筆記標題 → 依標題 Ordinal 排序（確認框顯示「被《X》引用」用；
            // Ordinal 與 backlinks 排序一致，跨環境確定、可被整合測試釘死）。
            var anchorIds = marks.Where(m => m.Kind == "anchor").Select(m => m.Id).ToList();
            var referencedByMap = new Dictionary<Guid, List<string>>();
            if (anchorIds.Count > 0)
            {
                var referencingRows = await db.NoteMark
                    .Where(m => m.Kind == "link" && m.ValidFlag && m.UserId == userGuid
                        && m.TargetMarkId != null && anchorIds.Contains(m.TargetMarkId.Value))
                    .Join(
                        db.Note.Where(n => n.ValidFlag && n.UserId == userGuid),
                        m => m.NoteId,
                        n => n.Id,
                        (m, n) => new { AnchorId = m.TargetMarkId!.Value, n.Title })
                    .ToListAsync(ct);

                referencedByMap = referencingRows
                    .GroupBy(r => r.AnchorId)
                    .ToDictionary(
                        g => g.Key,
                        g => g.Select(x => x.Title)
                            .Distinct()
                            .OrderBy(t => t, StringComparer.Ordinal)
                            .ToList());
            }

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

                // referencedBy 一律給非 null 陣列（前端免 null 防禦）；非 anchor 為空陣列。
                var referencedBy = referencedByMap.TryGetValue(m.Id, out var titles)
                    ? (IReadOnlyList<string>)titles
                    : Array.Empty<string>();

                return new NoteMarkDto(
                    m.Id, m.Kind, m.AnchorText, m.AnchorStart, m.AnchorEnd,
                    m.AnchorPrefix, m.AnchorSuffix, m.Detached,
                    m.Color, m.TargetType, m.TargetId, m.TargetUrl, title, slug, m.Text,
                    m.TargetMarkId, referencedBy);
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
            if (kind != "highlight" && kind != "link" && kind != "annotation" && kind != "anchor")
                return Results.BadRequest(ApiResponse<NoteMarkDto>.Fail("未知的標註種類", 400));
            if (string.IsNullOrEmpty(req.AnchorText))
                return Results.BadRequest(ApiResponse<NoteMarkDto>.Fail("缺少錨點文字", 400));

            // 段落級關聯驗證：link 帶 TargetMarkId 時，該錨點必須「屬於本人、有效、
            // 且正是 targetId 那篇筆記內的 kind="anchor"」——否則段落目標無意義（跨篇／跨帳號／型別錯）。
            // 段落目標只存在於筆記，故 targetType 必須是 note（防呆：不接受 url/taskcard/node 帶 targetMarkId）。
            // 跨帳號情形因全域過濾（＋顯式 UserId）根本查不到 → 一律回 400（測試接受 400/404）。
            if (kind == "link" && req.TargetMarkId.HasValue)
            {
                if (!string.Equals(req.TargetType, "note", StringComparison.OrdinalIgnoreCase)
                    || !req.TargetId.HasValue)
                {
                    return Results.BadRequest(
                        ApiResponse<NoteMarkDto>.Fail("段落目標只允許關聯到筆記（targetType=note）", 400));
                }

                var targetAnchor = await db.NoteMark.FirstOrDefaultAsync(
                    m => m.Id == req.TargetMarkId.Value && m.UserId == userGuid && m.ValidFlag, ct);
                if (targetAnchor is null
                    || targetAnchor.Kind != "anchor"
                    || targetAnchor.NoteId != req.TargetId.Value)
                {
                    return Results.BadRequest(
                        ApiResponse<NoteMarkDto>.Fail("段落目標錨點無效：必須是目標筆記內、屬於你的錨點", 400));
                }
            }

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
                TargetMarkId = kind == "link" ? req.TargetMarkId : null,
                Text = kind == "annotation" ? req.Text : null,
                CreatedUser = userGuid.ToString(),
                UpdatedUser = userGuid.ToString(),
            };
            db.NoteMark.Add(mark);
            await db.SaveChangesAsync(ct);

            var dto = new NoteMarkDto(
                mark.Id, mark.Kind, mark.AnchorText, mark.AnchorStart, mark.AnchorEnd,
                mark.AnchorPrefix, mark.AnchorSuffix, mark.Detached,
                mark.Color, mark.TargetType, mark.TargetId, mark.TargetUrl, null, null, mark.Text,
                mark.TargetMarkId, Array.Empty<string>());
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

            var now = DateTime.UtcNow;
            var actor = userGuid.ToString();
            mark.ValidFlag = false;
            mark.DeletedDateTime = now;
            mark.UpdatedDateTime = now;
            mark.UpdatedUser = actor;

            // 孤兒 anchor 連動軟刪（段落級關聯裁決，見 docs/DECISIONS.md）：
            // 刪掉「帶 TargetMarkId 的 link」後，若其目標 anchor 已無任何其他「活的」link 指向
            // → 該 anchor 成孤兒（純錨定點、無自身意義），一併軟刪，避免遺留看不見的殭屍錨點。
            // 仍被其他 link 引用者不動（共用錨點不可被單一來源的刪除誤除）。
            if (mark.Kind == "link" && mark.TargetMarkId.HasValue)
            {
                var anchorId = mark.TargetMarkId.Value;
                // 以 m.Id != mark.Id 排除「當下正在刪的這一筆」（其 DB 值尚為 ValidFlag=true，尚未存檔）。
                // 必須 join 來源筆記並過濾其 ValidFlag——與 referencedBy 的讀取路徑一致：
                // 來源筆記整篇軟刪時，其 link（既有行為不連動軟刪）是「殭屍引用」，不得永遠撐住錨點。
                var stillReferenced = await db.NoteMark
                    .Where(m => m.Id != mark.Id && m.Kind == "link" && m.ValidFlag && m.UserId == userGuid
                        && m.TargetMarkId == anchorId)
                    .Join(
                        db.Note.Where(n => n.ValidFlag && n.UserId == userGuid),
                        m => m.NoteId,
                        n => n.Id,
                        (m, n) => m.Id)
                    .AnyAsync(ct);
                if (!stillReferenced)
                {
                    var anchor = await db.NoteMark.FirstOrDefaultAsync(
                        m => m.Id == anchorId && m.Kind == "anchor" && m.ValidFlag && m.UserId == userGuid, ct);
                    if (anchor is not null)
                    {
                        anchor.ValidFlag = false;
                        anchor.DeletedDateTime = now;
                        anchor.UpdatedDateTime = now;
                        anchor.UpdatedUser = actor;
                    }
                }
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(ApiResponse<object>.Ok(new { id = mark.Id }));
        }).RequireAuthorization();

        // 回寫「錨點失效狀態（Detached）」——瀏覽器為唯一座標系（見 docs/DECISIONS.md）：
        // 後端不算 reAnchor，只信任前端每次真實渲染後計算的 found，並以 ContentHash 防過期覆蓋。
        app.MapPatch("/api/notes/marks/{markId:guid}/detached", async (
            Guid markId, PatchMarkDetachedRequest req, HttpContext http, ZonWikiDbContext db, CancellationToken ct) =>
        {
            if (!TryUser(http, out var userGuid)) return Results.Unauthorized();

            // 全域過濾 ＋ 顯式 UserId：他人的 mark 查不到 → 404（信任模型僅及於自己的資料）。
            var mark = await db.NoteMark.FirstOrDefaultAsync(
                m => m.Id == markId && m.UserId == userGuid && m.ValidFlag, ct);
            if (mark is null) return Results.NotFound(ApiResponse<object>.Fail("Mark not found", 404));

            // 取所屬筆記目前的 ContentHash 做「過期防呆」比對。
            var currentHash = await db.Note
                .Where(n => n.Id == mark.NoteId && n.ValidFlag && n.UserId == userGuid)
                .Select(n => n.ContentHash)
                .FirstOrDefaultAsync(ct);

            // hash 一致（前端當次渲染即最新內容）→ 寫入；不一致（停在舊內容的分頁送來的過期計算）→ no-op。
            // 兩者都回 200：fire-and-forget 客端不需分辨，過期計算「絕不」覆蓋另一分頁剛寫對的值。
            if (currentHash is not null
                && string.Equals(currentHash, req.ContentHash, StringComparison.Ordinal)
                && mark.Detached != req.Detached)
            {
                mark.Detached = req.Detached;
                mark.UpdatedDateTime = DateTime.UtcNow;
                mark.UpdatedUser = userGuid.ToString();
                await db.SaveChangesAsync(ct);
            }

            return Results.Ok(ApiResponse<object>.Ok(new { id = mark.Id, detached = mark.Detached }));
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
