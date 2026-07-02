using System.Text.RegularExpressions;
using Markdig;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Notes;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 「AI 整合」端點：給外部 AI 助理（Claude Code / Hermes / ChatGPT 的 Custom GPT Action…）
/// 用「一次呼叫」就完成「資料夾名稱→（巢狀）分類、Markdown→筆記、正確歸類、貼標籤」。
///
/// 與既有 <c>POST /api/notes</c>（需先知道分類 GUID）不同，本端點接受「分類名稱路徑」與「標籤名稱」，
/// 由後端自動「找不到就建立」，因此 AI 不必先查分類 ID、不必多輪往返，最貼近以下情境：
/// - 「幫我把這篇文章整理成筆記，放到『學習/Python』分類」
/// - 把本機資料夾整批匯入（資料夾路徑＝分類路徑、檔名＝標題）。
///
/// 驗證：與其它端點相同，走「Cookie 或 API 權杖」——AI 客戶端以 <c>Authorization: Bearer &lt;PAT&gt;</c> 呼叫。
/// </summary>
public static class AiIntegrationEndpoints
{
    /// <summary>
    /// Wiki 連結比對：擷取 [[X]] 形式（與筆記寫入端點一致，確保 AI 建立的筆記也有反向連結）。
    /// </summary>
    private static readonly Regex WikiLinkRegex = new(
        @"\[\[([^\]\r\n]+)\]\]",
        RegexOptions.Compiled);

    /// <summary>
    /// AI 建立/更新筆記的請求。
    /// </summary>
    /// <param name="Title">筆記標題（必填）。</param>
    /// <param name="ContentRaw">Markdown 內容（可空）。</param>
    /// <param name="CategoryPath">
    /// 分類名稱路徑（由上而下），例如 ["學習","Python"] 會建立/沿用「學習 → Python」的巢狀分類，
    /// 筆記歸到最末層「Python」。可空＝不歸類。
    /// </param>
    /// <param name="Tags">標籤名稱清單（找不到就自動建立）。可空。</param>
    /// <param name="Upsert">
    /// 是否「同分類同標題就更新、而非新增」（避免反覆匯入產生重複）。預設 false（一律新增）。
    /// </param>
    public sealed record AiCreateNoteRequest(
        string Title,
        string? ContentRaw = null,
        List<string>? CategoryPath = null,
        List<string>? Tags = null,
        bool Upsert = false);

    /// <summary>
    /// AI 建立/更新筆記的回應。
    /// </summary>
    /// <param name="Id">筆記識別碼。</param>
    /// <param name="Title">標題。</param>
    /// <param name="Slug">網址代稱。</param>
    /// <param name="CategoryId">所歸最末層分類識別碼（無歸類為 null）。</param>
    /// <param name="CategoryPath">實際使用/建立的分類名稱路徑。</param>
    /// <param name="Created">true＝新建；false＝更新既有（upsert 命中）。</param>
    public sealed record AiCreateNoteResultDto(
        Guid Id,
        string Title,
        string Slug,
        Guid? CategoryId,
        List<string> CategoryPath,
        bool Created);

