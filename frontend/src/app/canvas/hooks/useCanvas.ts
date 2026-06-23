/**
 * useCanvas Hook — 管理單一畫布的資料狀態與 SSE 連接
 *
 * 功能：
 * - 載入畫布的完整圖譜（節點、邊、行內連結、亮點）
 * - 訂閱 SSE 事件流進行即時更新
 * - 提供節點、邊、行內連結、高亮的操作方法
 * - 支援 SSE 即時推播及 ask/askFollowup 流程
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import { logger } from '@/lib/logger'
import type { CanvasGraphDto, NodeDto, EdgeDto, InlineLinkDto, HighlightDto } from '../kaiwen-types'

export interface CanvasState {
  /**
   * 節點清單
   */
  nodes: NodeDto[]

  /**
   * 邊清單
   */
  edges: EdgeDto[]

  /**
   * 行內連結（選取文字產生的連結）
   */
  inlineLinks: InlineLinkDto[]

  /**
   * 亮點標記（選取文字的高亮）
   */
  highlights: HighlightDto[]

  /**
   * 正在進行中的操作（例：AI 生成）
   */
  pending: Set<string>

  /**
   * 錯誤訊息
   */
  error: string | null

  /**
   * 操作方法集合
   */
  actions: CanvasActions
}

export interface CanvasActions {
  /**
   * 新增節點
   */
  createNode: (params: {
    title?: string
    content?: string
    parentId?: string | null
    x: number
    y: number
    color?: string | null
  }) => Promise<NodeDto | null>

  /**
   * 更新節點內容
   */
  updateNodeContent: (nodeId: string, content: string) => Promise<void>

  /**
   * 更新節點佈局（位置、大小等）
   */
  updateNodeLayout: (nodeId: string, data: Record<string, unknown>) => Promise<void>

  /**
   * 刪除節點
   */
  deleteNode: (nodeId: string) => Promise<void>

  /**
   * 新增邊
   */
  createEdge: (params: {
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }) => Promise<EdgeDto | null>

  /**
   * 重新連接邊
   */
  reconnectEdge: (edgeId: string, params: {
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }) => Promise<void>

  /**
   * 刪除邊
   */
  deleteEdge: (edgeId: string) => Promise<void>

  /**
   * 新增行內連結（框選文字提問後）
   */
  createInlineLink: (params: {
    sourceNodeId: string
    anchorText: string
    anchorStart: number
    anchorEnd: number
    anchorPrefix: string
    anchorSuffix: string
    targetNodeId: string
  }) => Promise<InlineLinkDto | null>

  /**
   * 更新行內連結目標
   */
  updateInlineLinkTarget: (linkId: string, targetNodeId: string) => Promise<void>

  /**
   * 刪除行內連結
   */
  deleteInlineLink: (linkId: string) => Promise<void>

  /**
   * 新增高亮（畫重點）
   */
  createHighlight: (params: {
    nodeId: string
    anchorText: string
    start: number
    end: number
    anchorPrefix: string
    anchorSuffix: string
    color: string
  }) => Promise<HighlightDto | null>

  /**
   * 更新高亮顏色（畫重點後即時改色，不必刪除重畫）
   */
  updateHighlight: (highlightId: string, color: string) => Promise<void>

  /**
   * 刪除高亮
   */
  deleteHighlight: (highlightId: string) => Promise<void>

  /**
   * 對節點提問（觸發 AI）
   */
  ask: (nodeId: string, pos?: { x: number; y: number }) => Promise<void>

  /**
   * 跟進提問（框選文字提問）
   */
  askFollowup: (
    sourceNodeId: string,
    question: string,
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    pos?: { x: number; y: number }
  ) => Promise<void>

  /**
   * 設置節點的 AI 模型
   */
  setNodeModel: (nodeId: string, model: string) => Promise<void>

  /**
   * 中斷正在進行的 AI 提問
   */
  cancelAsk: (nodeId: string) => Promise<void>

  /**
   * 根據選定節點生成圖片
   */
  generateImage: (nodeId: string, imageModelKey?: string) => Promise<void>

  /**
   * 框選文字後發起提問（含行內連結與重點）
   */
  askInlineLink: (
    sourceNodeId: string,
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    question: string,
    pos?: { x: number; y: number }
  ) => Promise<void>

