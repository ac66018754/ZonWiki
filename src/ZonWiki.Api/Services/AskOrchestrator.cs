using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ZonWiki.Api.Realtime;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Ai;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Api.Services;

/// <summary>
/// 提問協調器：把「提問 → AI 串流回答 → 落地節點 → 廣播 SSE」串起來。
/// 針對畫布節點的 Ask 操作，處理上下文組合、供應者解析、串流廣播。
/// 支援三種提問模式：
/// 1. 節點提問：以該節點內容為問題，產生連結的回答子節點
/// 2. 追問：在來源節點下建立問題節點後提問（接續對話）
/// 3. 選取片段提問：產生回答節點 + 行內連結
/// </summary>
public sealed class AskOrchestrator
{
    private const double AnswerOffsetX = 40;
    private const double AnswerOffsetY = 200;
    private const double InlineAnswerOffsetX = 360;
    private const double InlineAnswerOffsetY = 40;

    private readonly ZonWikiDbContext _db;
    private readonly AiProviderFactory _factory;
    private readonly SseHub _hub;
    private readonly AskCancellationRegistry _cancel;
    private readonly AncestryService _ancestry;
    private readonly ILogger<AskOrchestrator> _logger;

    /// <summary>
    /// 建立提問協調器。
    /// </summary>
    public AskOrchestrator(
        ZonWikiDbContext db,
        AiProviderFactory factory,
        SseHub hub,
        AskCancellationRegistry cancel,
        AncestryService ancestry,
        ILogger<AskOrchestrator> logger)
    {
        _db = db;
        _factory = factory;
        _hub = hub;
        _cancel = cancel;
        _ancestry = ancestry;
        _logger = logger;
    }

