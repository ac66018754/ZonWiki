namespace ZonWiki.Domain.Dtos;

/// <summary>
/// 畫布資料傳輸物件（清單與詳情用）。
/// 欄位名稱遵循 {Table}_{Field} 命名規範，對應前端期望的 PascalCase。
/// </summary>
/// <param name="Canvas_Id">畫布識別碼。</param>
/// <param name="Canvas_Title">畫布標題。</param>
/// <param name="Canvas_Description">畫布描述（可選）。</param>
/// <param name="Canvas_StateJson">畫布 UI 狀態（縮放、平移等）以 JSON 字串保存。</param>
public sealed record CanvasDto(
    string Canvas_Id,
    string Canvas_Title,
    string Canvas_Description,
    string Canvas_StateJson);

/// <summary>
/// 建立畫布的請求。
/// </summary>
/// <param name="Title">畫布標題。</param>
public sealed record CreateCanvasRequest(string Title);

/// <summary>
/// 重新命名畫布的請求。
/// </summary>
/// <param name="Title">新標題。</param>
public sealed record RenameCanvasRequest(string Title);

/// <summary>
/// 節點資料傳輸物件。
/// </summary>
/// <param name="Node_Id">節點識別碼。</param>
/// <param name="Node_CanvasId">所屬畫布識別碼。</param>
/// <param name="Node_Title">節點標題。</param>
/// <param name="Node_Content">節點內容（Markdown）。</param>
/// <param name="Node_ParentId">父節點識別碼（可空）。</param>
/// <param name="Node_X">X 座標。</param>
/// <param name="Node_Y">Y 座標。</param>
/// <param name="Node_Width">寬度（可空）。</param>
/// <param name="Node_Height">高度（可空）。</param>
/// <param name="Node_ZIndex">疊放層級。</param>
/// <param name="Node_Color">節點顏色（可空）。</param>
/// <param name="Node_Model">偏好 AI 模型（可空）。</param>
/// <param name="Node_Origin">節點來源（user / ai / image）。</param>
/// <param name="Node_AiSessionUuid">AI session 識別碼（可空）。</param>
/// <param name="Node_CreatedDateTime">建立時間（UTC）。</param>
/// <param name="Node_UpdatedDateTime">最後更新時間（UTC）。</param>
public sealed record NodeDto(
    string Node_Id,
    string Node_CanvasId,
    string Node_Title,
    string Node_Content,
    string? Node_ParentId,
    double Node_X,
    double Node_Y,
    double? Node_Width,
    double? Node_Height,
    int Node_ZIndex,
    string? Node_Color,
    string? Node_Model,
    string Node_Origin,
    string? Node_AiSessionUuid,
    string? Node_CreatedDateTime,
    string? Node_UpdatedDateTime);

/// <summary>
/// 建立節點的請求。
/// </summary>
/// <param name="Title">節點標題（可選）。</param>
/// <param name="Content">節點內容（可選）。</param>
/// <param name="ParentId">父節點識別碼（可選）。</param>
/// <param name="X">X 座標。</param>
/// <param name="Y">Y 座標。</param>
/// <param name="Color">節點顏色（可選）。</param>
public sealed record CreateNodeRequest(
    string? Title = null,
    string? Content = null,
    string? ParentId = null,
    double X = 0,
    double Y = 0,
    string? Color = null);

/// <summary>
/// 更新節點內容的請求。
/// </summary>
/// <param name="Content">新內容。</param>
public sealed record UpdateNodeContentRequest(string Content);

/// <summary>
/// 設定節點 AI 模型的請求。
/// </summary>
/// <param name="Model">模型別名（如 opus / sonnet / haiku）。</param>
public sealed record SetNodeModelRequest(string Model);