  /**
   * 畫重點（選取文字後）
   */
  addHighlight: (
    nodeId: string,
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    color: string
  ) => Promise<void>

  /**
   * 建立行內連結到現有節點
   */
  linkToNode: (
    sourceNodeId: string,
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    targetNodeId: string
  ) => Promise<void>

  /**
   * 框選文字後生成圖片
   */
  generateImageInline: (
    sourceNodeId: string,
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string
  ) => Promise<void>

  /**
   * 清除錯誤
   */
  clearError: () => void
}

/**
 * SSE 事件格式定義 — 節點相關事件
 */
export interface SseNodeEvent {
  Seq: number
  Type: 'NodeAdded' | 'NodeUpdated' | 'NodeDeleted'
  Data: NodeDto | { NodeId: string }
}

/**
 * SSE 事件格式定義 — 邊相關事件
 */
export interface SseEdgeEvent {
  Seq: number
  Type: 'EdgeAdded' | 'EdgeUpdated' | 'EdgeDeleted'
  Data: EdgeDto | { EdgeId: string }
}

/**
 * SSE 事件格式定義 — 行內連結相關事件
 */
export interface SseInlineLinkEvent {
  Seq: number
  Type: 'InlineLinkAdded' | 'InlineLinkUpdated' | 'InlineLinkDeleted'
  Data: InlineLinkDto | { InlineLinkId: string }
}

/**
 * SSE 事件格式定義 — 高亮相關事件
 */
export interface SseHighlightEvent {
  Seq: number
  Type: 'HighlightAdded' | 'HighlightDeleted'
  Data: HighlightDto | { HighlightId: string }
}

/**
 * SSE 事件格式定義 — AI 相關事件
 */
export interface SseAiEvent {
  Seq: number
  Type: 'AskStarted' | 'AskCompleted'
  Data: { NodeId: string }
}

/**
 * SSE 事件 — 所有事件類型的聯合
 */
export type SseEvent = SseNodeEvent | SseEdgeEvent | SseInlineLinkEvent | SseHighlightEvent | SseAiEvent

/**
 * 訂閱單一畫布的狀態與即時推播
 *
 * @param canvasId 畫布 ID（null 時不載入）
 * @param onNotification 推播事件回調
 * @returns 畫布狀態與操作方法
 */
