/**
 * KaiWen API 客戶端 — 適配 ZonWiki 後端
 *
 * 所有寫入透過此處 → 後端經 SSE 廣播 → 開著的畫布即時更新。
 * 基礎 URL：/api/canvas（已內建於 ZonWiki 後端）
 */

import type {
  AiModelConfigDto,
  AiModelDto,
  ApiResponse,
  CanvasAnnotationDto,
  CanvasDto,
  CanvasGraphDto,
  CanvasSystemConfigDto,
  CategoryWithLinksDto,
  EdgeDto,
  GlobalSearchDto,
  HealthStateDto,
  HighlightDto,
  InlineLinkDto,
  NodeDto,
  NodeRevisionDto,
  SystemPromptDto,
  TrashListingDto,
} from './kaiwen-types'

// 前端(3000)與 API(5009)為不同來源，畫布 API 必須打到後端絕對網址，不能用相對路徑
// （相對路徑會打到 Next 前端而得到 404 的 HTML，造成 JSON 解析失敗 + 無限重試錯誤風暴）。
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5009'
const BASE = `${API_BASE}/api/canvas`

/**
 * 通用 HTTP 客戶端
 * 自動處理 ApiResponse 包裝與錯誤
 */
async function http<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include', // 允許 cookie auth
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  // 先讀成文字再決定是否解析：DELETE 等端點回 204 No Content（空 body），
  // 直接呼叫 res.json() 會丟「Unexpected end of JSON input」，害呼叫端誤判失敗、
  // 樂觀更新被跳過 → 出現「刪除成功卻要刷新才看得到」（畫布/節點刪除皆然）。
  const text = await res.text()
  if (!text) {
    if (!res.ok) {
      throw new Error(res.statusText)
    }
    // 空 body 視為成功（無資料可回傳）。
    return undefined as T
  }

  const json = JSON.parse(text) as ApiResponse<T>
  if (!res.ok || !json.Success) {
    throw new Error(json.Error ?? res.statusText)
  }
  return json.Data
}

/**
 * KaiWen REST API 客戶端
 */
