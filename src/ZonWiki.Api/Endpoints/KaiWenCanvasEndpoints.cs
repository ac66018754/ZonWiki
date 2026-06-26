using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using ZonWiki.Api.Auth;
using ZonWiki.Api.Services;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布 REST API 端點（CRUD）。
/// 實作前端契約（kaiwen-api.ts）期望的所有路由、方法與欄位形狀。
/// </summary>
public static class KaiWenCanvasEndpoints
{
    /// <summary>
    /// 註冊開問啦畫布相關端點。
    /// </summary>
    public static void MapKaiWenCanvasEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/canvas");

        // 畫布 CRUD
        group.MapGet("/models", ListModels)
            .WithName("ListModels")
            .WithOpenApi()
            .Produces<ApiResponse<List<AiModelDto>>>(StatusCodes.Status200OK);

        group.MapGet("/canvases", ListCanvases)
            .WithName("ListCanvases")
            .WithOpenApi()
            .Produces<ApiResponse<List<CanvasDto>>>(StatusCodes.Status200OK);

        group.MapPost("/canvases", CreateCanvas)
            .WithName("CreateCanvas")
            .WithOpenApi()
            .Produces<ApiResponse<CanvasDto>>(StatusCodes.Status201Created);

        group.MapGet("/canvases/{canvasId}", GetCanvasGraph)
            .WithName("GetCanvasGraph")
            .WithOpenApi()
            .Produces<ApiResponse<CanvasGraphDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPut("/canvases/{canvasId}", RenameCanvas)
            .WithName("RenameCanvas")
            .WithOpenApi()
            .Produces<ApiResponse<CanvasDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/canvases/{canvasId}", DeleteCanvas)
            .WithName("DeleteCanvas")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        // 節點 CRUD
        group.MapPost("/canvases/{canvasId}/nodes", CreateNode)
            .WithName("CreateNode")
            .WithOpenApi()
            .Produces<ApiResponse<NodeDto>>(StatusCodes.Status201Created)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPatch("/nodes/{nodeId}", UpdateNodeLayout)
            .WithName("UpdateNodeLayout")
            .WithOpenApi()
            .Produces<ApiResponse<NodeDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPut("/nodes/{nodeId}/content", UpdateNodeContent)
            .WithName("UpdateNodeContent")
            .WithOpenApi()
            .Produces<ApiResponse<NodeDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPut("/nodes/{nodeId}/model", SetNodeModel)
            .WithName("SetNodeModel")
            .WithOpenApi()
            .Produces<ApiResponse<NodeDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/nodes/{nodeId}", DeleteNode)
            .WithName("DeleteNode")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapGet("/nodes/{nodeId}/revisions", ListNodeRevisions)
            .WithName("ListNodeRevisions")
            .WithOpenApi()
            .Produces<ApiResponse<List<NodeRevisionDto>>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        // 邊 CRUD
        group.MapPost("/canvases/{canvasId}/edges", CreateEdge)
            .WithName("CreateEdge")
            .WithOpenApi()
            .Produces<ApiResponse<EdgeDto>>(StatusCodes.Status201Created)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPatch("/edges/{edgeId}", ReconnectEdge)
            .WithName("ReconnectEdge")
            .WithOpenApi()
            .Produces<ApiResponse<EdgeDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/edges/{edgeId}", DeleteEdge)
            .WithName("DeleteEdge")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        // 行內連結 CRUD
        group.MapPost("/canvases/{canvasId}/inline-links", CreateInlineLink)
            .WithName("CreateInlineLink")
            .WithOpenApi()
            .Produces<ApiResponse<InlineLinkDto>>(StatusCodes.Status201Created)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPatch("/inline-links/{linkId}", UpdateInlineLinkTarget)
            .WithName("UpdateInlineLinkTarget")
            .WithOpenApi()
            .Produces<ApiResponse<InlineLinkDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/inline-links/{linkId}", DeleteInlineLink)
            .WithName("DeleteInlineLink")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        // 重點 CRUD
        group.MapPost("/nodes/{nodeId}/highlights", CreateHighlight)
            .WithName("CreateHighlight")
            .WithOpenApi()
            .Produces<ApiResponse<HighlightDto>>(StatusCodes.Status201Created)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapPatch("/highlights/{highlightId}", UpdateHighlight)
            .WithName("UpdateHighlight")
            .WithOpenApi()
            .Produces<ApiResponse<HighlightDto>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        group.MapDelete("/highlights/{highlightId}", DeleteHighlight)
            .WithName("DeleteHighlight")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status204NoContent)
            .Produces<ApiResponse<object>>(StatusCodes.Status404NotFound);

        // AI 提問端點
        group.MapPost("/canvases/{canvasId}/ask", AskNode)
            .WithName("AskNode")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized);

        group.MapPost("/canvases/{canvasId}/ask-followup", AskFollowup)
            .WithName("AskFollowup")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized);

        group.MapPost("/canvases/{canvasId}/ask-inline-link", AskInlineLink)
            .WithName("AskInlineLink")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized);

        group.MapPost("/canvases/{canvasId}/cancel", CancelAsk)
            .WithName("CancelAsk")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized);

        // AI 模型設定端點
        group.MapGet("/models-config", GetModelsConfig)
            .WithName("GetModelsConfig")
            .WithOpenApi()
            .Produces<ApiResponse<List<AiModelConfigDto>>>(StatusCodes.Status200OK);

        group.MapPut("/models-config", SaveModelsConfig)
            .WithName("SaveModelsConfig")
            .WithOpenApi()
            .Produces<ApiResponse<List<AiModelConfigDto>>>(StatusCodes.Status200OK)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest);

        group.MapGet("/health", GetHealth)
            .WithName("GetHealth")
            .WithOpenApi()
            .Produces<ApiResponse<HealthStateDto>>(StatusCodes.Status200OK);

        group.MapPut("/health/enabled", SetHealthEnabled)
            .WithName("SetHealthEnabled")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status200OK);

        group.MapPost("/health/check", CheckHealth)
            .WithName("CheckHealth")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status200OK);

        // ── 垃圾桶（還原誤刪的畫布 / 節點）──
        group.MapGet("/trash", GetTrash)
            .WithName("GetTrash").WithOpenApi();
        group.MapPost("/trash/canvas/{canvasId}/restore", RestoreCanvas)
            .WithName("RestoreCanvas").WithOpenApi();
        group.MapPost("/trash/node/{nodeId}/restore", RestoreNode)
            .WithName("RestoreNode").WithOpenApi();
        group.MapDelete("/trash/canvas/{canvasId}", PurgeCanvas)
            .WithName("PurgeCanvas").WithOpenApi();
        group.MapDelete("/trash/node/{nodeId}", PurgeNode)
            .WithName("PurgeNode").WithOpenApi();
        group.MapDelete("/trash", EmptyTrash)
            .WithName("EmptyTrash").WithOpenApi();
    }

    /// <summary>
    /// 取得垃圾桶清單：該使用者已軟刪除的畫布，以及「單獨刪除、其畫布仍存在」的節點。
    /// </summary>
    private static async Task<IResult> GetTrash(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<TrashListingDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 已刪除的畫布（須 IgnoreQueryFilters 才看得到 ValidFlag=false 的資料）
        var deletedCanvases = await db.Canvas
            .IgnoreQueryFilters()
            .Where(c => c.UserId == currentUser.UserId && !c.ValidFlag && c.PurgedDateTime == null)
            .OrderByDescending(c => c.UpdatedDateTime)
            .Select(c => new TrashCanvasDto(
                c.Id.ToString(),
                c.Title,
                (c.DeletedDateTime ?? c.UpdatedDateTime).ToString("o"),
                c.Nodes.Count))
            .ToListAsync(ct);

        // 已刪除的節點：節點本身被刪、但其畫布仍存在（避免與「整張畫布刪除」重複列出）
        var rawNodes = await db.Node
            .IgnoreQueryFilters()
            .Where(n => !n.ValidFlag && n.PurgedDateTime == null)
            .Join(
                db.Canvas.IgnoreQueryFilters()
                    .Where(c => c.UserId == currentUser.UserId && c.ValidFlag),
                n => n.CanvasId,
                c => c.Id,
                (n, c) => new
                {
                    n.Id,
                    n.CanvasId,
                    CanvasTitle = c.Title,
                    n.Content,
                    n.CreatedDateTime,
                    n.UpdatedDateTime,
                    n.DeletedDateTime,
                })
            .OrderByDescending(x => x.UpdatedDateTime)
            .ToListAsync(ct);

        var deletedNodes = rawNodes
            .Select(x => new TrashNodeDto(
                x.Id.ToString(),
                x.CanvasId.ToString(),
                x.CanvasTitle,
                FirstLineSnippet(x.Content),
                FirstLineSnippet(x.Content),
                x.CreatedDateTime.ToString("o"),
                (x.DeletedDateTime ?? x.UpdatedDateTime).ToString("o")))
            .ToList();

        return CanvasJsonHelper.JsonOk(
            ApiResponse<TrashListingDto>.Ok(new TrashListingDto(deletedCanvases, deletedNodes)));
    }

    /// <summary>
    /// 驗證一組節點 Id 是否「全部」屬於指定畫布（且有效）。
    /// 用於建立 / 重接「邊」與「行內連結」、以及指定父節點時，
    /// 確保 source / target / parent 節點都確實落在同一張（呼叫端已驗證擁有的）畫布內，
    /// 避免產生指向他人 / 別張畫布節點的跨界參考——這既是資料完整性，也是防越權的縱深防禦
    /// （與 SearchEndpoints / AncestryService 的同帳號、同畫布限制相呼應）。
    /// </summary>
    /// <param name="db">資料庫 DbContext。</param>
    /// <param name="canvasId">節點必須隸屬的畫布識別碼（呼叫端須先確認此畫布屬於目前使用者）。</param>
    /// <param name="ct">取消令牌。</param>
    /// <param name="nodeIds">要驗證的節點識別碼（可重複；空集合視為通過）。</param>
    /// <returns>所有不重複的節點 Id 都屬於該畫布時回 true，否則 false。</returns>
    private static async Task<bool> NodesBelongToCanvasAsync(
        ZonWikiDbContext db,
        Guid canvasId,
        CancellationToken ct,
        params Guid[] nodeIds)
    {
        var distinctIds = nodeIds.Distinct().ToList();
        if (distinctIds.Count == 0)
        {
            return true;
        }

        // 以「畫布 Id」為擁有權邊界（畫布本身已由呼叫端驗證屬於目前使用者）。
        var matchedCount = await db.Node
            .Where(n => n.CanvasId == canvasId && n.ValidFlag && distinctIds.Contains(n.Id))
            .Select(n => n.Id)
            .Distinct()
            .CountAsync(ct);

        return matchedCount == distinctIds.Count;
    }

    /// <summary>
    /// 取內容首行作為片段（去除開頭的 Markdown 標記、限長 80），空白則回「(空白節點)」。
    /// </summary>
    private static string FirstLineSnippet(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return "(空白節點)";
        }

        var line = content
            .Split('\n')
            .Select(l => l.Trim())
            .FirstOrDefault(l => l.Length > 0) ?? string.Empty;

        line = line.TrimStart('#', ' ', '>', '-', '*').Trim();
        if (line.Length > 80)
        {
            line = string.Concat(line.AsSpan(0, 80), "…");
        }

        return line.Length > 0 ? line : "(空白節點)";
    }

    /// <summary>
    /// 還原已刪除的畫布（ValidFlag=true、清空刪除時間）。
    /// </summary>
    private static async Task<IResult> RestoreCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        canvas.ValidFlag = true;
        canvas.DeletedDateTime = null;
        canvas.PurgedDateTime = null; // 還原時一併清除清除標記
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 還原已刪除的節點（須屬於該使用者的畫布）。
    /// </summary>
    private static async Task<IResult> RestoreNode(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // Node 無 UserId，藉由其畫布的 UserId 做 per-user 授權
        var node = await db.Node
            .IgnoreQueryFilters()
            .Where(n => n.Id == nodeGuid)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .FirstOrDefaultAsync(ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        node.ValidFlag = true;
        node.DeletedDateTime = null;
        node.PurgedDateTime = null; // 還原時一併清除清除標記
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 永久刪除垃圾桶中的畫布。
    /// 決策（「絕不硬刪除、一切可復原」，見 CLAUDE.md §3）：不從 DB 移除，改標記 PurgedDateTime，
    /// ValidFlag 維持 false，垃圾桶清單排除已 purged 者；列仍留在 DB（可由 DB 將 ValidFlag 壓回復活）。
    /// </summary>
    private static async Task<IResult> PurgeCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟性永久刪除（絕不硬刪）：標記 PurgedDateTime，列留 DB、可復原。
        canvas.PurgedDateTime = DateTime.UtcNow;
        canvas.UpdatedDateTime = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 永久刪除垃圾桶中的節點（軟性標記，須屬於該使用者的畫布；絕不硬刪、可復原）。
    /// </summary>
    private static async Task<IResult> PurgeNode(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .IgnoreQueryFilters()
            .Where(n => n.Id == nodeGuid)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .FirstOrDefaultAsync(ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟性永久刪除（絕不硬刪）：標記 PurgedDateTime，列留 DB、可復原。
        node.PurgedDateTime = DateTime.UtcNow;
        node.UpdatedDateTime = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 清空垃圾桶：把該使用者所有「在垃圾桶中（軟刪除、尚未 purged）」的畫布與節點標記為 purged
    /// （軟性，絕不硬刪、可復原）。
    /// </summary>
    private static async Task<IResult> EmptyTrash(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var purgedAt = DateTime.UtcNow;

        var canvases = await db.Canvas
            .IgnoreQueryFilters()
            .Where(c => c.UserId == currentUser.UserId && !c.ValidFlag && c.PurgedDateTime == null)
            .ToListAsync(ct);

        var nodes = await db.Node
            .IgnoreQueryFilters()
            .Where(n => !n.ValidFlag && n.PurgedDateTime == null)
            .Join(
                db.Canvas.IgnoreQueryFilters().Where(c => c.UserId == currentUser.UserId),
                n => n.CanvasId, c => c.Id, (n, c) => n)
            .ToListAsync(ct);

        // 軟性清空（絕不硬刪）：逐筆標記 PurgedDateTime，列留 DB、可復原。
        foreach (var node in nodes)
        {
            node.PurgedDateTime = purgedAt;
            node.UpdatedDateTime = purgedAt;
        }
        foreach (var canvas in canvases)
        {
            canvas.PurgedDateTime = purgedAt;
            canvas.UpdatedDateTime = purgedAt;
        }
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 列出節點下拉可用的 AI 模型：本使用者已啟用的模型 ∪ 全站共用預設（後者標「（預設）」）。
    /// 共用列（<see cref="ZonWiki.Infrastructure.Ai.AiProviderFactory.SharedModelUserId"/>，…a1）會被全域查詢過濾器
    /// 擋掉，故用 IgnoreQueryFilters + 明確 UserId（與 AiProviderFactory.ResolveAsync 同理）。
    /// AiModelDto 不含金鑰欄位 → 共用列金鑰永不外洩；設定頁走 GetModelsConfig（只撈本人）→ 共用列不出現在設定頁、不可被誤刪。
    /// </summary>
    private static async Task<IResult> ListModels(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var sharedUserId = ZonWiki.Infrastructure.Ai.AiProviderFactory.SharedModelUserId;
        var rows = await db.AiModel
            .IgnoreQueryFilters()
            .Where(m => m.ValidFlag && m.Enabled
                && (m.UserId == currentUser.UserId || m.UserId == sharedUserId))
            .ToListAsync(ct);

        var models = rows
            .OrderByDescending(m => m.UserId == sharedUserId)   // 共用預設排最前
            .ThenBy(m => m.Label)
            .Select(m => new AiModelDto(
                m.Key,
                m.UserId == sharedUserId ? $"{m.Label}（預設）" : m.Label,
                m.Provider,
                m.Kind,
                m.ModelId,
                m.Notes))
            .ToList();

        return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelDto>>.Ok(models));
    }

    /// <summary>
    /// 列出目前使用者的所有畫布。
    /// </summary>
    private static async Task<IResult> ListCanvases(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<CanvasDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        var canvases = await db.Canvas
            .Where(c => c.UserId == currentUser.UserId)
            .OrderByDescending(c => c.UpdatedDateTime)
            .Select(c => new CanvasDto(
                c.Id.ToString(),
                c.Title,
                c.Description,
                c.StateJson))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<CanvasDto>>.Ok(canvases));
    }

    /// <summary>
    /// 建立新的畫布。
    /// </summary>
    private static async Task<IResult> CreateCanvas(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateCanvasRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 驗證標題
        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasDto>.Fail("Title is required"),
                StatusCodes.Status400BadRequest);
        }

        var canvas = new Canvas
        {
            Id = Guid.NewGuid(),
            UserId = currentUser.UserId,
            Title = req.Title,
            Description = string.Empty,
            StateJson = "{}",
        };

        db.Canvas.Add(canvas);
        await db.SaveChangesAsync(ct);

        var dto = new CanvasDto(
            canvas.Id.ToString(),
            canvas.Title,
            canvas.Description,
            canvas.StateJson);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 取得畫布的完整圖譜（含所有節點、邊、行內連結、重點）。
    /// </summary>
    private static async Task<IResult> GetCanvasGraph(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Invalid canvas ID"),
                StatusCodes.Status400BadRequest);
        }

        // 驗證該畫布屬於目前使用者
        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<CanvasGraphDto>.Fail("Canvas not found", 404),
                StatusCodes.Status404NotFound);
        }

        // 逐一查詢（同一個 DbContext 不可並行多查詢，否則會丟「A second operation was started…」例外）
        var nodes = await db.Node
            .Where(n => n.CanvasId == canvasGuid)
            .Select(n => new NodeDto(
                n.Id.ToString(),
                n.CanvasId.ToString(),
                n.Title,
                n.Content,
                n.ParentId.HasValue ? n.ParentId.Value.ToString() : null,
                n.X,
                n.Y,
                n.Width,
                n.Height,
                n.ZIndex,
                n.Color,
                n.Model,
                n.Origin,
                n.AiSessionId.HasValue ? n.AiSessionId.Value.ToString() : null,
                n.CreatedDateTime.ToString("O"),
                n.UpdatedDateTime.ToString("O")))
            .ToListAsync(ct);

        var edges = await db.Edge
            .Where(e => e.CanvasId == canvasGuid)
            .Select(e => new EdgeDto(
                e.Id.ToString(),
                e.CanvasId.ToString(),
                e.SourceNodeId.ToString(),
                e.TargetNodeId.ToString(),
                e.Kind,
                e.Label,
                e.SourceHandle,
                e.TargetHandle,
                e.CreatedDateTime.ToString("O")))
            .ToListAsync(ct);

        var inlineLinks = await db.InlineLink
            .Where(il => il.CanvasId == canvasGuid)
            .Select(il => new InlineLinkDto(
                il.Id.ToString(),
                il.CanvasId.ToString(),
                il.SourceNodeId.ToString(),
                il.AnchorText,
                il.AnchorStart,
                il.AnchorEnd,
                il.AnchorPrefix,
                il.AnchorSuffix,
                il.TargetNodeId.ToString(),
                il.Detached))
            .ToListAsync(ct);

        var highlights = await db.Highlight
            .Where(h => db.Node.Where(n => n.CanvasId == canvasGuid).Select(n => n.Id).Contains(h.NodeId))
            .Select(h => new HighlightDto(
                h.Id.ToString(),
                h.NodeId.ToString(),
                h.AnchorText,
                h.Start,
                h.End,
                h.AnchorPrefix,
                h.AnchorSuffix,
                h.Color,
                h.Detached))
            .ToListAsync(ct);

        var canvasDto = new CanvasDto(
            canvas.Id.ToString(),
            canvas.Title,
            canvas.Description,
            canvas.StateJson);

        var graphDto = new CanvasGraphDto(
            canvasDto,
            nodes,
            edges,
            inlineLinks,
            highlights);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasGraphDto>.Ok(graphDto));
    }

    /// <summary>
    /// 重新命名畫布。
    /// </summary>
    private static async Task<IResult> RenameCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        RenameCanvasRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<CanvasDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (string.IsNullOrWhiteSpace(req.Title))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<CanvasDto>.Fail("Title is required"), StatusCodes.Status400BadRequest);
        }

        canvas.Title = req.Title;
        await db.SaveChangesAsync(ct);

        var dto = new CanvasDto(
            canvas.Id.ToString(),
            canvas.Title,
            canvas.Description,
            canvas.StateJson);

        return CanvasJsonHelper.JsonOk(ApiResponse<CanvasDto>.Ok(dto));
    }

    /// <summary>
    /// 刪除畫布（軟刪除 ValidFlag）。
    /// </summary>
    private static async Task<IResult> DeleteCanvas(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 軟刪除
        canvas.ValidFlag = false;
        canvas.DeletedDateTime = DateTime.UtcNow; // 進統一垃圾桶需設刪除時間
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 在指定畫布上建立新節點。
    /// </summary>
    private static async Task<IResult> CreateNode(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateNodeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        // 解析並驗證父節點：若有指定，必須屬於同一張（已驗證擁有的）畫布。
        // 否則使用者可把自己的節點掛到他人畫布的節點下，使後續祖先脈絡追溯越界（跨帳號外洩的前置條件）。
        Guid? parentNodeId = null;
        if (!string.IsNullOrWhiteSpace(req.ParentId))
        {
            if (!Guid.TryParse(req.ParentId, out var parentGuid))
            {
                return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid parent node ID"), StatusCodes.Status400BadRequest);
            }

            if (!await NodesBelongToCanvasAsync(db, canvasGuid, ct, parentGuid))
            {
                return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Parent node not found in canvas", 404), StatusCodes.Status404NotFound);
            }

            parentNodeId = parentGuid;
        }

        var node = new Node
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            Title = req.Title ?? string.Empty,
            Content = req.Content ?? string.Empty,
            ParentId = parentNodeId,
            X = req.X,
            Y = req.Y,
            Width = null,
            Height = null,
            ZIndex = 0,
            Color = req.Color,
            Model = null,
            Origin = "user",
            AiSessionId = null,
            AiSessionConsumed = false,
        };

        db.Node.Add(node);
        await db.SaveChangesAsync(ct);

        var dto = new NodeDto(
            node.Id.ToString(),
            node.CanvasId.ToString(),
            node.Title,
            node.Content,
            node.ParentId.HasValue ? node.ParentId.Value.ToString() : null,
            node.X,
            node.Y,
            node.Width,
            node.Height,
            node.ZIndex,
            node.Color,
            node.Model,
            node.Origin,
            node.AiSessionId.HasValue ? node.AiSessionId.Value.ToString() : null,
            node.CreatedDateTime.ToString("O"),
            node.UpdatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新節點的佈局屬性（位置、大小、顏色、Z-index 等）。
    /// 請求體為動態 JSON，可包含任何欄位（X, Y, Width, Height, ZIndex, Color, Title 等）。
    /// </summary>
    private static async Task<IResult> UpdateNodeLayout(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        IHttpContextAccessor httpContextAccessor,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 讀取請求體為 JSON
        var httpContext = httpContextAccessor.HttpContext;
        if (httpContext is null)
        {
            return Results.StatusCode(StatusCodes.Status500InternalServerError);
        }

        using var reader = new StreamReader(httpContext.Request.Body);
        var bodyText = await reader.ReadToEndAsync(ct);

        if (!string.IsNullOrWhiteSpace(bodyText))
        {
            try
            {
                using var doc = JsonDocument.Parse(bodyText);
                var root = doc.RootElement;

                // 動態更新欄位
                if (root.TryGetProperty("X", out var xProp) && xProp.TryGetDouble(out var x))
                    node.X = x;

                if (root.TryGetProperty("Y", out var yProp) && yProp.TryGetDouble(out var y))
                    node.Y = y;

                if (root.TryGetProperty("Width", out var wProp) && wProp.TryGetDouble(out var w))
                    node.Width = w;

                if (root.TryGetProperty("Height", out var hProp) && hProp.TryGetDouble(out var h))
                    node.Height = h;

                if (root.TryGetProperty("ZIndex", out var zProp) && zProp.TryGetInt32(out var z))
                    node.ZIndex = z;

                if (root.TryGetProperty("Color", out var colorProp) && colorProp.ValueKind != System.Text.Json.JsonValueKind.Null)
                    node.Color = colorProp.GetString();

                if (root.TryGetProperty("Title", out var titleProp) && titleProp.ValueKind != System.Text.Json.JsonValueKind.Null)
                    node.Title = titleProp.GetString() ?? string.Empty;
            }
            catch
            {
                // JSON 解析失敗，忽略
            }
        }

        await db.SaveChangesAsync(ct);

        var dto = new NodeDto(
            node.Id.ToString(),
            node.CanvasId.ToString(),
            node.Title,
            node.Content,
            node.ParentId.HasValue ? node.ParentId.Value.ToString() : null,
            node.X,
            node.Y,
            node.Width,
            node.Height,
            node.ZIndex,
            node.Color,
            node.Model,
            node.Origin,
            node.AiSessionId.HasValue ? node.AiSessionId.Value.ToString() : null,
            node.CreatedDateTime.ToString("O"),
            node.UpdatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 更新節點的內容（Markdown）。
    /// </summary>
    private static async Task<IResult> UpdateNodeContent(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateNodeContentRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        // 記錄修訂
        var revision = new NodeRevision
        {
            Id = Guid.NewGuid(),
            NodeId = node.Id,
            Content = req.Content,
            Source = "edited",
        };
        db.NodeRevision.Add(revision);

        // 更新節點內容
        node.Content = req.Content ?? string.Empty;
        await db.SaveChangesAsync(ct);

        var dto = new NodeDto(
            node.Id.ToString(),
            node.CanvasId.ToString(),
            node.Title,
            node.Content,
            node.ParentId.HasValue ? node.ParentId.Value.ToString() : null,
            node.X,
            node.Y,
            node.Width,
            node.Height,
            node.ZIndex,
            node.Color,
            node.Model,
            node.Origin,
            node.AiSessionId.HasValue ? node.AiSessionId.Value.ToString() : null,
            node.CreatedDateTime.ToString("O"),
            node.UpdatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 設定節點的偏好 AI 模型。
    /// </summary>
    private static async Task<IResult> SetNodeModel(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SetNodeModelRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<NodeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<NodeDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        node.Model = req.Model;
        await db.SaveChangesAsync(ct);

        var dto = new NodeDto(
            node.Id.ToString(),
            node.CanvasId.ToString(),
            node.Title,
            node.Content,
            node.ParentId.HasValue ? node.ParentId.Value.ToString() : null,
            node.X,
            node.Y,
            node.Width,
            node.Height,
            node.ZIndex,
            node.Color,
            node.Model,
            node.Origin,
            node.AiSessionId.HasValue ? node.AiSessionId.Value.ToString() : null,
            node.CreatedDateTime.ToString("O"),
            node.UpdatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<NodeDto>.Ok(dto));
    }

    /// <summary>
    /// 刪除節點（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteNode(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        node.ValidFlag = false;
        node.DeletedDateTime = DateTime.UtcNow; // 進統一垃圾桶需設刪除時間

        // 一併軟刪除以此節點為來源或目標的連線（Edge），避免畫布上殘留指向已刪除節點的懸空連線。
        var incidentEdges = await db.Edge
            .Where(e => e.CanvasId == node.CanvasId
                && (e.SourceNodeId == nodeGuid || e.TargetNodeId == nodeGuid))
            .ToListAsync(ct);
        foreach (var edge in incidentEdges)
        {
            edge.ValidFlag = false;
            edge.DeletedDateTime = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 列出節點的所有修訂版本。
    /// </summary>
    private static async Task<IResult> ListNodeRevisions(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<List<NodeRevisionDto>>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<List<NodeRevisionDto>>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證節點屬於使用者
        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<List<NodeRevisionDto>>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        var revisions = await db.NodeRevision
            .Where(r => r.NodeId == nodeGuid)
            .OrderByDescending(r => r.CreatedDateTime)
            .Select(r => new NodeRevisionDto(
                r.Id.ToString(),
                r.NodeId.ToString(),
                r.Content,
                r.Source,
                r.CreatedDateTime.ToString("O")))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<NodeRevisionDto>>.Ok(revisions));
    }

    /// <summary>
    /// 在指定畫布上建立邊（連線）。
    /// </summary>
    private static async Task<IResult> CreateEdge(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateEdgeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<EdgeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：source/target 節點都必須屬於這張（已驗證擁有的）畫布，避免建立指向他人/別張畫布節點的邊。
        if (!await NodesBelongToCanvasAsync(db, canvasGuid, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        var edge = new Edge
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            SourceNodeId = sourceNodeGuid,
            TargetNodeId = targetNodeGuid,
            Kind = "default",
            Label = string.Empty,
            SourceHandle = req.SourceHandle,
            TargetHandle = req.TargetHandle,
            DataJson = "{}",
        };

        db.Edge.Add(edge);
        await db.SaveChangesAsync(ct);

        var dto = new EdgeDto(
            edge.Id.ToString(),
            edge.CanvasId.ToString(),
            edge.SourceNodeId.ToString(),
            edge.TargetNodeId.ToString(),
            edge.Kind,
            edge.Label,
            edge.SourceHandle,
            edge.TargetHandle,
            edge.CreatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<EdgeDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 重新連接邊到不同的節點。
    /// </summary>
    private static async Task<IResult> ReconnectEdge(
        string edgeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        ReconnectEdgeRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<EdgeDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(edgeId, out var edgeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid edge ID"), StatusCodes.Status400BadRequest);
        }

        var edge = await db.Edge
            .Where(e => e.Canvas != null && e.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(e => e.Id == edgeGuid, ct);

        if (edge is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Edge not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：重接後的 source/target 節點都必須屬於這條邊所在（已驗證擁有的）畫布。
        if (!await NodesBelongToCanvasAsync(db, edge.CanvasId, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<EdgeDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        edge.SourceNodeId = sourceNodeGuid;
        edge.TargetNodeId = targetNodeGuid;
        edge.SourceHandle = req.SourceHandle;
        edge.TargetHandle = req.TargetHandle;

        await db.SaveChangesAsync(ct);

        var dto = new EdgeDto(
            edge.Id.ToString(),
            edge.CanvasId.ToString(),
            edge.SourceNodeId.ToString(),
            edge.TargetNodeId.ToString(),
            edge.Kind,
            edge.Label,
            edge.SourceHandle,
            edge.TargetHandle,
            edge.CreatedDateTime.ToString("O"));

        return CanvasJsonHelper.JsonOk(ApiResponse<EdgeDto>.Ok(dto));
    }

    /// <summary>
    /// 刪除邊（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteEdge(
        string edgeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(edgeId, out var edgeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid edge ID"), StatusCodes.Status400BadRequest);
        }

        var edge = await db.Edge
            .Where(e => e.Canvas != null && e.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(e => e.Id == edgeGuid, ct);

        if (edge is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Edge not found", 404), StatusCodes.Status404NotFound);
        }

        edge.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 建立行內連結（在某節點的文字上建立到另一節點的連結）。
    /// </summary>
    private static async Task<IResult> CreateInlineLink(
        string canvasId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateInlineLinkRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<InlineLinkDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(canvasId, out var canvasGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid canvas ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證畫布存在且屬於使用者
        var canvas = await db.Canvas
            .FirstOrDefaultAsync(c => c.Id == canvasGuid && c.UserId == currentUser.UserId, ct);

        if (canvas is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Canvas not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.SourceNodeId, out var sourceNodeGuid) || !Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid node IDs"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：行內連結的 source/target 節點都必須屬於這張（已驗證擁有的）畫布。
        if (!await NodesBelongToCanvasAsync(db, canvasGuid, ct, sourceNodeGuid, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        var inlineLink = new InlineLink
        {
            Id = Guid.NewGuid(),
            CanvasId = canvasGuid,
            SourceNodeId = sourceNodeGuid,
            AnchorText = req.AnchorText,
            AnchorStart = req.AnchorStart,
            AnchorEnd = req.AnchorEnd,
            AnchorPrefix = req.AnchorPrefix,
            AnchorSuffix = req.AnchorSuffix,
            TargetNodeId = targetNodeGuid,
            Detached = false,
        };

        db.InlineLink.Add(inlineLink);
        await db.SaveChangesAsync(ct);

        var dto = new InlineLinkDto(
            inlineLink.Id.ToString(),
            inlineLink.CanvasId.ToString(),
            inlineLink.SourceNodeId.ToString(),
            inlineLink.AnchorText,
            inlineLink.AnchorStart,
            inlineLink.AnchorEnd,
            inlineLink.AnchorPrefix,
            inlineLink.AnchorSuffix,
            inlineLink.TargetNodeId.ToString(),
            inlineLink.Detached);

        return CanvasJsonHelper.JsonOk(ApiResponse<InlineLinkDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新行內連結的目標節點。
    /// </summary>
    private static async Task<IResult> UpdateInlineLinkTarget(
        string linkId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateInlineLinkTargetRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<InlineLinkDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(linkId, out var linkGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid link ID"), StatusCodes.Status400BadRequest);
        }

        var inlineLink = await db.InlineLink
            .Where(il => il.Canvas != null && il.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(il => il.Id == linkGuid, ct);

        if (inlineLink is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Inline link not found", 404), StatusCodes.Status404NotFound);
        }

        if (!Guid.TryParse(req.TargetNodeId, out var targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Invalid target node ID"), StatusCodes.Status400BadRequest);
        }

        // 縱深防禦：新的目標節點必須屬於這條行內連結所在（已驗證擁有的）畫布。
        if (!await NodesBelongToCanvasAsync(db, inlineLink.CanvasId, ct, targetNodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<InlineLinkDto>.Fail("Node not found in canvas", 404), StatusCodes.Status404NotFound);
        }

        inlineLink.TargetNodeId = targetNodeGuid;
        await db.SaveChangesAsync(ct);

        var dto = new InlineLinkDto(
            inlineLink.Id.ToString(),
            inlineLink.CanvasId.ToString(),
            inlineLink.SourceNodeId.ToString(),
            inlineLink.AnchorText,
            inlineLink.AnchorStart,
            inlineLink.AnchorEnd,
            inlineLink.AnchorPrefix,
            inlineLink.AnchorSuffix,
            inlineLink.TargetNodeId.ToString(),
            inlineLink.Detached);

        return CanvasJsonHelper.JsonOk(ApiResponse<InlineLinkDto>.Ok(dto));
    }

    /// <summary>
    /// 刪除行內連結（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteInlineLink(
        string linkId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(linkId, out var linkGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid link ID"), StatusCodes.Status400BadRequest);
        }

        var inlineLink = await db.InlineLink
            .Where(il => il.Canvas != null && il.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(il => il.Id == linkGuid, ct);

        if (inlineLink is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Inline link not found", 404), StatusCodes.Status404NotFound);
        }

        inlineLink.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 在指定節點上建立重點標記（畫重點）。
    /// </summary>
    private static async Task<IResult> CreateHighlight(
        string nodeId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CreateHighlightRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return Results.Json(
                ApiResponse<HighlightDto>.Fail("Authentication required", 401),
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(nodeId, out var nodeGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Invalid node ID"), StatusCodes.Status400BadRequest);
        }

        // 驗證節點屬於使用者
        var node = await db.Node
            .Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId)
            .FirstOrDefaultAsync(n => n.Id == nodeGuid, ct);

        if (node is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Node not found", 404), StatusCodes.Status404NotFound);
        }

        var highlight = new Highlight
        {
            Id = Guid.NewGuid(),
            NodeId = nodeGuid,
            AnchorText = req.AnchorText,
            Start = req.Start,
            End = req.End,
            AnchorPrefix = req.AnchorPrefix,
            AnchorSuffix = req.AnchorSuffix,
            Color = req.Color,
            Detached = false,
        };

        db.Highlight.Add(highlight);
        await db.SaveChangesAsync(ct);

        var dto = new HighlightDto(
            highlight.Id.ToString(),
            highlight.NodeId.ToString(),
            highlight.AnchorText,
            highlight.Start,
            highlight.End,
            highlight.AnchorPrefix,
            highlight.AnchorSuffix,
            highlight.Color,
            highlight.Detached);

        return CanvasJsonHelper.JsonOk(ApiResponse<HighlightDto>.Ok(dto), StatusCodes.Status201Created);
    }

    /// <summary>
    /// 更新重點顏色（供「畫重點後不滿意，直接在工具面板改色」即時調整）。
    /// </summary>
    private static async Task<IResult> UpdateHighlight(
        string highlightId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        UpdateHighlightRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<HighlightDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(highlightId, out var highlightGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Invalid highlight ID"), StatusCodes.Status400BadRequest);
        }

        if (string.IsNullOrWhiteSpace(req.Color))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Color is required"), StatusCodes.Status400BadRequest);
        }

        // 經節點所屬畫布驗證擁有者（與 DeleteHighlight 相同隔離方式）。
        var highlight = await db.Highlight
            .Where(h => db.Node.Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId).Select(n => n.Id).Contains(h.NodeId))
            .FirstOrDefaultAsync(h => h.Id == highlightGuid, ct);

        if (highlight is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<HighlightDto>.Fail("Highlight not found", 404), StatusCodes.Status404NotFound);
        }

        highlight.Color = req.Color;
        await db.SaveChangesAsync(ct);

        var dto = new HighlightDto(
            highlight.Id.ToString(),
            highlight.NodeId.ToString(),
            highlight.AnchorText,
            highlight.Start,
            highlight.End,
            highlight.AnchorPrefix,
            highlight.AnchorSuffix,
            highlight.Color,
            highlight.Detached);

        return CanvasJsonHelper.JsonOk(ApiResponse<HighlightDto>.Ok(dto), StatusCodes.Status200OK);
    }

    /// <summary>
    /// 刪除重點標記（軟刪除）。
    /// </summary>
    private static async Task<IResult> DeleteHighlight(
        string highlightId,
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (!Guid.TryParse(highlightId, out var highlightGuid))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Invalid highlight ID"), StatusCodes.Status400BadRequest);
        }

        var highlight = await db.Highlight
            .Where(h => db.Node.Where(n => n.Canvas != null && n.Canvas.UserId == currentUser.UserId).Select(n => n.Id).Contains(h.NodeId))
            .FirstOrDefaultAsync(h => h.Id == highlightGuid, ct);

        if (highlight is null)
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("Highlight not found", 404), StatusCodes.Status404NotFound);
        }

        highlight.ValidFlag = false;
        await db.SaveChangesAsync(ct);

        return Results.StatusCode(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// 對節點提問：以該節點內容為問題，背景執行並串流 AI 回答。
    /// 事件經由 SSE 推送到前端；前端應監聽 /api/canvas/sse/{canvasId}。
    /// 立即回傳 Accepted（202），實際提問非同步進行。
    /// </summary>
    private static IResult AskNode(
        string canvasId,
        ICurrentUser currentUser,
        AskNodeRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.AskFromNodeId))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("AskFromNodeId is required"), StatusCodes.Status400BadRequest);
        }

        // 先把使用者 Id 取出成區域變數：ICurrentUser 是「scoped」服務，綁定當前 HTTP 請求；
        // 一旦下方回傳 Accepted、請求 scope 釋放後，背景工作再去讀 currentUser.UserId 會變成
        // Guid.Empty（它從已消失的 HttpContext 取值），導致 orchestrator 用 Guid.Empty 查不到
        // 任何畫布而「靜默不產生回答、也不報錯」。故必須在進背景前先擷取。
        var userId = currentUser.UserId;

        // 背景執行提問流程，避免被請求超時影響
        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunNodeAskAsync(userId, canvasId, req.AskFromNodeId, cts, req.X, req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskNode operation failed (canvasId={CanvasId}, nodeId={NodeId})", canvasId, req.AskFromNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 追問（對話式）：在來源節點下建立問題節點後提問（接續對話）。
    /// 背景執行；事件經由 SSE 推送。立即回傳 Accepted（202）。
    /// </summary>
    private static IResult AskFollowup(
        string canvasId,
        ICurrentUser currentUser,
        AskFollowupRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.FromNodeId) || string.IsNullOrWhiteSpace(req.Question))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("FromNodeId and Question are required"), StatusCodes.Status400BadRequest);
        }

        // 同 AskNode：ICurrentUser 為 scoped，需在進背景工作前先擷取使用者 Id。
        var userId = currentUser.UserId;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunFollowupAskAsync(userId, canvasId, req.FromNodeId, req.Question, cts, req.X, req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskFollowup operation failed (canvasId={CanvasId}, fromNodeId={FromNodeId})", canvasId, req.FromNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 對選取片段提問：產生回答節點 + 行內連結（來源文字 ↔ 回答節點）。
    /// 背景執行；事件經由 SSE 推送。立即回傳 Accepted（202）。
    /// </summary>
    private static IResult AskInlineLink(
        string canvasId,
        ICurrentUser currentUser,
        AskInlineLinkRequest req,
        IServiceScopeFactory scopeFactory,
        ILoggerFactory loggerFactory)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.SourceNodeId) || string.IsNullOrWhiteSpace(req.AnchorText))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("SourceNodeId and AnchorText are required"), StatusCodes.Status400BadRequest);
        }

        // 同 AskNode：ICurrentUser 為 scoped，需在進背景工作前先擷取使用者 Id。
        var userId = currentUser.UserId;

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var orchestrator = scope.ServiceProvider.GetRequiredService<AskOrchestrator>();
            var logger = loggerFactory.CreateLogger<AskOrchestrator>();

            // 設定 60 秒超時以防止無限期掛起
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            try
            {
                await orchestrator.RunInlineLinkAskAsync(
                    userId,
                    canvasId,
                    req.SourceNodeId,
                    req.AnchorText,
                    req.AnchorStart,
                    req.AnchorEnd,
                    req.AnchorPrefix,
                    req.AnchorSuffix,
                    req.Question ?? "",
                    cts,
                    req.X,
                    req.Y);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AskInlineLink operation failed (canvasId={CanvasId}, sourceNodeId={SourceNodeId})", canvasId, req.SourceNodeId);
            }
        });

        return Results.Accepted();
    }

    /// <summary>
    /// 中止某個回答節點正在進行的 AI 生成。已生成的片段會被保留，spinner 會停止。
    /// 找不到對應進行中的工作（已結束 / 不存在）仍回 Ok（冪等）。
    /// </summary>
    private static IResult CancelAsk(
        string canvasId,
        ICurrentUser currentUser,
        CancelAskRequest req,
        AskCancellationRegistry cancelRegistry)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (string.IsNullOrWhiteSpace(req.NodeId))
        {
            return CanvasJsonHelper.JsonError(ApiResponse<object>.Fail("NodeId is required"), StatusCodes.Status400BadRequest);
        }

        var cancelled = cancelRegistry.TryCancel(req.NodeId);
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { NodeId = req.NodeId, Cancelled = cancelled }));
    }

    // =====================================================
    // AI 模型設定端點
    // =====================================================

    /// <summary>
    /// 取得目前使用者的所有 AI 模型設定（含停用的）。
    /// API 金鑰絕不回傳明碼：若存在回 "********"，否則 null。
    /// 依 Label 排序。
    /// </summary>
    private static async Task<IResult> GetModelsConfig(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 查詢該使用者的所有 AiModel（含停用的）
        var models = await db.AiModel
            .Where(m => m.UserId == currentUser.UserId && m.ValidFlag)
            .OrderBy(m => m.Label)
            .Select(m => new AiModelConfigDto(
                m.Key,
                m.Label,
                m.Provider,
                m.Kind,
                m.Enabled,
                m.ModelId,
                m.BaseUrl,
                // 金鑰遮罩：有值回 "********"，否則 null
                m.ApiKeyEncrypted != null ? "********" : null,
                m.TimeoutSeconds,
                m.Notes))
            .ToListAsync(ct);

        return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelConfigDto>>.Ok(models));
    }

    /// <summary>
    /// 儲存 AI 模型設定（upsert by Key + 刪除不在清單內的模型）。
    /// 金鑰規則：若傳入 ApiKey 非空白「且」不等於 "********" → 加密寫入；
    /// 若為 "********" 或空 → 保留原 ApiKeyEncrypted 不動；
    /// 若完全刪除（傳入空物件）→ 設為 null。
    /// 該使用者不在傳入清單 Key 的 AiModel 視為軟刪除（ValidFlag = false）。
    /// 最後重新查詢並回傳最新設定。
    /// </summary>
    private static async Task<IResult> SaveModelsConfig(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        SaveModelsConfigRequest req,
        IDataProtectionProvider protectionProvider,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        if (req.Models == null)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail("Models list is required"),
                StatusCodes.Status400BadRequest);
        }

        // 建立加密工具
        var protector = protectionProvider.CreateProtector("ZonWiki.AiModel.ApiKey");

        try
        {
            // 蒐集傳入的 Key 集合
            var incomingKeys = new HashSet<string>(req.Models.Select(m => m.Key));

            // Step 1: 處理現有模型與新增模型（upsert）
            foreach (var configDto in req.Models)
            {
                // 驗證必填欄位
                if (string.IsNullOrWhiteSpace(configDto.Key) || string.IsNullOrWhiteSpace(configDto.Label))
                {
                    return CanvasJsonHelper.JsonError(
                        ApiResponse<List<AiModelConfigDto>>.Fail("Key and Label are required for all models"),
                        StatusCodes.Status400BadRequest);
                }

                // 以 (UserId, Key) 查找既有記錄。用 IgnoreQueryFilters 才能找到「曾被軟刪除」的同 Key 列
                // 以便復活——否則全域過濾(ValidFlag==true)看不到它 → 誤走新增 → 撞 (UserId,Key) 唯一索引(23505)。
                var existingModel = await db.AiModel.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(
                        m => m.UserId == currentUser.UserId && m.Key == configDto.Key,
                        ct);

                string? encryptedApiKey = null;

                if (existingModel == null)
                {
                    // 新增模型
                    // 處理 API 金鑰加密
                    if (!string.IsNullOrWhiteSpace(configDto.ApiKey) && configDto.ApiKey != "********")
                    {
                        encryptedApiKey = protector.Protect(configDto.ApiKey);
                    }

                    var newModel = new AiModel
                    {
                        Id = Guid.NewGuid(),
                        UserId = currentUser.UserId,
                        Key = configDto.Key,
                        Label = configDto.Label,
                        Provider = configDto.Provider,
                        Kind = configDto.Kind,
                        Enabled = configDto.Enabled,
                        ModelId = configDto.ModelId,
                        BaseUrl = configDto.BaseUrl,
                        ApiKeyEncrypted = encryptedApiKey,
                        TimeoutSeconds = configDto.TimeoutSeconds,
                        Notes = configDto.Notes,
                    };
                    db.AiModel.Add(newModel);
                }
                else
                {
                    // 編輯既有模型（若曾被軟刪除則一併復活）
                    existingModel.ValidFlag = true;
                    existingModel.DeletedDateTime = null;
                    existingModel.Label = configDto.Label;
                    existingModel.Provider = configDto.Provider;
                    existingModel.Kind = configDto.Kind;
                    existingModel.Enabled = configDto.Enabled;
                    existingModel.ModelId = configDto.ModelId;
                    existingModel.BaseUrl = configDto.BaseUrl;
                    existingModel.TimeoutSeconds = configDto.TimeoutSeconds;
                    existingModel.Notes = configDto.Notes;

                    // 處理 API 金鑰更新邏輯
                    if (!string.IsNullOrWhiteSpace(configDto.ApiKey))
                    {
                        if (configDto.ApiKey != "********")
                        {
                            // 傳入新金鑰 → 加密更新
                            encryptedApiKey = protector.Protect(configDto.ApiKey);
                            existingModel.ApiKeyEncrypted = encryptedApiKey;
                        }
                        // 若為 "********" → 保留原值，不動 ApiKeyEncrypted
                    }
                    else
                    {
                        // 傳入空 → 清空金鑰
                        existingModel.ApiKeyEncrypted = null;
                    }

                    db.AiModel.Update(existingModel);
                }
            }

            // Step 2: 軟刪除不在清單內的模型
            var modelsToDelete = await db.AiModel
                .Where(m => m.UserId == currentUser.UserId && m.ValidFlag && !incomingKeys.Contains(m.Key))
                .ToListAsync(ct);

            foreach (var model in modelsToDelete)
            {
                model.ValidFlag = false;
                model.DeletedDateTime = DateTime.UtcNow;
                db.AiModel.Update(model);
            }

            // 保存所有變更
            await db.SaveChangesAsync(ct);

            // Step 3: 重新查詢並回傳最新設定
            var updatedModels = await db.AiModel
                .Where(m => m.UserId == currentUser.UserId && m.ValidFlag)
                .OrderBy(m => m.Label)
                .Select(m => new AiModelConfigDto(
                    m.Key,
                    m.Label,
                    m.Provider,
                    m.Kind,
                    m.Enabled,
                    m.ModelId,
                    m.BaseUrl,
                    m.ApiKeyEncrypted != null ? "********" : null,
                    m.TimeoutSeconds,
                    m.Notes))
                .ToListAsync(ct);

            return CanvasJsonHelper.JsonOk(ApiResponse<List<AiModelConfigDto>>.Ok(updatedModels));
        }
        catch (Exception ex)
        {
            // 記錄例外以供除錯
            return CanvasJsonHelper.JsonError(
                ApiResponse<List<AiModelConfigDto>>.Fail($"Failed to save models config: {ex.Message}"),
                StatusCodes.Status400BadRequest);
        }
    }

    /// <summary>
    /// 取得 AI 模型健檢狀態。本版不執行真實連線檢查，回傳安全預設值以避免前端 404。
    /// 返回 { Enabled: false, Results: [] }。
    /// </summary>
    private static async Task<IResult> GetHealth(
        ICurrentUser currentUser,
        ZonWikiDbContext db,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<HealthStateDto>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不做真實檢查，回傳安全預設值
        var healthState = new HealthStateDto(
            Enabled: false,
            Results: new List<ModelHealthDto>());

        return CanvasJsonHelper.JsonOk(ApiResponse<HealthStateDto>.Ok(healthState));
    }

    /// <summary>
    /// 設定 AI 模型健檢的啟用狀態。本版不持久化，echo 回傳請求值以避免前端 404。
    /// </summary>
    private static async Task<IResult> SetHealthEnabled(
        ICurrentUser currentUser,
        SetHealthEnabledRequest req,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不持久化，只 echo 回傳
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { Enabled = req.Enabled }));
    }

    /// <summary>
    /// 執行 AI 模型健檢。本版不實際檢查，回傳 Ok no-op 以避免前端 404。
    /// </summary>
    private static async Task<IResult> CheckHealth(
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (currentUser.UserId == Guid.Empty)
        {
            return CanvasJsonHelper.JsonError(
                ApiResponse<object>.Fail("Authentication required", 401),
                StatusCodes.Status401Unauthorized);
        }

        // 本版不做真實檢查，只回 Ok
        return CanvasJsonHelper.JsonOk(ApiResponse<object>.Ok(new { }));
    }
}