/// <summary>
/// 邊（連線）資料傳輸物件。
/// </summary>
/// <param name="Edge_Id">邊識別碼。</param>
/// <param name="Edge_CanvasId">所屬畫布識別碼。</param>
/// <param name="Edge_SourceNodeId">來源節點識別碼。</param>
/// <param name="Edge_TargetNodeId">目標節點識別碼。</param>
/// <param name="Edge_Kind">邊的種類（預設 default）。</param>
/// <param name="Edge_Label">邊的標籤（可空）。</param>
/// <param name="Edge_SourceHandle">來源連接點（可空）。</param>
/// <param name="Edge_TargetHandle">目標連接點（可空）。</param>
/// <param name="Edge_CreatedDateTime">建立時間（UTC）。</param>
public sealed record EdgeDto(
    string Edge_Id,
    string Edge_CanvasId,
    string Edge_SourceNodeId,
    string Edge_TargetNodeId,
    string Edge_Kind,
    string Edge_Label,
    string? Edge_SourceHandle,
    string? Edge_TargetHandle,
    string? Edge_CreatedDateTime);

/// <summary>
/// 建立邊的請求。
/// </summary>
/// <param name="SourceNodeId">來源節點識別碼。</param>
/// <param name="TargetNodeId">目標節點識別碼。</param>
/// <param name="SourceHandle">來源連接點（可選）。</param>
/// <param name="TargetHandle">目標連接點（可選）。</param>
public sealed record CreateEdgeRequest(
    string SourceNodeId,
    string TargetNodeId,
    string? SourceHandle = null,
    string? TargetHandle = null);

/// <summary>
/// 重新連接邊的請求。
/// </summary>
/// <param name="SourceNodeId">新的來源節點識別碼。</param>
/// <param name="TargetNodeId">新的目標節點識別碼。</param>
/// <param name="SourceHandle">新的來源連接點（可選）。</param>
/// <param name="TargetHandle">新的目標連接點（可選）。</param>
public sealed record ReconnectEdgeRequest(
    string SourceNodeId,
    string TargetNodeId,
    string? SourceHandle = null,
    string? TargetHandle = null);

/// <summary>
/// 行內連結資料傳輸物件。
/// </summary>
/// <param name="InlineLink_Id">行內連結識別碼。</param>
/// <param name="InlineLink_CanvasId">所屬畫布識別碼。</param>
/// <param name="InlineLink_SourceNodeId">來源節點識別碼。</param>
/// <param name="InlineLink_AnchorText">被框選的文字。</param>
/// <param name="InlineLink_AnchorStart">錨點起始字元位移。</param>
/// <param name="InlineLink_AnchorEnd">錨點結束字元位移。</param>
/// <param name="InlineLink_AnchorPrefix">錨點前文窗。</param>
/// <param name="InlineLink_AnchorSuffix">錨點後文窗。</param>
/// <param name="InlineLink_TargetNodeId">目標節點識別碼。</param>
/// <param name="InlineLink_Detached">是否已脫錨。</param>
public sealed record InlineLinkDto(
    string InlineLink_Id,
    string InlineLink_CanvasId,
    string InlineLink_SourceNodeId,
    string InlineLink_AnchorText,
    int InlineLink_AnchorStart,
    int InlineLink_AnchorEnd,
    string InlineLink_AnchorPrefix,
    string InlineLink_AnchorSuffix,
    string InlineLink_TargetNodeId,
    bool InlineLink_Detached);

/// <summary>
/// 建立行內連結的請求。
/// </summary>
/// <param name="SourceNodeId">來源節點識別碼。</param>
/// <param name="AnchorText">被框選的文字。</param>
/// <param name="AnchorStart">錨點起始字元位移。</param>
/// <param name="AnchorEnd">錨點結束字元位移。</param>
/// <param name="AnchorPrefix">錨點前文窗。</param>
/// <param name="AnchorSuffix">錨點後文窗。</param>
/// <param name="TargetNodeId">目標節點識別碼。</param>
public sealed record CreateInlineLinkRequest(
    string SourceNodeId,
    string AnchorText,
    int AnchorStart,
    int AnchorEnd,
    string AnchorPrefix,
    string AnchorSuffix,
    string TargetNodeId);

/// <summary>
/// 更新行內連結目標的請求。
/// </summary>
/// <param name="TargetNodeId">新的目標節點識別碼。</param>
public sealed record UpdateInlineLinkTargetRequest(string TargetNodeId);