    /// <summary>
    /// 註冊 AI 整合端點。
    /// </summary>
    /// <param name="app">端點路由建構器。</param>
    public static void MapAiIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/ai/notes", CreateOrUpsertNoteHandler)
            .WithName("AiCreateNote")
            .WithTags("AI Integration");
    }

    /// <summary>
    /// 建立或更新一篇筆記，並依「分類名稱路徑」自動建立/沿用巢狀分類、依「標籤名稱」自動建立/沿用標籤。
    /// </summary>
    private static async Task<IResult> CreateOrUpsertNoteHandler(
        HttpContext http,
        ZonWikiDbContext db,
        ILogger<object> logger,
        AiCreateNoteRequest request,
        CancellationToken ct)
    {
        var userId = ExtractUserId(http);
        if (userId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<AiCreateNoteResultDto>.Fail("Invalid user identity", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var title = (request.Title ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return Results.Json(
                ApiResponse<AiCreateNoteResultDto>.Fail("Title is required", 400),
                statusCode: 400);
        }
        if (title.Length > 500)
        {
            return Results.Json(
                ApiResponse<AiCreateNoteResultDto>.Fail("Title too long (max 500)", 400),
                statusCode: 400);
        }

        var userKey = userId.ToString();
        var contentRaw = request.ContentRaw ?? string.Empty;

        try
        {
            // 1. 解析分類名稱路徑 → 巢狀分類（找不到就建立），取得最末層分類 Id 與實際路徑。
            var (leafCategoryId, usedPath) = await ResolveCategoryPathAsync(
                db, userId, userKey, request.CategoryPath, ct);

            // 2. upsert：若指定且最末層分類底下已有同標題筆記 → 更新它，否則新建。
            Note? note = null;
            if (request.Upsert && leafCategoryId is Guid leafForLookup)
            {
                note = await db.Note
                    .Where(n => n.Title == title && n.ValidFlag
                        && db.NoteCategory.Any(nc =>
                            nc.NoteId == n.Id && nc.CategoryId == leafForLookup && nc.ValidFlag))
                    .FirstOrDefaultAsync(ct);
            }

            var created = note is null;
            var contentHtml = NoteContentHelpers.RenderToHtml(contentRaw);
            var contentHash = NoteContentHelpers.ComputeContentHash(contentRaw);

            if (note is null)
            {
                // 產生唯一 slug（同標題自動加序號）。
                var baseSlug = NoteContentHelpers.GenerateSlug(title);
                if (string.IsNullOrEmpty(baseSlug))
                {
                    baseSlug = "note";
                }
                var slug = baseSlug;
                for (var i = 2;
                     await db.Note.AnyAsync(n => n.UserId == userId && n.Slug == slug && n.ValidFlag, ct);
                     i++)
                {
                    slug = $"{baseSlug}-{i}";
                }

                note = new Note
                {
                    UserId = userId,
                    Title = title,
                    Slug = slug,
                    ContentRaw = contentRaw,
                    ContentHtml = contentHtml,
                    ContentHash = contentHash,
                    Kind = "note",
                    IsDraft = false,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                };
                db.Note.Add(note);
                await db.SaveChangesAsync(ct);

                db.NoteRevision.Add(new NoteRevision
                {
                    UserId = userId,
                    NoteId = note.Id,
                    RevisionNo = 1,
                    ChangeKind = "create",
                    Title = note.Title,
                    ContentRaw = note.ContentRaw,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                });
            }
            else
            {
                // upsert 更新：覆寫內容並記一筆 update 版本。
                note.ContentRaw = contentRaw;
                note.ContentHtml = contentHtml;
                note.ContentHash = contentHash;
                note.UpdatedUser = userKey;

                var latestRevisionNo = await db.NoteRevision
                    .Where(r => r.NoteId == note.Id)
                    .OrderByDescending(r => r.RevisionNo)
                    .Select(r => r.RevisionNo)
                    .FirstOrDefaultAsync(ct);

                db.NoteRevision.Add(new NoteRevision
                {
                    UserId = userId,
                    NoteId = note.Id,
                    RevisionNo = latestRevisionNo + 1,
                    ChangeKind = "update",
                    Title = note.Title,
                    ContentRaw = note.ContentRaw,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                });

                // 重新解析 wiki 連結：先軟刪除舊連結。
                var oldLinks = await db.NoteLink
                    .Where(nl => nl.SourceNoteId == note.Id && nl.ValidFlag)
                    .ToListAsync(ct);
                foreach (var link in oldLinks)
                {
                    link.ValidFlag = false;
                }
            }

            // 3. 歸類（最末層分類；冪等附加）。
            if (leafCategoryId is Guid leafCategory)
            {
                await EnsureNoteCategoryAsync(db, userId, userKey, note.Id, leafCategory, ct);
            }

            // 4. 標籤（依名稱找不到就建立，冪等附加）。
            if (request.Tags is { Count: > 0 })
            {
                await AssignTagsByNameAsync(db, userId, userKey, note.Id, request.Tags, ct);
            }

            // 5. 解析 wiki 連結並建立 NoteLink。
            await ParseAndCreateWikiLinksAsync(db, userId, userKey, note.Id, contentRaw, ct);

            await db.SaveChangesAsync(ct);

            var result = new AiCreateNoteResultDto(
                note.Id,
                note.Title,
                note.Slug,
                leafCategoryId,
                usedPath,
                created);

            return Results.Ok(ApiResponse<AiCreateNoteResultDto>.Ok(result));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "AI create note failed (userId={UserId}, title={Title})", userId, title);
            return Results.StatusCode(500);
        }
    }

    /// <summary>
    /// 解析「分類名稱路徑」成巢狀分類（由上而下，找不到就建立），回傳最末層分類 Id 與實際使用的路徑。
    /// 比對鍵為「同一上層 + 同名 + 本人有效」，因此重複呼叫會沿用既有分類（冪等）。
    /// </summary>
    /// <param name="db">資料庫內容。</param>
    /// <param name="userId">使用者識別碼。</param>
    /// <param name="userKey">使用者識別字串（稽核欄位用）。</param>
    /// <param name="rawPath">分類名稱路徑（可空）。</param>
    /// <param name="ct">取消權杖。</param>
    /// <returns>（最末層分類 Id 或 null、實際使用的名稱路徑）。</returns>
    private static async Task<(Guid? LeafCategoryId, List<string> UsedPath)> ResolveCategoryPathAsync(
        ZonWikiDbContext db,
        Guid userId,
        string userKey,
        List<string>? rawPath,
        CancellationToken ct)
    {
        var usedPath = new List<string>();
        if (rawPath is null || rawPath.Count == 0)
        {
            return (null, usedPath);
        }

        Guid? parentId = null;
        var folderPath = string.Empty;

        foreach (var segmentRaw in rawPath)
        {
            var name = (segmentRaw ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(name))
            {
                continue;
            }

            folderPath = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";

            // 以「同上層 + 同名」找既有分類；明確區分 parentId 是否為 null，避免 EF 對 null 的等值語意陷阱。
            Category? existing = parentId is null
                ? await db.Category.FirstOrDefaultAsync(c => c.ParentId == null && c.Name == name, ct)
                : await db.Category.FirstOrDefaultAsync(c => c.ParentId == parentId && c.Name == name, ct);

            if (existing is null)
            {
                existing = new Category
                {
                    UserId = userId,
                    Name = name,
                    ParentId = parentId,
                    FolderPath = folderPath,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                };
                db.Category.Add(existing);
                await db.SaveChangesAsync(ct); // 先存才有 Id 當下一層的上層。
            }

            parentId = existing.Id;
            usedPath.Add(name);
        }

        return (parentId, usedPath);
    }

    /// <summary>
    /// 確保筆記與分類之間有一筆有效的 NoteCategory 關聯（冪等；復活軟刪除列以免違反唯一索引）。
    /// </summary>
    private static async Task EnsureNoteCategoryAsync(
        ZonWikiDbContext db,
        Guid userId,
        string userKey,
        Guid noteId,
        Guid categoryId,
        CancellationToken ct)
    {
        var existing = await db.NoteCategory
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                nc => nc.NoteId == noteId && nc.CategoryId == categoryId && nc.UserId == userId,
                ct);

        if (existing is null)
        {
            db.NoteCategory.Add(new NoteCategory
            {
                UserId = userId,
                NoteId = noteId,
                CategoryId = categoryId,
                CreatedUser = userKey,
                UpdatedUser = userKey,
            });
        }
        else if (!existing.ValidFlag)
        {
            existing.ValidFlag = true;
            existing.DeletedDateTime = null;
            existing.UpdatedUser = userKey;
        }
    }

    /// <summary>
    /// 依「標籤名稱」清單，找不到就建立標籤，並冪等附加到筆記（復活軟刪除關聯）。
    /// </summary>
    private static async Task AssignTagsByNameAsync(
        ZonWikiDbContext db,
        Guid userId,
        string userKey,
        Guid noteId,
        List<string> tagNames,
        CancellationToken ct)
    {
        foreach (var rawName in tagNames)
        {
            var name = (rawName ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(name))
            {
                continue;
            }

            var tag = await db.Tag.FirstOrDefaultAsync(t => t.Name == name, ct);
            if (tag is null)
            {
                tag = new Tag
                {
                    UserId = userId,
                    Name = name,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                };
                db.Tag.Add(tag);
                await db.SaveChangesAsync(ct); // 先存才有 Id。
            }

            var existingLink = await db.NoteTag
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(nt => nt.NoteId == noteId && nt.TagId == tag.Id && nt.UserId == userId, ct);

            if (existingLink is null)
            {
                db.NoteTag.Add(new NoteTag
                {
                    UserId = userId,
                    NoteId = noteId,
                    TagId = tag.Id,
                    CreatedUser = userKey,
                    UpdatedUser = userKey,
                });
            }
            else if (!existingLink.ValidFlag)
            {
                existingLink.ValidFlag = true;
                existingLink.DeletedDateTime = null;
                existingLink.UpdatedUser = userKey;
            }
        }
    }

    /// <summary>
    /// 解析內容中的 wiki 連結（[[X]]）並建立 NoteLink（與筆記寫入端點一致）。
    /// </summary>
    private static async Task ParseAndCreateWikiLinksAsync(
        ZonWikiDbContext db,
        Guid userId,
        string userKey,
        Guid sourceNoteId,
        string contentRaw,
        CancellationToken ct)
    {
        var matches = WikiLinkRegex.Matches(contentRaw);
        foreach (Match match in matches)
        {
            var anchorText = match.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(anchorText))
            {
                continue;
            }

            var targetSlug = NoteContentHelpers.GenerateSlug(anchorText);
            var targetNote = await db.Note.FirstOrDefaultAsync(
                n => n.UserId == userId && n.ValidFlag
                    && (n.Slug == targetSlug || n.Title == anchorText),
                ct);

            db.NoteLink.Add(new NoteLink
            {
                UserId = userId,
                SourceNoteId = sourceNoteId,
                TargetNoteId = targetNote?.Id,
                AnchorText = anchorText,
                CreatedUser = userKey,
                UpdatedUser = userKey,
            });
        }
    }

    /// <summary>
    /// 從 HttpContext 提取使用者 Id（只信任使用者宣告，支援 Cookie 與 API 權杖兩種驗證）。
    /// </summary>
    private static Guid ExtractUserId(HttpContext http)
    {
        var userIdClaim = http.User.FindFirst(AuthExtensions.UserIdClaimType)?.Value;
        return !string.IsNullOrEmpty(userIdClaim) && Guid.TryParse(userIdClaim, out var userId)
            ? userId
            : Guid.Empty;
    }
}
