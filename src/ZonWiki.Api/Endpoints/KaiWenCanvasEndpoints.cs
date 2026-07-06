using ZonWiki.Api.RateLimiting;
using ZonWiki.Domain.Common;
using ZonWiki.Domain.Dtos;

namespace ZonWiki.Api.Endpoints;

/// <summary>
/// 開問啦畫布 REST API 端點（CRUD）。
/// 實作前端契約（kaiwen-api.ts）期望的所有路由、方法與欄位形狀。
///
/// 本型別為 <c>partial</c>，實作依子領域拆分於多個檔案（審查 #32，2216 行單檔過大）：
/// <list type="bullet">
///   <item>KaiWenCanvasEndpoints.cs — 路由註冊（本檔）。</item>
///   <item>KaiWenCanvasEndpoints.Canvas.cs — 畫布 CRUD 與整張圖譜載入。</item>
///   <item>KaiWenCanvasEndpoints.Node.cs — 節點 CRUD 與修訂。</item>
///   <item>KaiWenCanvasEndpoints.Edge.cs — 邊 CRUD。</item>
///   <item>KaiWenCanvasEndpoints.InlineLink.cs — 行內連結 CRUD。</item>
///   <item>KaiWenCanvasEndpoints.Highlight.cs — 重點標記 CRUD。</item>
///   <item>KaiWenCanvasEndpoints.Ask.cs — AI 提問（背景執行）與取消。</item>
///   <item>KaiWenCanvasEndpoints.ModelConfig.cs — AI 模型清單 / 設定 / 健檢。</item>
///   <item>KaiWenCanvasEndpoints.Trash.cs — 垃圾桶（還原 / 清除）。</item>
/// </list>
/// 擁有權驗證與共用 CRUD 業務邏輯集中於 <see cref="ZonWiki.Api.Services.CanvasService"/>；
/// 實體 → DTO 映射集中於 <see cref="CanvasMappingExtensions"/>。
/// </summary>
public static partial class KaiWenCanvasEndpoints
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
        // 每使用者限流：這三個端點會 fire-and-forget 呼叫付費 LLM，
        // 若無節流可被同一被盜 cookie／裝置無限觸發，燒爆 LLM 額度或撐爆 VM 記憶體（審查 #30/#58）。
        group.MapPost("/canvases/{canvasId}/ask", AskNode)
            .WithName("AskNode")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized)
            .RequireRateLimiting(RateLimitingExtensions.AiPolicy);

        group.MapPost("/canvases/{canvasId}/ask-followup", AskFollowup)
            .WithName("AskFollowup")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized)
            .RequireRateLimiting(RateLimitingExtensions.AiPolicy);

        group.MapPost("/canvases/{canvasId}/ask-inline-link", AskInlineLink)
            .WithName("AskInlineLink")
            .WithOpenApi()
            .Produces<ApiResponse<object>>(StatusCodes.Status202Accepted)
            .Produces<ApiResponse<object>>(StatusCodes.Status400BadRequest)
            .Produces<ApiResponse<object>>(StatusCodes.Status401Unauthorized)
            .RequireRateLimiting(RateLimitingExtensions.AiPolicy);

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
}