/// <summary>
/// 重點（亮點）標記資料傳輸物件。
/// </summary>
/// <param name="Highlight_Id">重點識別碼。</param>
/// <param name="Highlight_NodeId">所屬節點識別碼。</param>
/// <param name="Highlight_AnchorText">被標記的原文。</param>
/// <param name="Highlight_Start">起始字元位移。</param>
/// <param name="Highlight_End">結束字元位移。</param>
/// <param name="Highlight_AnchorPrefix">錨點前文窗。</param>
/// <param name="Highlight_AnchorSuffix">錨點後文窗。</param>
/// <param name="Highlight_Color">重點顏色。</param>
/// <param name="Highlight_Detached">是否已脫錨。</param>
public sealed record HighlightDto(
    string Highlight_Id,
    string Highlight_NodeId,
    string Highlight_AnchorText,
    int Highlight_Start,
    int Highlight_End,
    string Highlight_AnchorPrefix,
    string Highlight_AnchorSuffix,
    string Highlight_Color,
    bool Highlight_Detached);

/// <summary>
/// 建立重點的請求。
/// </summary>
/// <param name="AnchorText">被標記的原文。</param>
/// <param name="Start">起始字元位移。</param>
/// <param name="End">結束字元位移。</param>
/// <param name="AnchorPrefix">錨點前文窗。</param>
/// <param name="AnchorSuffix">錨點後文窗。</param>
/// <param name="Color">重點顏色。</param>
public sealed record CreateHighlightRequest(
    string AnchorText,
    int Start,
    int End,
    string AnchorPrefix,
    string AnchorSuffix,
    string Color);

/// <summary>
/// 節點修訂（版本）資料傳輸物件。
/// </summary>
/// <param name="NodeRevision_Id">修訂識別碼。</param>
/// <param name="NodeRevision_NodeId">所屬節點識別碼。</param>
/// <param name="NodeRevision_Content">該版本的內容快照。</param>
/// <param name="NodeRevision_Source">來源（created / edited / ai）。</param>
/// <param name="NodeRevision_CreatedDateTime">建立時間（UTC）。</param>
public sealed record NodeRevisionDto(
    string NodeRevision_Id,
    string NodeRevision_NodeId,
    string NodeRevision_Content,
    string NodeRevision_Source,
    string NodeRevision_CreatedDateTime);

/// <summary>
/// AI 模型資料傳輸物件（清單用）。
/// 不含金鑰；僅包含標籤、提供商、模型類型等公開資訊。
/// </summary>
/// <param name="Key">模型唯一識別碼（如 claude-opus, gpt-4）。</param>
/// <param name="Label">模型標籤（供 UI 顯示）。</param>
/// <param name="Provider">模型提供商（如 anthropic, openai）。</param>
/// <param name="Kind">模型類型（text / image）。</param>
/// <param name="ModelId">模型實際 ID（可空）。</param>
/// <param name="Notes">備註（可空）。</param>
public sealed record AiModelDto(
    string Key,
    string Label,
    string Provider,
    string Kind,
    string? ModelId = null,
    string? Notes = null);

/// <summary>
/// 畫布完整圖譜資料傳輸物件（含所有節點、邊、行內連結、重點）。
/// </summary>
/// <param name="Canvas">畫布基本資訊。</param>
/// <param name="Nodes">該畫布的所有節點。</param>
/// <param name="Edges">該畫布的所有邊。</param>
/// <param name="InlineLinks">該畫布的所有行內連結。</param>
/// <param name="Highlights">該畫布的所有重點標記。</param>
public sealed record CanvasGraphDto(
    CanvasDto Canvas,
    List<NodeDto> Nodes,
    List<EdgeDto> Edges,
    List<InlineLinkDto> InlineLinks,
    List<HighlightDto> Highlights);

/// <summary>
/// 對節點提問的請求（以節點內容為問題）。
/// </summary>
/// <param name="AskFromNodeId">提問來源節點識別碼。</param>
/// <param name="X">答案節點 X 座標（可選，若未提供則使用預設偏移）。</param>
/// <param name="Y">答案節點 Y 座標（可選，若未提供則使用預設偏移）。</param>
public sealed record AskNodeRequest(
    string AskFromNodeId,
    double? X = null,
    double? Y = null);

