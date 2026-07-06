/**
 * KaiWen 型別定義 — 從開問啦原始碼適配
 * 與後端 JSON 對應（保留 PascalCase 欄位名，與 DB 一致）
 */

export interface CanvasDto {
  Canvas_Id: string
  Canvas_Title: string
  Canvas_Description: string
  Canvas_StateJson: string
}

export interface NodeDto {
  Node_Id: string
  Node_CanvasId: string
  Node_Title: string
  Node_Content: string
  Node_ParentId: string | null
  Node_X: number
  Node_Y: number
  Node_Width?: number | null
  Node_Height?: number | null
  Node_ZIndex: number
  Node_Color?: string | null
  Node_Model?: string | null
  Node_Origin?: string | null
  Node_AiSessionUuid?: string | null
  Node_CreatedDateTime?: string
  Node_UpdatedDateTime?: string
  /** 樂觀鎖版本（PostgreSQL xmin，#4/#34）；編輯內容保存時原封帶回為 baseVersion 供後端偵測併發衝突 */
  Node_Version?: number
}

export interface AiModelDto {
  Key: string
  Label: string
  Provider: string
  Kind: string
  ModelId?: string | null
  Notes?: string | null
}

export interface NodeRevisionDto {
  NodeRevision_Id: string
  NodeRevision_NodeId: string
  NodeRevision_Content: string
  NodeRevision_Source: string
  NodeRevision_CreatedDateTime: string
}

export interface EdgeDto {
  Edge_Id: string
  Edge_CanvasId: string
  Edge_SourceNodeId: string
  Edge_TargetNodeId: string
  Edge_Kind: string
  Edge_Label: string
  Edge_SourceHandle?: string | null
  Edge_TargetHandle?: string | null
  Edge_CreatedDateTime?: string
}

export interface InlineLinkDto {
  InlineLink_Id: string
  InlineLink_CanvasId: string
  InlineLink_SourceNodeId: string
  InlineLink_AnchorText: string
  InlineLink_AnchorStart: number
  InlineLink_AnchorEnd: number
  InlineLink_AnchorPrefix: string
  InlineLink_AnchorSuffix: string
  InlineLink_TargetNodeId: string
  InlineLink_Detached: boolean
}

export interface HighlightDto {
  Highlight_Id: string
  Highlight_NodeId: string
  Highlight_AnchorText: string
  Highlight_Start: number
  Highlight_End: number
  Highlight_AnchorPrefix: string
  Highlight_AnchorSuffix: string
  Highlight_Color: string
  Highlight_Detached: boolean
}

/**
 * 畫布標註（便利貼 / 塗鴉 / 圖片板）資料傳輸物件。
 * 座標為畫布座標 (flow coordinates)；欄位採後端 {Table}_{Field} PascalCase。
 */
export interface CanvasAnnotationDto {
  CanvasAnnotation_Id: string
  /** "sticky" | "drawing" | "slide" */
  CanvasAnnotation_Kind: string
  CanvasAnnotation_X: number
  CanvasAnnotation_Y: number
  CanvasAnnotation_Width: number
  CanvasAnnotation_Height: number
  CanvasAnnotation_ZIndex: number
  CanvasAnnotation_Color?: string | null
  CanvasAnnotation_Text?: string | null
  CanvasAnnotation_DataJson?: string | null
}

export interface AiModelConfigDto {
  Key: string
  Label: string
  Provider: string
  Kind: string
  Enabled: boolean
  ModelId?: string | null
  BaseUrl?: string | null
  ApiKey?: string | null
  TimeoutSeconds?: number
  Notes?: string | null
}

export interface ModelHealthDto {
  Key: string
  Label: string
  Provider: string
  Kind: string
  Status: string
  LatencyMs?: number | null
  CheckedAtUtc?: string | null
  Error?: string | null
}

export interface HealthStateDto {
  Enabled: boolean
  Results: ModelHealthDto[]
}

export interface SearchCanvasHit {
  Canvas_Id: string
  Canvas_Title: string
}

export interface SearchNodeHit {
  Node_Id: string
  Node_CanvasId: string
  Canvas_Title: string
  Snippet: string
}

export interface GlobalSearchDto {
  Canvases: SearchCanvasHit[]
  Nodes: SearchNodeHit[]
}

export interface TrashCanvasDto {
  Canvas_Id: string
  Canvas_Title: string
  DeletedAtUtc: string
  NodeCount: number
}

export interface TrashNodeDto {
  Node_Id: string
  Node_CanvasId: string
  Canvas_Title: string
  Snippet: string
  ContentPreview: string
  CreatedAtUtc: string
  DeletedAtUtc: string
}

export interface TrashListingDto {
  Canvases: TrashCanvasDto[]
  Nodes: TrashNodeDto[]
}

export interface SystemPromptDto {
  SystemPrompt_Id: string
  SystemPrompt_Title: string
  SystemPrompt_Content: string
  SystemPrompt_IsGlobal: boolean
}

export interface CategoryWithLinksDto {
  Category_Id: string
  Category_Name: string
  CanvasIds: string[]
  PromptIds: string[]
}

export interface EffectiveSystemPromptDto {
  SystemPrompt_Id: string
  Title: string
  Content: string
  Source: 'global' | 'category' | 'own' | string
  CategoryName?: string | null
}

export interface CanvasSystemConfigDto {
  CategoryIds: string[]
  OwnPromptIds: string[]
  Effective: EffectiveSystemPromptDto[]
}

export interface CanvasGraphDto {
  Canvas: CanvasDto
  Nodes: NodeDto[]
  Edges: EdgeDto[]
  InlineLinks: InlineLinkDto[]
  Highlights: HighlightDto[]
}

export interface ApiResponse<T> {
  Success: boolean
  Data: T
  Error?: string | null
}

export interface SseEvent {
  Seq: number
  Type: string
  Data: unknown
}