export const kaiwenApi = {
  // 可用模型清單（不含金鑰）
  listModels: () => http<AiModelDto[]>('GET', '/models'),

  // 畫布 CRUD
  listCanvases: () => http<CanvasDto[]>('GET', '/canvases'),
  createCanvas: (title: string) =>
    http<CanvasDto>('POST', '/canvases', { Title: title }),
  renameCanvas: (canvasId: string, title: string) =>
    http<CanvasDto>('PUT', `/canvases/${encodeURIComponent(canvasId)}`, { Title: title }),
  deleteCanvas: (canvasId: string) =>
    http<unknown>('DELETE', `/canvases/${encodeURIComponent(canvasId)}`),

  // 取得畫布完整圖譜資料（節點 + 邊 + 行內連結 + 亮點）
  getGraph: (canvasId: string) =>
    http<CanvasGraphDto>('GET', `/canvases/${encodeURIComponent(canvasId)}`),

  // 全域搜尋
  searchAll: (query: string) =>
    http<GlobalSearchDto>('GET', `/search?query=${encodeURIComponent(query)}`),

  // 節點 CRUD
  createNode: (
    canvasId: string,
    body: {
      Title?: string
      Content?: string
      ParentId?: string | null
      X: number
      Y: number
      Color?: string | null
    }
  ) => http<NodeDto>('POST', `/canvases/${encodeURIComponent(canvasId)}/nodes`, body),

  updateNodeLayout: (nodeId: string, body: Record<string, unknown>) =>
    http<NodeDto>('PATCH', `/nodes/${encodeURIComponent(nodeId)}`, body),

  updateNodeContent: (nodeId: string, content: string) =>
    http<NodeDto>('PUT', `/nodes/${encodeURIComponent(nodeId)}/content`, { Content: content }),

  setNodeModel: (nodeId: string, model: string) =>
    http<NodeDto>('PUT', `/nodes/${encodeURIComponent(nodeId)}/model`, { Model: model }),

  deleteNode: (nodeId: string) =>
    http<unknown>('DELETE', `/nodes/${encodeURIComponent(nodeId)}`),

  listRevisions: (nodeId: string) =>
    http<NodeRevisionDto[]>('GET', `/nodes/${encodeURIComponent(nodeId)}/revisions`),

  // 邊 CRUD
  createEdge: (
    canvasId: string,
    body: {
      SourceNodeId: string
      TargetNodeId: string
      SourceHandle?: string | null
      TargetHandle?: string | null
    }
  ) => http<EdgeDto>('POST', `/canvases/${encodeURIComponent(canvasId)}/edges`, body),

  reconnectEdge: (
    edgeId: string,
    body: {
      SourceNodeId: string
      TargetNodeId: string
      SourceHandle?: string | null
      TargetHandle?: string | null
    }
  ) => http<EdgeDto>('PATCH', `/edges/${encodeURIComponent(edgeId)}`, body),

  deleteEdge: (edgeId: string) =>
    http<unknown>('DELETE', `/edges/${encodeURIComponent(edgeId)}`),

  // 行內連結管理
  createInlineLink: (
    canvasId: string,
    body: {
      SourceNodeId: string
      AnchorText: string
      AnchorStart: number
      AnchorEnd: number
      AnchorPrefix: string
      AnchorSuffix: string
      TargetNodeId: string
    }
  ) => http<InlineLinkDto>('POST', `/canvases/${encodeURIComponent(canvasId)}/inline-links`, body),

  updateInlineLinkTarget: (linkId: string, targetNodeId: string) =>
    http<InlineLinkDto>('PATCH', `/inline-links/${encodeURIComponent(linkId)}`, { TargetNodeId: targetNodeId }),

  deleteInlineLink: (linkId: string) =>
    http<unknown>('DELETE', `/inline-links/${encodeURIComponent(linkId)}`),

  // 高亮管理
  createHighlight: (
    nodeId: string,
    body: {
      AnchorText: string
      Start: number
      End: number
      AnchorPrefix: string
      AnchorSuffix: string
      Color: string
    }
  ) => http<HighlightDto>('POST', `/nodes/${encodeURIComponent(nodeId)}/highlights`, body),

  updateHighlight: (highlightId: string, color: string) =>
    http<HighlightDto>('PATCH', `/highlights/${encodeURIComponent(highlightId)}`, { Color: color }),

  deleteHighlight: (highlightId: string) =>
    http<unknown>('DELETE', `/highlights/${encodeURIComponent(highlightId)}`),

  // AI 功能（對話）
  ask: (canvasId: string, askFromNodeId: string, pos?: { x: number; y: number }) =>
    http<unknown>('POST', `/canvases/${encodeURIComponent(canvasId)}/ask`, {
      AskFromNodeId: askFromNodeId,
      X: pos?.x ?? null,
      Y: pos?.y ?? null,
    }),

  askFollowup: (
    canvasId: string,
    fromNodeId: string,
    question: string,
    pos?: { x: number; y: number }
  ) =>
    http<unknown>('POST', `/canvases/${encodeURIComponent(canvasId)}/ask-followup`, {
      FromNodeId: fromNodeId,
      Question: question,
      X: pos?.x ?? null,
      Y: pos?.y ?? null,
    }),

  // 框選文字提問：後端會建立「回答節點 + 行內連結 + 連線」，並用「節點完整內容 + 祖先脈絡 + 框選文字」
  // 組 Prompt（比 askFollowup 只送問題的脈絡更完整）。
  askInlineLink: (
    canvasId: string,
    body: {
      SourceNodeId: string
      AnchorText: string
      AnchorStart: number
      AnchorEnd: number
      AnchorPrefix: string
      AnchorSuffix: string
      Question: string
      X?: number | null
      Y?: number | null
    }
  ) =>
    http<unknown>('POST', `/canvases/${encodeURIComponent(canvasId)}/ask-inline-link`, body),

  cancelAsk: (canvasId: string, nodeId: string) =>
    http<unknown>('POST', `/canvases/${encodeURIComponent(canvasId)}/cancel`, { NodeId: nodeId }),

  // AI 功能（生圖）
  generateImage: (
    canvasId: string,
    sourceNodeId: string,
    imageModelKey?: string,
    pos?: { x: number; y: number }
  ) =>
    http<unknown>('POST', `/canvases/${encodeURIComponent(canvasId)}/generate-image`, {
      SourceNodeId: sourceNodeId,
      Prompt: null,
      ImageModelKey: imageModelKey ?? null,
      X: pos?.x ?? null,
      Y: pos?.y ?? null,
    }),

  // 模型設定編輯
  getModelsConfig: () => http<AiModelConfigDto[]>('GET', '/models-config'),
  saveModelsConfig: (models: AiModelConfigDto[]) =>
    http<AiModelConfigDto[]>('PUT', '/models-config', { Models: models }),

  // 模型健檢
  getHealth: () => http<HealthStateDto>('GET', '/health'),
  setHealthEnabled: (enabled: boolean) =>
    http<{ Enabled: boolean }>('PUT', '/health/enabled', { Enabled: enabled }),
  checkHealthNow: () => http<unknown>('POST', '/health/check'),

  // 垃圾桶
  getTrash: () => http<TrashListingDto>('GET', '/trash'),
  restoreCanvas: (canvasId: string) =>
    http<unknown>('POST', `/trash/canvas/${encodeURIComponent(canvasId)}/restore`),
  restoreNode: (nodeId: string) =>
    http<unknown>('POST', `/trash/node/${encodeURIComponent(nodeId)}/restore`),
  purgeCanvas: (canvasId: string) =>
    http<unknown>('DELETE', `/trash/canvas/${encodeURIComponent(canvasId)}`),
  purgeNode: (nodeId: string) =>
    http<unknown>('DELETE', `/trash/node/${encodeURIComponent(nodeId)}`),
  emptyTrash: () => http<unknown>('DELETE', '/trash'),

  // System Prompt
  listSystemPrompts: () => http<SystemPromptDto[]>('GET', '/system-prompts'),
  createSystemPrompt: (body: {
    Title: string
    Content: string
    IsGlobal: boolean
  }) => http<SystemPromptDto>('POST', '/system-prompts', body),
  updateSystemPrompt: (
    id: string,
    body: { Title: string; Content: string; IsGlobal: boolean }
  ) => http<SystemPromptDto>('PUT', `/system-prompts/${encodeURIComponent(id)}`, body),
  deleteSystemPrompt: (id: string) =>
    http<unknown>('DELETE', `/system-prompts/${encodeURIComponent(id)}`),

  // 分類管理
  listCategories: () => http<CategoryWithLinksDto[]>('GET', '/categories'),
  createCategory: (name: string) =>
    http<unknown>('POST', '/categories', { Name: name }),
  renameCategory: (id: string, name: string) =>
    http<unknown>('PUT', `/categories/${encodeURIComponent(id)}`, { Name: name }),
  deleteCategory: (id: string) =>
    http<unknown>('DELETE', `/categories/${encodeURIComponent(id)}`),
  setCategoryCanvases: (id: string, ids: string[]) =>
    http<unknown>('PUT', `/categories/${encodeURIComponent(id)}/canvases`, { Ids: ids }),
  setCategoryPrompts: (id: string, ids: string[]) =>
    http<unknown>('PUT', `/categories/${encodeURIComponent(id)}/prompts`, { Ids: ids }),

  // 畫布系統設定
  getCanvasSystem: (canvasId: string) =>
    http<CanvasSystemConfigDto>('GET', `/canvases/${encodeURIComponent(canvasId)}/system`),
  setCanvasCategories: (canvasId: string, ids: string[]) =>
    http<unknown>('PUT', `/canvases/${encodeURIComponent(canvasId)}/categories`, { Ids: ids }),
  setCanvasOwnPrompts: (canvasId: string, ids: string[]) =>
    http<unknown>('PUT', `/canvases/${encodeURIComponent(canvasId)}/system-prompts`, { Ids: ids }),

  // 畫布標註（便利貼 / 塗鴉 / 圖片板）— 與筆記浮層對等，座標為畫布座標 (flow coords)
  listCanvasAnnotations: (canvasId: string) =>
    http<CanvasAnnotationDto[]>('GET', `/canvases/${encodeURIComponent(canvasId)}/annotations`),
  createCanvasAnnotation: (
    canvasId: string,
    body: {
      Kind: 'sticky' | 'drawing' | 'slide' | 'text'
      X: number
      Y: number
      Width: number
      Height: number
      ZIndex: number
      Color?: string | null
      Text?: string | null
      DataJson?: string | null
    }
  ) => http<CanvasAnnotationDto>('POST', `/canvases/${encodeURIComponent(canvasId)}/annotations`, body),
  updateCanvasAnnotation: (
    annotationId: string,
    patch: {
      X?: number
      Y?: number
      Width?: number
      Height?: number
      ZIndex?: number
      Color?: string | null
      Text?: string | null
      DataJson?: string | null
    }
  ) => http<CanvasAnnotationDto>('PATCH', `/annotations/${encodeURIComponent(annotationId)}`, patch),
  deleteCanvasAnnotation: (annotationId: string) =>
    http<unknown>('DELETE', `/annotations/${encodeURIComponent(annotationId)}`),
}