/// <summary>
/// 追問（對話式）的請求。
/// </summary>
/// <param name="FromNodeId">追問來源節點識別碼。</param>
/// <param name="Question">使用者輸入的追問問題。</param>
/// <param name="X">問題節點 X 座標（可選）。</param>
/// <param name="Y">問題節點 Y 座標（可選）。</param>
public sealed record AskFollowupRequest(
    string FromNodeId,
    string Question,
    double? X = null,
    double? Y = null);

/// <summary>
/// 對選取片段提問的請求。
/// </summary>
/// <param name="SourceNodeId">來源節點識別碼。</param>
/// <param name="AnchorText">被框選的文字。</param>
/// <param name="AnchorStart">錨點起始字元位移。</param>
/// <param name="AnchorEnd">錨點結束字元位移。</param>
/// <param name="AnchorPrefix">錨點前文窗。</param>
/// <param name="AnchorSuffix">錨點後文窗。</param>
/// <param name="Question">使用者提問。</param>
/// <param name="X">答案節點 X 座標（可選）。</param>
/// <param name="Y">答案節點 Y 座標（可選）。</param>
public sealed record AskInlineLinkRequest(
    string SourceNodeId,
    string AnchorText,
    int AnchorStart,
    int AnchorEnd,
    string AnchorPrefix,
    string AnchorSuffix,
    string? Question = null,
    double? X = null,
    double? Y = null);

/// <summary>
/// 中止提問的請求。
/// </summary>
/// <param name="NodeId">要中止的回答節點識別碼。</param>
public sealed record CancelAskRequest(string NodeId);

// =====================================================
// AI 模型設定相關 DTO
// =====================================================

/// <summary>
/// AI 模型設定資料傳輸物件（用於設定頁 - 完整配置含金鑰佔位）。
/// 一般情況下 ApiKey 會遮罩為 "********"，編輯時保留遮罩表示「不修改」。
/// </summary>
/// <param name="Key">
/// 穩定識別鍵（前端下拉的 value、節點記錄使用的模型鍵）。例如 "claude-opus"、"groq"。
/// </param>
/// <param name="Label">
/// 顯示名稱（前端下拉的文字）。例如 "Claude Opus"。
/// </param>
/// <param name="Provider">
/// 供應者類型："ClaudeCli"（本機 claude CLI）或 "OpenAiCompatible"（OpenAI 相容 HTTP 端點）。
/// </param>
/// <param name="Kind">
/// 模型用途："chat"（文字問答，預設）或 "image"（圖片生成）。
/// </param>
/// <param name="Enabled">
/// 是否啟用（停用者不會出現在前端清單，也不能被選用）。
/// </param>
/// <param name="ModelId">
/// 傳給供應者的模型代號。ClaudeCli 作為 --model（如 opus/sonnet/haiku）；
/// OpenAiCompatible 作為請求 body 的 model 欄位。可空。
/// </param>
/// <param name="BaseUrl">
/// OpenAI 相容端點的基底 URL（需含正確路徑前綴，如 .../v1）。ClaudeCli 不需要。可空。
/// </param>
/// <param name="ApiKey">
/// API 金鑰（編輯表單中顯示；新增時傳明碼，編輯時傳 "********" 表示保留原值）。可空。
/// 回傳時絕不可返回明碼，若有值回 "********"。
/// </param>
/// <param name="TimeoutSeconds">
/// HTTP 串流逾時秒數（OpenAiCompatible 用）。預設 300。
/// </param>
/// <param name="Notes">
/// 給使用者看的備註（設定提示）。不影響行為。可空。
/// </param>
public sealed record AiModelConfigDto(
    string Key,
    string Label,
    string Provider,
    string Kind,
    bool Enabled,
    string? ModelId,
    string? BaseUrl,
    string? ApiKey,
    int TimeoutSeconds,
    string? Notes);