export function useCanvas(
  canvasId: string | null,
  onNotification?: (message: string) => void
): CanvasState {
  const [nodes, setNodes] = useState<NodeDto[]>([])
  const [edges, setEdges] = useState<EdgeDto[]>([])
  const [inlineLinks, setInlineLinks] = useState<InlineLinkDto[]>([])
  const [highlights, setHighlights] = useState<HighlightDto[]>([])
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // SSE EventSource 參考
  const eventSourceRef = useRef<EventSource | null>(null)
  const sequenceRef = useRef(0)

  // 用 ref 保存通知回調：onNotification 由父層以 inline 函式傳入（每次重繪都是新參考），
  // 若讓 handleSseEvent 直接相依它，handleSseEvent 會每次重建 → 下方 SSE useEffect 不斷
  // 「關閉並重新訂閱 + 重抓整張圖(loadGraph)」→ 每隔幾秒整批節點重渲染（週期性閃爍 + 卡頓）。
  // 原版開問啦正是用此 ref 寫法讓 SSE 連線保持穩定。
  const notifyRef = useRef(onNotification)
  useEffect(() => {
    notifyRef.current = onNotification
  }, [onNotification])

  // 載入畫布圖譜
  const loadGraph = useCallback(async () => {
    if (!canvasId) return
    try {
      const graph = await kaiwenApi.getGraph(canvasId)
      setNodes(graph.Nodes)
      setEdges(graph.Edges)
      setInlineLinks(graph.InlineLinks)
      setHighlights(graph.Highlights)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : '無法載入畫布'
      setError(message)
      logger.error('Failed to load graph:', err)
    }
  }, [canvasId])

  /**
   * 處理 SSE 事件
   */
  const handleSseEvent = useCallback((evt: SseEvent) => {
    logger.log('SSE Event:', evt)
    sequenceRef.current = evt.Seq || sequenceRef.current

    switch (evt.Type) {
      // 節點事件
      case 'NodeAdded':
        {
          const node = evt.Data as NodeDto
          // 以 Node_Id 去重：本地樂觀新增與 SSE 廣播可能同時帶入同一筆。
          setNodes((prev) => (prev.some((n) => n.Node_Id === node.Node_Id) ? prev : [...prev, node]))
          notifyRef.current?.(`新增節點：${node.Node_Title || '(新)'}`)
        }
        break
      case 'NodeUpdated':
        {
          const node = evt.Data as NodeDto
          setNodes((prev) =>
            prev.map((n) => (n.Node_Id === node.Node_Id ? node : n))
          )
        }
        break
      case 'NodeDeleted':
        {
          const data = evt.Data as { NodeId: string }
          const nodeId = 'NodeId' in data ? data.NodeId : ''
          if (nodeId) {
            setNodes((prev) => prev.filter((n) => n.Node_Id !== nodeId))
            setEdges((prev) =>
              prev.filter((e) => e.Edge_SourceNodeId !== nodeId && e.Edge_TargetNodeId !== nodeId)
            )
            setInlineLinks((prev) => prev.filter((l) => l.InlineLink_SourceNodeId !== nodeId))
            setHighlights((prev) => prev.filter((h) => h.Highlight_NodeId !== nodeId))
          }
        }
        break

      // 邊事件
      case 'EdgeAdded':
        {
          const edge = evt.Data as EdgeDto
          setEdges((prev) => [...prev, edge])
        }
        break
      case 'EdgeUpdated':
        {
          const edge = evt.Data as EdgeDto
          setEdges((prev) =>
            prev.map((e) => (e.Edge_Id === edge.Edge_Id ? edge : e))
          )
        }
        break
      case 'EdgeDeleted':
        {
          const data = evt.Data as { EdgeId: string }
          const edgeId = 'EdgeId' in data ? data.EdgeId : ''
          if (edgeId) {
            setEdges((prev) => prev.filter((e) => e.Edge_Id !== edgeId))
          }
        }
        break

      // 行內連結事件
      case 'InlineLinkAdded':
        {
          const link = evt.Data as InlineLinkDto
          setInlineLinks((prev) => [...prev, link])
          notifyRef.current?.(`建立可點擊連結`)
        }
        break
      case 'InlineLinkUpdated':
        {
          const link = evt.Data as InlineLinkDto
          setInlineLinks((prev) =>
            prev.map((l) => (l.InlineLink_Id === link.InlineLink_Id ? link : l))
          )
        }
        break
      case 'InlineLinkDeleted':
        {
          const data = evt.Data as { InlineLinkId: string }
          const linkId = 'InlineLinkId' in data ? data.InlineLinkId : ''
          if (linkId) {
            setInlineLinks((prev) => prev.filter((l) => l.InlineLink_Id !== linkId))
          }
        }
        break

      // 高亮事件
      case 'HighlightAdded':
        {
          const highlight = evt.Data as HighlightDto
          setHighlights((prev) => [...prev, highlight])
          notifyRef.current?.(`畫重點`)
        }
        break
      case 'HighlightDeleted':
        {
          const data = evt.Data as { HighlightId: string }
          const highlightId = 'HighlightId' in data ? data.HighlightId : ''
          if (highlightId) {
            setHighlights((prev) => prev.filter((h) => h.Highlight_Id !== highlightId))
          }
        }
        break

      // AI 請求事件
      case 'AskStarted':
        {
          const data = evt.Data as { NodeId: string }
          const nodeId = 'NodeId' in data ? data.NodeId : ''
          if (nodeId) {
            setPending((prev) => new Set(prev).add(nodeId))
            notifyRef.current?.(`正在提問...`)
          }
        }
        break
      case 'AskCompleted':
        {
          const data = evt.Data as { NodeId: string }
          const nodeId = 'NodeId' in data ? data.NodeId : ''
          if (nodeId) {
            setPending((prev) => {
              const next = new Set(prev)
              next.delete(nodeId)
              return next
            })
            notifyRef.current?.(`提問完成`)
          }
        }
        break
    }
    // 透過 notifyRef 取用通知回調，故無需相依 onNotification → handleSseEvent 保持穩定
  }, [])

  // 訂閱 SSE 事件
  useEffect(() => {
    if (!canvasId) {
      // 關閉現有連接
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    // 初始載入
    loadGraph()

    // 訂閱 SSE（前端與 API 不同源，必須用後端絕對網址 + withCredentials 帶 cookie）
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5009'
    const url = `${apiBase}/api/canvas/sse/${encodeURIComponent(canvasId)}?afterSeq=${sequenceRef.current}`
    const eventSource = new EventSource(url, { withCredentials: true })

    eventSource.onmessage = (event) => {
      try {
        const evt = JSON.parse(event.data) as SseEvent
        handleSseEvent(evt)
      } catch (e) {
        logger.error('Failed to parse SSE event:', e)
      }
    }

    eventSource.onerror = () => {
      logger.error('SSE connection error')
      eventSource.close()
    }

    eventSourceRef.current = eventSource

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [canvasId, loadGraph, handleSseEvent])

  // 操作方法
  // 用 useMemo 讓 actions 物件「穩定」（只在 canvasId 改變時重建）。
  // 內部方法只用到 canvasId、kaiwenApi(穩定 import) 與函式式 setState(穩定)，
  // 不直接讀 state，故不會有 stale closure。原版開問啦同樣 memo 化 actions——
  // 若每次重繪都產生新 actions，會連鎖讓 CanvasView 的 buildData 重建、所有節點重渲染→卡頓。
  const actions: CanvasActions = useMemo<CanvasActions>(() => ({
    createNode: async (params) => {
      if (!canvasId) return null
      try {
        const node = await kaiwenApi.createNode(canvasId, {
          Title: params.title,
          Content: params.content,
          ParentId: params.parentId,
          X: params.x,
          Y: params.y,
          Color: params.color,
        })
        setError(null)
        // 樂觀加入本地狀態，立即顯示（不必等 SSE NodeAdded；若 SSE 隨後又帶同一筆，
        // NodeAdded 處理已用 Node_Id 去重，不會重複）。
        if (node?.Node_Id) {
          setNodes((prev) => (prev.some((n) => n.Node_Id === node.Node_Id) ? prev : [...prev, node]))
        }
        return node
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法新增節點'
        setError(message)
        return null
      }
    },

    updateNodeContent: async (nodeId: string, content: string) => {
      try {
        setPending((prev) => new Set(prev).add(nodeId))
        await kaiwenApi.updateNodeContent(nodeId, content)
        // 樂觀更新本地節點內容：不倚賴 SSE NodeUpdated 廣播（實測該廣播不一定回得來，
        // 會造成「編輯後需刷新才看得到內容」）。若稍後 SSE 仍送達，NodeUpdated 會以
        // 伺服器版本覆寫，結果一致（冪等）。
        setNodes((prev) =>
          prev.map((n) =>
            n.Node_Id === nodeId
              ? { ...n, Node_Content: content, Node_UpdatedDateTime: new Date().toISOString() }
              : n
          )
        )
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法更新節點'
        setError(message)
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    },

    updateNodeLayout: async (nodeId: string, data: Record<string, unknown>) => {
      try {
        await kaiwenApi.updateNodeLayout(nodeId, data)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法更新節點佈局'
        setError(message)
      }
    },

    deleteNode: async (nodeId: string) => {
      try {
        await kaiwenApi.deleteNode(nodeId)
        setNodes((prev) => prev.filter((n) => n.Node_Id !== nodeId))
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法刪除節點'
        setError(message)
      }
    },

    createEdge: async (params) => {
      if (!canvasId) return null
      try {
        const edge = await kaiwenApi.createEdge(canvasId, {
          SourceNodeId: params.sourceNodeId,
          TargetNodeId: params.targetNodeId,
          SourceHandle: params.sourceHandle,
          TargetHandle: params.targetHandle,
        })
        setError(null)
        return edge
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法新增邊'
        setError(message)
        return null
      }
    },

    reconnectEdge: async (edgeId: string, params) => {
      try {
        await kaiwenApi.reconnectEdge(edgeId, {
          SourceNodeId: params.sourceNodeId,
          TargetNodeId: params.targetNodeId,
          SourceHandle: params.sourceHandle,
          TargetHandle: params.targetHandle,
        })
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法重新連接邊'
        setError(message)
      }
    },

    deleteEdge: async (edgeId: string) => {
      try {
        await kaiwenApi.deleteEdge(edgeId)
        setEdges((prev) => prev.filter((e) => e.Edge_Id !== edgeId))
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法刪除邊'
        setError(message)
      }
    },

    createInlineLink: async (params) => {
      if (!canvasId) return null
      try {
        const link = await kaiwenApi.createInlineLink(canvasId, {
          SourceNodeId: params.sourceNodeId,
          AnchorText: params.anchorText,
          AnchorStart: params.anchorStart,
          AnchorEnd: params.anchorEnd,
          AnchorPrefix: params.anchorPrefix,
          AnchorSuffix: params.anchorSuffix,
          TargetNodeId: params.targetNodeId,
        })
        // 樂觀加入本地狀態（避免「連結到節點後要刷新才看得到可點擊連結」）。以 Id 去重。
        if (link?.InlineLink_Id) {
          setInlineLinks((prev) =>
            prev.some((l) => l.InlineLink_Id === link.InlineLink_Id) ? prev : [...prev, link]
          )
        }
        setError(null)
        return link
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法建立行內連結'
        setError(message)
        return null
      }
    },

    updateInlineLinkTarget: async (linkId: string, targetNodeId: string) => {
      try {
        await kaiwenApi.updateInlineLinkTarget(linkId, targetNodeId)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法更新連結目標'
        setError(message)
      }
    },

    deleteInlineLink: async (linkId: string) => {
      try {
        await kaiwenApi.deleteInlineLink(linkId)
        setInlineLinks((prev) => prev.filter((l) => l.InlineLink_Id !== linkId))
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法刪除連結'
        setError(message)
      }
    },

    createHighlight: async (params) => {
      try {
        const highlight = await kaiwenApi.createHighlight(params.nodeId, {
          AnchorText: params.anchorText,
          Start: params.start,
          End: params.end,
          AnchorPrefix: params.anchorPrefix,
          AnchorSuffix: params.anchorSuffix,
          Color: params.color,
        })
        // 樂觀加入本地狀態：後端 CreateHighlight 不廣播 SSE，且本地原本未更新，
        // 導致「選色後畫面沒反應、要刷新才看得到重點」（畫重點看似失效）。以 Id 去重。
        if (highlight?.Highlight_Id) {
          setHighlights((prev) =>
            prev.some((h) => h.Highlight_Id === highlight.Highlight_Id)
              ? prev
              : [...prev, highlight]
          )
        }
        setError(null)
        return highlight
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法畫重點'
        setError(message)
        return null
      }
    },

    updateHighlight: async (highlightId: string, color: string) => {
      // 樂觀更新顏色（即時可見）；失敗則回報錯誤。後端 PATCH /highlights/{id}。
      setHighlights((prev) =>
        prev.map((h) => (h.Highlight_Id === highlightId ? { ...h, Highlight_Color: color } : h))
      )
      try {
        await kaiwenApi.updateHighlight(highlightId, color)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法更新重點顏色'
        setError(message)
      }
    },

    deleteHighlight: async (highlightId: string) => {
      try {
        await kaiwenApi.deleteHighlight(highlightId)
        setHighlights((prev) => prev.filter((h) => h.Highlight_Id !== highlightId))
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法刪除重點'
        setError(message)
      }
    },

    ask: async (nodeId: string, pos?: { x: number; y: number }) => {
      if (!canvasId) return
      try {
        setPending((prev) => new Set(prev).add(nodeId))
        await kaiwenApi.ask(canvasId, nodeId, pos)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法提問'
        setError(message)
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    },

    askFollowup: async (
      sourceNodeId: string,
      question: string,
      anchorText: string,
      start: number,
      end: number,
      prefix: string,
      suffix: string,
      pos?: { x: number; y: number }
    ) => {
      if (!canvasId) return
      try {
        setPending((prev) => new Set(prev).add(sourceNodeId))
        await kaiwenApi.askFollowup(canvasId, sourceNodeId, question, pos)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法跟進提問'
        setError(message)
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(sourceNodeId)
          return next
        })
      }
    },

    setNodeModel: async (nodeId: string, model: string) => {
      try {
        await kaiwenApi.setNodeModel(nodeId, model)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法設置模型'
        setError(message)
      }
    },

    cancelAsk: async (nodeId: string) => {
      if (!canvasId) return
      try {
        await kaiwenApi.cancelAsk(canvasId, nodeId)
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法中斷提問'
        setError(message)
      }
    },

    generateImage: async (nodeId: string, imageModelKey?: string) => {
      if (!canvasId) return
      try {
        setPending((prev) => new Set(prev).add(nodeId))
        await kaiwenApi.generateImage(canvasId, nodeId, imageModelKey)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法生成圖片'
        setError(message)
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    },

    askInlineLink: async (
      sourceNodeId: string,
      anchorText: string,
      start: number,
      end: number,
      prefix: string,
      suffix: string,
      question: string,
      pos?: { x: number; y: number }
    ) => {
      if (!canvasId) return
      try {
        // 改走後端「框選提問」單一端點：後端會一次建立「回答節點 + 行內連結 + 連線」，
        // 並以「節點完整內容 + 祖先脈絡 + 框選文字」組 Prompt。
        // （舊版在前端手動 createNode + createInlineLink + askFollowup，會：
        //   ① 留下一個空的「回答」孤節點；② askFollowup 只送問題、缺框選脈絡；③ 沒有連線。）
        // 回答節點與連線會經由 SSE（NodeAdded / EdgeAdded / AskStarted）即時帶回並更新畫布。
        await kaiwenApi.askInlineLink(canvasId, {
          SourceNodeId: sourceNodeId,
          AnchorText: anchorText,
          AnchorStart: start,
          AnchorEnd: end,
          AnchorPrefix: prefix,
          AnchorSuffix: suffix,
          Question: question,
          X: pos?.x ?? null,
          Y: pos?.y ?? null,
        })

        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法發起提問'
        setError(message)
      }
    },

    addHighlight: async (
      nodeId: string,
      anchorText: string,
      start: number,
      end: number,
      prefix: string,
      suffix: string,
      color: string
    ) => {
      try {
        const highlight = await kaiwenApi.createHighlight(nodeId, {
          AnchorText: anchorText,
          Start: start,
          End: end,
          AnchorPrefix: prefix,
          AnchorSuffix: suffix,
          Color: color,
        })
        // 樂觀加入本地狀態（後端不廣播 HighlightAdded SSE；以 Id 去重）。
        if (highlight?.Highlight_Id) {
          setHighlights((prev) =>
            prev.some((h) => h.Highlight_Id === highlight.Highlight_Id)
              ? prev
              : [...prev, highlight]
          )
        }
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法畫重點'
        setError(message)
      }
    },

    linkToNode: async (
      sourceNodeId: string,
      anchorText: string,
      start: number,
      end: number,
      prefix: string,
      suffix: string,
      targetNodeId: string
    ) => {
      if (!canvasId) return
      try {
        await kaiwenApi.createInlineLink(canvasId, {
          SourceNodeId: sourceNodeId,
          AnchorText: anchorText,
          AnchorStart: start,
          AnchorEnd: end,
          AnchorPrefix: prefix,
          AnchorSuffix: suffix,
          TargetNodeId: targetNodeId,
        })
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法建立連結'
        setError(message)
      }
    },

    generateImageInline: async (
      sourceNodeId: string,
      anchorText: string,
      start: number,
      end: number,
      prefix: string,
      suffix: string
    ) => {
      if (!canvasId) return
      try {
        // 先新建圖片節點
        const newNode = await kaiwenApi.createNode(canvasId, {
          Title: '圖片',
          Content: anchorText,
          ParentId: sourceNodeId,
          X: 0,
          Y: 0,
        })

        if (!newNode) return

        // 建立行內連結
        await kaiwenApi.createInlineLink(canvasId, {
          SourceNodeId: sourceNodeId,
          AnchorText: anchorText,
          AnchorStart: start,
          AnchorEnd: end,
          AnchorPrefix: prefix,
          AnchorSuffix: suffix,
          TargetNodeId: newNode.Node_Id,
        })

        // 生成圖片
        setPending((prev) => new Set(prev).add(newNode.Node_Id))
        await kaiwenApi.generateImage(canvasId, newNode.Node_Id)

        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : '無法生成圖片'
        setError(message)
      }
    },

    clearError: () => setError(null),
  }), [canvasId])

  return {
    nodes,
    edges,
    inlineLinks,
    highlights,
    pending,
    error,
    actions,
  }
}