    /// <summary>
    /// 對節點提問：以該節點內容為問題，串流 AI 回答到連結的回答子節點。
    /// 組建含祖先脈絡的完整 Prompt，由回答節點繼承來源節點的 AI 模型設定。
    /// </summary>
    public async Task RunNodeAskAsync(
        Guid userId,
        string canvasId,
        string askFromNodeId,
        CancellationTokenSource cts,
        double? answerX = null,
        double? answerY = null)
    {
        var cancellationToken = cts.Token;

        // 背景流程無 HttpContext：先把使用者覆寫設給 DbContext，否則使用者隔離全域過濾會以
        // Guid.Empty 把畫布等資料全部濾掉，造成「提問靜默無回應」。必須在任何查詢前呼叫。
        _db.SetCurrentUserId(userId);

        try
        {
            // 驗證畫布 ID 格式
            if (!Guid.TryParse(canvasId, out var canvasGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證節點 ID 格式
            if (!Guid.TryParse(askFromNodeId, out var askFromGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證畫布存在且屬於當前使用者
            var canvas = await _db.Canvas
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    c => c.Id == canvasGuid && c.UserId == userId,
                    cancellationToken);

            if (canvas is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證來源節點存在且屬於該畫布
            var askFrom = await _db.Node
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    n => n.Id == askFromGuid && n.CanvasId == canvasGuid,
                    cancellationToken);

            if (askFrom is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "找不到提問來源節點。" });
                return;
            }

            var question = askFrom.Content;
            // 有選模型 → 用該單一供應者（不變）；沒選模型（預設）→ 走後援鏈。
            var resolvedProvider = string.IsNullOrWhiteSpace(askFrom.Model)
                ? await _factory.ResolveChainAsync(cancellationToken: cancellationToken)
                : await _factory.ResolveAsync(userId, askFrom.Model, cancellationToken);

            // 獲取祖先脈絡（不含自己）。限定在「本畫布」內追溯（canvasGuid 已驗證屬於目前使用者），
            // 避免 ParentId 越界把他人畫布的節點內容帶進提問脈絡（跨帳號外洩）。
            var ancestry = await _ancestry.GetAncestorChainAsync(askFromGuid, canvasGuid, cancellationToken);

            // 組建 Prompt
            var prompt = PromptAssembler.AssembleNodePrompt(ancestry, question);

            // 建立回答節點（內容先空，待串流填入）
            var answer = new Node
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                Title = string.Empty,
                Content = string.Empty,
                ParentId = askFromGuid,
                X = answerX ?? askFrom.X + AnswerOffsetX,
                Y = answerY ?? askFrom.Y + AnswerOffsetY,
                Width = null,
                Height = null,
                ZIndex = askFrom.ZIndex + 1,
                Color = null,
                Model = askFrom.Model,
                Origin = "ai",
                AiSessionId = null,
                AiSessionConsumed = false,
            };

            _db.Node.Add(answer);
            await _db.SaveChangesAsync(cancellationToken);

            // 廣播回答節點已建立
            _hub.Publish(canvasId, "NodeAdded", new
            {
                Node_Id = answer.Id.ToString(),
                Node_CanvasId = answer.CanvasId.ToString(),
                Node_Title = answer.Title,
                Node_Content = answer.Content,
                Node_ParentId = answer.ParentId.HasValue ? answer.ParentId.Value.ToString() : null,
                Node_X = answer.X,
                Node_Y = answer.Y,
                Node_Width = answer.Width,
                Node_Height = answer.Height,
                Node_ZIndex = answer.ZIndex,
                Node_Color = answer.Color,
                Node_Model = answer.Model,
                Node_Origin = answer.Origin,
                Node_AiSessionUuid = (string?)null,
                Node_CreatedDateTime = answer.CreatedDateTime.ToString("O"),
                Node_UpdatedDateTime = answer.UpdatedDateTime.ToString("O"),
            });

            // 建立「來源節點 → 回答節點」的連線（修正生成節點沒有連接）
            await CreateAndBroadcastEdgeAsync(userId, canvasGuid, canvasId, askFromGuid, answer.Id, cancellationToken);

            _hub.Publish(canvasId, "AskStarted", new { NodeId = answer.Id.ToString() });

            // 解析此畫布實際生效的 System Prompt（全域 + 分類 + 自選），串接後注入 AI
            var effectivePrompts = await CanvasSystemPromptResolver.ResolveAsync(
                _db,
                userId,
                answer.CanvasId,
                cancellationToken);
            var systemPrompt = CanvasSystemPromptResolver.Combine(effectivePrompts);

            // 串流迴圈
            await StreamIntoNodeAsync(
                userId,
                canvasId,
                prompt,
                null,
                resolvedProvider,
                answer,
                askFromGuid,
                "node",
                systemPrompt,
                cts);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Node ask operation cancelled (canvasId={CanvasId}, nodeId={NodeId})", canvasId, askFromNodeId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Node ask operation failed (canvasId={CanvasId}, nodeId={NodeId})", canvasId, askFromNodeId);
            // 發佈通用友善訊息，詳細錯誤只記錄伺服器日誌
            _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
        }
    }

    /// <summary>
    /// 追問（對話式）：在來源節點下建立問題節點，連線後再從它提問。
    /// 形成「來源 → 問題 → 回答」的聊天串。
    /// </summary>
    public async Task RunFollowupAskAsync(
        Guid userId,
        string canvasId,
        string fromNodeId,
        string question,
        CancellationTokenSource cts,
        double? questionX = null,
        double? questionY = null)
    {
        var cancellationToken = cts.Token;

        // 背景流程無 HttpContext：先把使用者覆寫設給 DbContext（見 RunNodeAskAsync 說明）。
        _db.SetCurrentUserId(userId);

        try
        {
            // 驗證畫布 ID 格式
            if (!Guid.TryParse(canvasId, out var canvasGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "追問失敗，請稍後重試。" });
                return;
            }

            // 驗證節點 ID 格式
            if (!Guid.TryParse(fromNodeId, out var fromGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "追問失敗，請稍後重試。" });
                return;
            }

            // 驗證畫布存在且屬於當前使用者
            var canvas = await _db.Canvas
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    c => c.Id == canvasGuid && c.UserId == userId,
                    cancellationToken);

            if (canvas is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "追問失敗，請稍後重試。" });
                return;
            }

            // 驗證來源節點
            var from = await _db.Node
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    n => n.Id == fromGuid && n.CanvasId == canvasGuid,
                    cancellationToken);

            if (from is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "找不到追問來源節點。" });
                return;
            }

            // 建立問題節點（使用者輸入的追問）
            var questionNode = new Node
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                Title = string.Empty,
                Content = question,
                ParentId = fromGuid,
                X = questionX ?? from.X + AnswerOffsetX,
                Y = questionY ?? from.Y + AnswerOffsetY,
                Width = null,
                Height = null,
                ZIndex = from.ZIndex + 1,
                Color = null,
                Model = from.Model,
                Origin = "user",
                AiSessionId = null,
                AiSessionConsumed = false,
            };

            _db.Node.Add(questionNode);
            await _db.SaveChangesAsync(cancellationToken);

            // 廣播問題節點已建立
            _hub.Publish(canvasId, "NodeAdded", new
            {
                Node_Id = questionNode.Id.ToString(),
                Node_CanvasId = questionNode.CanvasId.ToString(),
                Node_Title = questionNode.Title,
                Node_Content = questionNode.Content,
                Node_ParentId = questionNode.ParentId.HasValue ? questionNode.ParentId.Value.ToString() : null,
                Node_X = questionNode.X,
                Node_Y = questionNode.Y,
                Node_Width = questionNode.Width,
                Node_Height = questionNode.Height,
                Node_ZIndex = questionNode.ZIndex,
                Node_Color = questionNode.Color,
                Node_Model = questionNode.Model,
                Node_Origin = questionNode.Origin,
                Node_AiSessionUuid = (string?)null,
                Node_CreatedDateTime = questionNode.CreatedDateTime.ToString("O"),
                Node_UpdatedDateTime = questionNode.UpdatedDateTime.ToString("O"),
            });

            // 建立「來源節點 → 問題節點」的連線；隨後 RunNodeAskAsync 會再建「問題節點 → 回答節點」。
            await CreateAndBroadcastEdgeAsync(userId, canvasGuid, canvasId, fromGuid, questionNode.Id, cancellationToken);

            // 接著對問題節點提問（遞迴呼叫，但內部會組建祖先脈絡）
            await RunNodeAskAsync(userId, canvasId, questionNode.Id.ToString(), cts);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Followup ask operation cancelled (canvasId={CanvasId}, fromNodeId={FromNodeId})", canvasId, fromNodeId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Followup ask operation failed (canvasId={CanvasId}, fromNodeId={FromNodeId})", canvasId, fromNodeId);
            // 發佈通用友善訊息，詳細錯誤只記錄伺服器日誌
            _hub.Publish(canvasId, "error", new { Message = "追問失敗，請稍後重試。" });
        }
    }

    /// <summary>
    /// 對選取片段提問：產生回答節點 + 行內連結（來源文字 ↔ 回答節點）。
    /// </summary>
    public async Task RunInlineLinkAskAsync(
        Guid userId,
        string canvasId,
        string sourceNodeId,
        string anchorText,
        int anchorStart,
        int anchorEnd,
        string anchorPrefix,
        string anchorSuffix,
        string question,
        CancellationTokenSource cts,
        double? answerX = null,
        double? answerY = null)
    {
        var cancellationToken = cts.Token;

        // 背景流程無 HttpContext：先把使用者覆寫設給 DbContext（見 RunNodeAskAsync 說明）。
        _db.SetCurrentUserId(userId);

        try
        {
            // 驗證畫布 ID 格式
            if (!Guid.TryParse(canvasId, out var canvasGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證節點 ID 格式
            if (!Guid.TryParse(sourceNodeId, out var sourceGuid))
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證畫布存在且屬於當前使用者
            var canvas = await _db.Canvas
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    c => c.Id == canvasGuid && c.UserId == userId,
                    cancellationToken);

            if (canvas is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
                return;
            }

            // 驗證來源節點
            var source = await _db.Node
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    n => n.Id == sourceGuid && n.CanvasId == canvasGuid,
                    cancellationToken);

            if (source is null)
            {
                _hub.Publish(canvasId, "error", new { Message = "找不到來源節點。" });
                return;
            }

            // 有選模型 → 用該單一供應者（不變）；沒選模型（預設）→ 走後援鏈。
            var resolvedProvider = string.IsNullOrWhiteSpace(source.Model)
                ? await _factory.ResolveChainAsync(cancellationToken: cancellationToken)
                : await _factory.ResolveAsync(userId, source.Model, cancellationToken);

            // 組建 Prompt：除了整份節點內容與框選文字，再附上祖先脈絡（修正「框選提問上下文太少」）。
            // 限定在本畫布內追溯，避免跨畫布/跨帳號外洩（與 RunNodeAskAsync 同策略）。
            var selectionAncestry = await _ancestry.GetAncestorChainAsync(sourceGuid, canvasGuid, cancellationToken);
            var prompt = PromptAssembler.AssembleSelectionPromptWithContext(
                selectionAncestry,
                source.Content,
                anchorText,
                question);

            // 建立回答節點
            var answer = new Node
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                Title = string.Empty,
                Content = string.Empty,
                ParentId = sourceGuid,
                X = answerX ?? source.X + InlineAnswerOffsetX,
                Y = answerY ?? source.Y + InlineAnswerOffsetY,
                Width = null,
                Height = null,
                ZIndex = source.ZIndex + 1,
                Color = null,
                Model = source.Model,
                Origin = "ai",
                AiSessionId = null,
                AiSessionConsumed = false,
            };

            _db.Node.Add(answer);
            await _db.SaveChangesAsync(cancellationToken);

            // 廣播回答節點已建立
            _hub.Publish(canvasId, "NodeAdded", new
            {
                Node_Id = answer.Id.ToString(),
                Node_CanvasId = answer.CanvasId.ToString(),
                Node_Title = answer.Title,
                Node_Content = answer.Content,
                Node_ParentId = answer.ParentId.HasValue ? answer.ParentId.Value.ToString() : null,
                Node_X = answer.X,
                Node_Y = answer.Y,
                Node_Width = answer.Width,
                Node_Height = answer.Height,
                Node_ZIndex = answer.ZIndex,
                Node_Color = answer.Color,
                Node_Model = answer.Model,
                Node_Origin = answer.Origin,
                Node_AiSessionUuid = (string?)null,
                Node_CreatedDateTime = answer.CreatedDateTime.ToString("O"),
                Node_UpdatedDateTime = answer.UpdatedDateTime.ToString("O"),
            });

            // 建立行內連結
            var inlineLink = new InlineLink
            {
                Id = Guid.NewGuid(),
                CanvasId = canvasGuid,
                SourceNodeId = sourceGuid,
                AnchorText = anchorText,
                AnchorStart = anchorStart,
                AnchorEnd = anchorEnd,
                AnchorPrefix = anchorPrefix,
                AnchorSuffix = anchorSuffix,
                TargetNodeId = answer.Id,
                Detached = false,
            };

            _db.InlineLink.Add(inlineLink);
            await _db.SaveChangesAsync(cancellationToken);

            // 廣播行內連結已建立
            _hub.Publish(canvasId, "InlineLinkAdded", new
            {
                InlineLink_Id = inlineLink.Id.ToString(),
                InlineLink_CanvasId = inlineLink.CanvasId.ToString(),
                InlineLink_SourceNodeId = inlineLink.SourceNodeId.ToString(),
                InlineLink_AnchorText = inlineLink.AnchorText,
                InlineLink_AnchorStart = inlineLink.AnchorStart,
                InlineLink_AnchorEnd = inlineLink.AnchorEnd,
                InlineLink_AnchorPrefix = inlineLink.AnchorPrefix,
                InlineLink_AnchorSuffix = inlineLink.AnchorSuffix,
                InlineLink_TargetNodeId = inlineLink.TargetNodeId.ToString(),
                InlineLink_Detached = inlineLink.Detached,
            });

            // 除了行內連結（文字層），再建立節點層的連線，讓回答節點在畫布上有可見連線。
            await CreateAndBroadcastEdgeAsync(userId, canvasGuid, canvasId, sourceGuid, answer.Id, cancellationToken);

            _hub.Publish(canvasId, "AskStarted", new { NodeId = answer.Id.ToString() });

            // 解析此畫布實際生效的 System Prompt（全域 + 分類 + 自選），串接後注入 AI
            var effectivePrompts = await CanvasSystemPromptResolver.ResolveAsync(
                _db,
                userId,
                answer.CanvasId,
                cancellationToken);
            var systemPrompt = CanvasSystemPromptResolver.Combine(effectivePrompts);

            // 串流迴圈
            await StreamIntoNodeAsync(
                userId,
                canvasId,
                prompt,
                null,
                resolvedProvider,
                answer,
                sourceGuid,
                "inlinelink",
                systemPrompt,
                cts);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Inline link ask operation cancelled (canvasId={CanvasId}, sourceNodeId={SourceNodeId})", canvasId, sourceNodeId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Inline link ask operation failed (canvasId={CanvasId}, sourceNodeId={SourceNodeId})", canvasId, sourceNodeId);
            // 發佈通用友善訊息，詳細錯誤只記錄伺服器日誌
            _hub.Publish(canvasId, "error", new { Message = "提問失敗，請稍後重試。" });
        }
    }

    /// <summary>
    /// 建立「來源節點 → 新節點」的連線（Edge）並廣播 EdgeAdded SSE，
    /// 讓 AI 生成的節點在畫布上有可見的連線（修正「生出來的節點沒有連接」）。
    /// 過去節點只設了 ParentId（樹狀關係）但未建立 Edge（圖結構），故畫布看不到連線。
    /// </summary>
    /// <param name="userId">擁有者使用者 Id（與畫布一致）。</param>
    /// <param name="canvasGuid">畫布 Id（GUID）。</param>
    /// <param name="canvasId">畫布 Id（字串，供 SSE 廣播用）。</param>
    /// <param name="sourceNodeId">來源節點 Id。</param>
    /// <param name="targetNodeId">目標（新建）節點 Id。</param>
    /// <param name="cancellationToken">取消權杖。</param>
    private async Task CreateAndBroadcastEdgeAsync(
        Guid userId,
        Guid canvasGuid,
        string canvasId,
        Guid sourceNodeId,
        Guid targetNodeId,
        CancellationToken cancellationToken)
    {
        var edge = new Edge
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CanvasId = canvasGuid,
            SourceNodeId = sourceNodeId,
            TargetNodeId = targetNodeId,
            Kind = "default",
            Label = string.Empty,
            // 接點：父節點底部（b）→ 子節點頂部（t），讓父子連線往下走、較順眼
            // （取代過去 null 接點被自動接到節點上緣、線往上繞的醜樣）。
            SourceHandle = "b",
            TargetHandle = "t",
            DataJson = "{}",
        };

        _db.Edge.Add(edge);
        await _db.SaveChangesAsync(cancellationToken);

        _hub.Publish(canvasId, "EdgeAdded", new
        {
            Edge_Id = edge.Id.ToString(),
            Edge_CanvasId = edge.CanvasId.ToString(),
            Edge_SourceNodeId = edge.SourceNodeId.ToString(),
            Edge_TargetNodeId = edge.TargetNodeId.ToString(),
            Edge_Kind = edge.Kind,
            Edge_Label = edge.Label,
            Edge_SourceHandle = edge.SourceHandle,
            Edge_TargetHandle = edge.TargetHandle,
            Edge_CreatedDateTime = edge.CreatedDateTime.ToString("O"),
        });
    }

    /// <summary>
    /// 串流迴圈：登記中斷來源、累積 Delta、廣播，完成時寫入回答內容與稽核記錄。
    /// 被使用者中斷時保留已生成片段並標記為取消；失敗時廣播錯誤。
    /// </summary>
    private async Task StreamIntoNodeAsync(
        Guid userId,
        string canvasId,
        string prompt,
        string? resumeId,
        ResolvedProvider resolved,
        Node answer,
        Guid askNodeId,
        string kind,
        string? systemPrompt,
        CancellationTokenSource cts)
    {
        var cancellationToken = cts.Token;
        _cancel.Register(answer.Id.ToString(), cts);

        var session = new AiSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CanvasId = Guid.Parse(canvasId),
            AskNodeId = askNodeId,
            ResultNodeId = answer.Id,
            Kind = kind,
            PromptText = prompt,
            Status = "Running",
            TokenUsageJson = "{}",
        };

        var accumulated = new StringBuilder();

        try
        {
            _db.AiSession.Add(session);
            await _db.SaveChangesAsync(cancellationToken);

            // 後援鏈階段記錄器：更新 session.AiProvider + 寫 stage AiMessage（與框選提問共用同一套）。
            // 單一供應者（有選模型）不會發 Stage 事件，故此回呼自然不觸發。
            var onStage = AskQueueService.BuildStageRecorder(_db, session, cancellationToken);

            // 串流 AI 回應
            await foreach (var evt in resolved.Provider.StreamAsync(
                prompt,
                resumeId,
                resolved.Model,
                systemPrompt,
                cancellationToken))
            {
                switch (evt.Type)
                {
                    case AiStreamEventType.Stage:
                        // 記錄階段（哪家/第幾次/失敗錯誤）。
                        await onStage(evt);
                        // 後援鏈「失敗清空重試」：開始新一次嘗試時，若前一家已逐字串出內容，
                        // 通知前端清空該節點已顯示內容，再從新一家重新逐字。
                        if (evt.StageKind == AiStageKind.AttemptStart && accumulated.Length > 0)
                        {
                            _hub.Publish(canvasId, "NodeStreaming", new
                            {
                                NodeId = answer.Id.ToString(),
                                Reset = true,
                            });
                            accumulated.Clear();
                        }
                        break;

                    case AiStreamEventType.Delta:
                        accumulated.Append(evt.Text);
                        _hub.Publish(canvasId, "NodeStreaming", new
                        {
                            NodeId = answer.Id.ToString(),
                            Delta = evt.Text,
                        });
                        break;

                    case AiStreamEventType.Completed:
                        var final = string.IsNullOrEmpty(evt.Text) ? accumulated.ToString() : evt.Text;
                        await FinishAsync(answer, final, evt.SessionId, session, "Completed", CancellationToken.None);
                        _hub.Publish(canvasId, "NodeUpdated", new
                        {
                            Node_Id = answer.Id.ToString(),
                            Node_CanvasId = answer.CanvasId.ToString(),
                            Node_Title = answer.Title,
                            Node_Content = answer.Content,
                            Node_ParentId = answer.ParentId.HasValue ? answer.ParentId.Value.ToString() : null,
                            Node_X = answer.X,
                            Node_Y = answer.Y,
                            Node_Width = answer.Width,
                            Node_Height = answer.Height,
                            Node_ZIndex = answer.ZIndex,
                            Node_Color = answer.Color,
                            Node_Model = answer.Model,
                            Node_Origin = answer.Origin,
                            Node_AiSessionUuid = answer.AiSessionId.HasValue ? answer.AiSessionId.Value.ToString() : null,
                            Node_CreatedDateTime = answer.CreatedDateTime.ToString("O"),
                            Node_UpdatedDateTime = answer.UpdatedDateTime.ToString("O"),
                        });
                        _hub.Publish(canvasId, "AskCompleted", new { NodeId = answer.Id.ToString() });
                        return;

                    case AiStreamEventType.Error:
                        await FinishAsync(answer, accumulated.ToString(), null, session, "Failed", CancellationToken.None);
                        _hub.Publish(canvasId, "error", new { NodeId = answer.Id.ToString(), Message = evt.Text });
                        _hub.Publish(canvasId, "AskCompleted", new { NodeId = answer.Id.ToString() });
                        return;
                }
            }

            // 正常結束（無明確 Completed 事件）
            await FinishAsync(answer, accumulated.ToString(), null, session, "Completed", CancellationToken.None);
            _hub.Publish(canvasId, "NodeUpdated", new
            {
                Node_Id = answer.Id.ToString(),
                Node_CanvasId = answer.CanvasId.ToString(),
                Node_Title = answer.Title,
                Node_Content = answer.Content,
                Node_ParentId = answer.ParentId.HasValue ? answer.ParentId.Value.ToString() : null,
                Node_X = answer.X,
                Node_Y = answer.Y,
                Node_Width = answer.Width,
                Node_Height = answer.Height,
                Node_ZIndex = answer.ZIndex,
                Node_Color = answer.Color,
                Node_Model = answer.Model,
                Node_Origin = answer.Origin,
                Node_AiSessionUuid = answer.AiSessionId.HasValue ? answer.AiSessionId.Value.ToString() : null,
                Node_CreatedDateTime = answer.CreatedDateTime.ToString("O"),
                Node_UpdatedDateTime = answer.UpdatedDateTime.ToString("O"),
            });
            _hub.Publish(canvasId, "AskCompleted", new { NodeId = answer.Id.ToString() });
        }
        catch (OperationCanceledException)
        {
            // 使用者中斷：保留已生成片段
            var partial = accumulated.ToString();
            await FinishAsync(answer, partial, null, session, "Cancelled", CancellationToken.None);
            _hub.Publish(canvasId, "NodeUpdated", new
            {
                Node_Id = answer.Id.ToString(),
                Node_CanvasId = answer.CanvasId.ToString(),
                Node_Title = answer.Title,
                Node_Content = answer.Content,
                Node_ParentId = answer.ParentId.HasValue ? answer.ParentId.Value.ToString() : null,
                Node_X = answer.X,
                Node_Y = answer.Y,
                Node_Width = answer.Width,
                Node_Height = answer.Height,
                Node_ZIndex = answer.ZIndex,
                Node_Color = answer.Color,
                Node_Model = answer.Model,
                Node_Origin = answer.Origin,
                Node_AiSessionUuid = answer.AiSessionId.HasValue ? answer.AiSessionId.Value.ToString() : null,
                Node_CreatedDateTime = answer.CreatedDateTime.ToString("O"),
                Node_UpdatedDateTime = answer.UpdatedDateTime.ToString("O"),
            });
            _hub.Publish(canvasId, "AskCompleted", new { NodeId = answer.Id.ToString() });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stream operation failed for node {NodeId}", answer.Id);
            await FinishAsync(answer, accumulated.ToString(), null, session, "Failed", CancellationToken.None);
            // 發佈通用友善訊息，詳細錯誤只記錄伺服器日誌
            _hub.Publish(canvasId, "error", new { NodeId = answer.Id.ToString(), Message = "提問失敗，請稍後重試。" });
            _hub.Publish(canvasId, "AskCompleted", new { NodeId = answer.Id.ToString() });
        }
        finally
        {
            _cancel.Unregister(answer.Id.ToString());
        }
    }

    /// <summary>
    /// 寫入回答節點的最終內容與 AiSession 記錄。
    /// 查詢該 Session 已有的訊息數以決定下一個 SeqNo（確保單調遞增）。
    /// </summary>
    private async Task FinishAsync(
        Node answer,
        string content,
        string? sessionId,
        AiSession session,
        string status,
        CancellationToken cancellationToken)
    {
        answer.Content = content;
        if (!string.IsNullOrEmpty(sessionId))
        {
            answer.AiSessionId = session.Id;
        }

        session.Status = status;

        // 取得該 Session 的最大 SeqNo，以確保單調遞增（新訊息 SeqNo = 最大值 + 1）
        var maxSeqNo = await _db.AiMessage
            .Where(m => m.SessionId == session.Id)
            .MaxAsync(m => (int?)m.SeqNo, cancellationToken) ?? 0;

        _db.AiMessage.Add(new AiMessage
        {
            Id = Guid.NewGuid(),
            SessionId = session.Id,
            Role = status == "Failed" ? "error" : "assistant",
            Content = content,
            RawJsonLine = string.Empty,
            SeqNo = maxSeqNo + 1,
        });

        if ((status == "Completed" || status == "Cancelled") && !string.IsNullOrEmpty(content))
        {
            _db.NodeRevision.Add(new NodeRevision
            {
                Id = Guid.NewGuid(),
                NodeId = answer.Id,
                Content = content,
                Source = "ai",
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
    }
}