/// <summary>
/// 單次健檢結果（單個模型的健康狀態）。
/// </summary>
/// <param name="Key">
/// 模型識別鍵。
/// </param>
/// <param name="Label">
/// 模型標籤。
/// </param>
/// <param name="Provider">
/// 提供商。
/// </param>
/// <param name="Kind">
/// 模型類型。
/// </param>
/// <param name="Status">
/// 健檢狀態："ok" / "error" / "unknown"。本版固定為 "unknown"。
/// </param>
/// <param name="LatencyMs">
/// 回應延遲（毫秒）。本版固定為 null。
/// </param>
/// <param name="CheckedAtUtc">
/// 最後檢查時間（ISO 8601）。本版固定為 null。
/// </param>
/// <param name="Error">
/// 錯誤訊息（若 status=error）。本版固定為 null。
/// </param>
public sealed record ModelHealthDto(
    string Key,
    string Label,
    string Provider,
    string Kind,
    string Status,
    long? LatencyMs,
    string? CheckedAtUtc,
    string? Error);

/// <summary>
/// 健檢整體狀態（含所有模型的健檢結果）。
/// </summary>
/// <param name="Enabled">
/// 是否啟用整體健檢（本版固定 false，代表未啟用）。
/// </param>
/// <param name="Results">
/// 各模型的健檢結果清單。本版固定為空清單 []。
/// </param>
public sealed record HealthStateDto(
    bool Enabled,
    List<ModelHealthDto> Results);

/// <summary>
/// 保存 AI 模型設定的請求。
/// </summary>
/// <param name="Models">
/// 使用者設定的模型清單（含新增、編輯、刪除；由 Key 識別）。
/// 不在此清單內的現有模型視為刪除。
/// </param>
public sealed record SaveModelsConfigRequest(List<AiModelConfigDto> Models);

/// <summary>
/// 設定健檢啟用狀態的請求。
/// </summary>
/// <param name="Enabled">
/// 是否啟用健檢功能。
/// </param>
public sealed record SetHealthEnabledRequest(bool Enabled);

/// <summary>
/// 垃圾桶中的「已刪除畫布」項目。
/// </summary>
/// <param name="Canvas_Id">畫布識別碼。</param>
/// <param name="Canvas_Title">畫布標題。</param>
/// <param name="DeletedAtUtc">刪除時間（UTC，ISO-8601）。</param>
/// <param name="NodeCount">該畫布的節點數（供使用者判斷份量）。</param>
public sealed record TrashCanvasDto(
    string Canvas_Id,
    string Canvas_Title,
    string DeletedAtUtc,
    int NodeCount);

/// <summary>
/// 垃圾桶中的「已刪除節點」項目（單獨刪除、其畫布仍存在者）。
/// </summary>
/// <param name="Node_Id">節點識別碼。</param>
/// <param name="Node_CanvasId">所屬畫布識別碼。</param>
/// <param name="Canvas_Title">所屬畫布標題（讓使用者知道從哪刪的）。</param>
/// <param name="Snippet">內容首行片段。</param>
/// <param name="ContentPreview">內容預覽（同 Snippet，相容前端欄位）。</param>
/// <param name="CreatedAtUtc">建立時間（UTC，ISO-8601）。</param>
/// <param name="DeletedAtUtc">刪除時間（UTC，ISO-8601）。</param>
public sealed record TrashNodeDto(
    string Node_Id,
    string Node_CanvasId,
    string Canvas_Title,
    string Snippet,
    string ContentPreview,
    string CreatedAtUtc,
    string DeletedAtUtc);

/// <summary>
/// 垃圾桶清單（已刪除的畫布與節點）。
/// </summary>
/// <param name="Canvases">已刪除的畫布。</param>
/// <param name="Nodes">已刪除的節點。</param>
public sealed record TrashListingDto(
    List<TrashCanvasDto> Canvases,
    List<TrashNodeDto> Nodes);

// ───────────────────────── 畫布設定（分類 / System Prompt） ─────────────────────────

/// <summary>
/// System Prompt（系統提示）資料傳輸物件。
/// 欄位名稱遵循 {Table}_{Field} 命名規範，對應前端期望的 PascalCase。
/// </summary>
/// <param name="SystemPrompt_Id">System Prompt 識別碼。</param>
/// <param name="SystemPrompt_Title">顯示標題（供清單辨識）。</param>
/// <param name="SystemPrompt_Content">提示內容（會送給 AI 作為系統提示）。</param>
/// <param name="SystemPrompt_IsGlobal">是否為全域：true 表示自動套用到所有畫布。</param>
public sealed record SystemPromptDto(
    string SystemPrompt_Id,
    string SystemPrompt_Title,
    string SystemPrompt_Content,
    bool SystemPrompt_IsGlobal);

/// <summary>
/// 「實際生效」的 System Prompt（合併全域 / 分類 / 自選三來源、去重後）。
/// </summary>
/// <param name="SystemPrompt_Id">System Prompt 識別碼。</param>
/// <param name="Title">顯示標題。</param>
/// <param name="Content">提示內容。</param>
/// <param name="Source">來源：global（全域）/ category（分類）/ own（畫布自選）。</param>
/// <param name="CategoryName">來源分類名稱（僅 Source 為 category 時有值，其餘為 null）。</param>
public sealed record EffectiveSystemPromptDto(
    string SystemPrompt_Id,
    string Title,
    string Content,
    string Source,
    string? CategoryName);

/// <summary>
/// 單一畫布的系統設定：所屬分類、自選 System Prompt，以及實際生效清單。
/// </summary>
/// <param name="CategoryIds">此畫布所屬分類的識別碼清單。</param>
/// <param name="OwnPromptIds">此畫布額外自選的 System Prompt 識別碼清單。</param>
/// <param name="Effective">合併全域 / 分類 / 自選後實際生效的 System Prompt（已去重）。</param>
public sealed record CanvasSystemConfigDto(
    List<string> CategoryIds,
    List<string> OwnPromptIds,
    List<EffectiveSystemPromptDto> Effective);

/// <summary>
/// 畫布分類（含關聯）資料傳輸物件。欄位沿用前端契約的 Category_ 前綴。
/// </summary>
/// <param name="Category_Id">分類識別碼。</param>
/// <param name="Category_Name">分類名稱。</param>
/// <param name="CanvasIds">屬於此分類的畫布識別碼清單。</param>
/// <param name="PromptIds">此分類吃到的 System Prompt 識別碼清單。</param>
public sealed record CategoryWithLinksDto(
    string Category_Id,
    string Category_Name,
    List<string> CanvasIds,
    List<string> PromptIds);

/// <summary>
/// 建立 System Prompt 的請求。
/// </summary>
/// <param name="Title">標題（必填）。</param>
/// <param name="Content">內容（可空）。</param>
/// <param name="IsGlobal">是否為全域。</param>
public sealed record CreateSystemPromptRequest(
    string Title,
    string Content,
    bool IsGlobal);

/// <summary>
/// 更新 System Prompt 的請求（標題、內容、全域旗標）。
/// </summary>
/// <param name="Title">標題（必填）。</param>
/// <param name="Content">內容（可空）。</param>
/// <param name="IsGlobal">是否為全域。</param>
public sealed record UpdateSystemPromptRequest(
    string Title,
    string Content,
    bool IsGlobal);

/// <summary>
/// 建立畫布分類的請求。
/// </summary>
/// <param name="Name">分類名稱（必填）。</param>
public sealed record CreateCategoryRequest(string Name);

/// <summary>
/// 重新命名畫布分類的請求。
/// </summary>
/// <param name="Name">新分類名稱（必填）。</param>
public sealed record UpdateCategoryRequest(string Name);

/// <summary>
/// 整批設定識別碼集合的請求（整組取代語意，非逐筆增刪）。
/// 用於：設定畫布所屬分類、畫布自選 Prompt、分類包含的畫布、分類吃到的 Prompt。
/// </summary>
/// <param name="Ids">完整的識別碼清單（會整組取代既有關聯）。</param>
public sealed record SetIdsRequest(List<string> Ids);
