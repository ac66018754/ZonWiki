/**
 * 畫布視圖 — React Flow 畫布與互動
 *
 * 功能：
 * - 顯示節點與邊
 * - 支援拖曳、連線、編輯
 * - 文本選取標註
 * - 簡略地圖、縮放控制
 * - 右側編輯面板
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type Node as RfNode,
} from '@xyflow/react'
// React Flow 基礎樣式：缺少時小地圖會撐成滿版、節點量測失效(useNodesInitialized 永遠 false)、
// 容器尺寸異常。移植開問啦時漏掉了這個必要的匯入，於此補回。
import '@xyflow/react/dist/style.css'
import type { CanvasActions } from '../hooks/useCanvas'
import type { AiModelDto, EdgeDto, HighlightDto, InlineLinkDto, NodeDto } from '../kaiwen-types'
import { QaNode, NODE_MIN_WIDTH, type QaNodeData } from './QaNode'
import { edgeTypes } from './DeletableEdge'
import { RightDrawer } from './RightDrawer'
import { SelectionPopover } from './SelectionPopover'
import { LeftSidebar } from './LeftSidebar'
import { CanvasAnnotationLayer } from './CanvasAnnotationLayer'

/**
 * 畫布視圖 Props
 */
interface CanvasViewProps {
  /** 畫布 ID */
  canvasId: string
  /** 節點對映（Node_Id -> NodeDto） */
  nodes: Record<string, NodeDto>
  /** 邊對映（Edge_Id -> EdgeDto） */
  edges: Record<string, EdgeDto>
  /** 行內連結對映 */
  inlineLinks: Record<string, InlineLinkDto>
  /** 高亮對映 */
  highlights: Record<string, HighlightDto>
  /** 待處理操作（nodeId -> true） */
  pending: Record<string, true>
  /** AI 模型列表 */
  models: AiModelDto[]
  /** 搜尋跳轉目標節點 ID */
  focusNodeId?: string | null
  /** 搜尋完成回調 */
  onFocusHandled?: () => void
  /** 目前選中節點 */
  currentNodeId?: string | null
  /** 是否閱覽模式（切入時自動置中） */
  readingMode?: boolean
  /** 節點聚焦回調 */
  onNodeFocus?: (id: string) => void
  /** 操作方法集合 */
  actions: CanvasActions
  /** 滾輪平移模式 */
  panOnScroll?: boolean
  /** 當前主題 */
  theme?: 'warmpaper' | 'light' | 'dark' | 'night'
  /** 當前時區 */
  timezone?: string
}

/**
 * 節點類型註冊表
 */
const nodeTypes = { qa: QaNode }

/**
 * 縮放限制
 */
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3

/**
 * 自訂縮放控制
 * 提供 ＋ / － / 百分比輸入框
 */
function ZoomControl() {
  const { zoom } = useViewport()
  const { zoomIn, zoomOut, zoomTo } = useReactFlow()
  const [draft, setDraft] = useState<string | null>(null)
  const pct = Math.round(zoom * 100)

  const apply = (raw: string) => {
    const n = parseInt(raw.replace(/[^0-9]/g, ''), 10)
    if (!Number.isNaN(n)) {
      const clamped = Math.max(MIN_ZOOM * 100, Math.min(MAX_ZOOM * 100, n))
      zoomTo(clamped / 100, { duration: 200 })
    }
    setDraft(null)
  }

  const btn = 'px-2 py-1 text-sm text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]'

  return (
    <div className="absolute bottom-4 left-4 z-10 flex w-12 flex-col items-stretch overflow-hidden rounded-md border border-[var(--kw-border)] bg-[var(--kw-surface)] shadow">
      <button
        className={`${btn} border-b border-[var(--kw-border)]`}
        onClick={() => zoomIn({ duration: 200 })}
        title="放大"
      >
        ＋
      </button>
      <button
        className={`${btn} border-b border-[var(--kw-border)]`}
        onClick={() => zoomOut({ duration: 200 })}
        title="縮小"
      >
        －
      </button>
      <input
        className="w-full bg-transparent px-1 py-1 text-center text-xs text-[var(--kw-text)] outline-none focus:bg-[var(--kw-surface-2)]"
        value={draft !== null ? draft : `${pct}%`}
        inputMode="numeric"
        title="縮放百分比（可直接輸入，如 25 或 300）"
        data-testid="zoom-input"
        onFocus={(e) => {
          setDraft(String(pct))
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

/**
 * 取得內容片段（節點清單時顯示）
 */
function snippet(content: string): string {
  const c = content.trim() || '(空白節點)'
  return c.length > 18 ? c.slice(0, 18) + '…' : c
}

/**
 * 畫布視圖內部實作
 * 需包裹在 ReactFlowProvider 中
 */
function CanvasInner({
  canvasId,
  nodes,
  edges,
  inlineLinks,
  highlights,
  pending,
  models,
  focusNodeId,
  onFocusHandled,
  currentNodeId,
  readingMode,
  onNodeFocus,
  actions,
  panOnScroll,
  theme,
  timezone,
}: CanvasViewProps) {
  // React Flow 狀態
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<any>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { screenToFlowPosition, setCenter, getNodes, getViewport } = useReactFlow()

  // 本地互動狀態
  const [spotlightEdgeId, setSpotlightEdgeId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 右側編輯面板狀態
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 標註層是否正在使用繪圖工具：true 時鎖住畫布平移/縮放/選取，避免一邊畫一邊移動。
  const [annoDrawing, setAnnoDrawing] = useState(false)

  // 文字選取狀態
  const [selection, setSelection] = useState<{
    nodeId: string
    text: string
    start: number
    end: number
    prefix: string
    suffix: string
    rect: DOMRect
  } | null>(null)

  /**
   * 將高亮對映按節點分組
   */
  const highlightsByNode = useMemo((): Record<string, HighlightDto[]> => {
    const m: Record<string, HighlightDto[]> = {}
    for (const h of Object.values(highlights)) {
      (m[h.Highlight_NodeId] ??= []).push(h)
    }
    return m
  }, [highlights])

  /**
   * 將連結對映按來源節點分組
   */
  const linksBySource = useMemo((): Record<string, InlineLinkDto[]> => {
    const m: Record<string, InlineLinkDto[]> = {}
    for (const l of Object.values(inlineLinks)) {
      (m[l.InlineLink_SourceNodeId] ??= []).push(l)
    }
    return m
  }, [inlineLinks])

  /**
   * 節點選項列表（用於行內連結目標選擇）
   */
  const nodeOptionsAll = useMemo(
    () => Object.values(nodes).map((n: NodeDto) => ({ id: n.Node_Id, label: snippet(n.Node_Content) })),
    [nodes]
  )

  /**
   * 聚光邊兩端的節點 ID
   */
  const spotlightNodeIds = useMemo((): Set<string> => {
    const e = spotlightEdgeId ? edges[spotlightEdgeId] : null
    return e ? new Set<string>([e.Edge_SourceNodeId, e.Edge_TargetNodeId]) : new Set<string>()
  }, [spotlightEdgeId, edges])

  /**
   * 平移到某個節點（帶動畫）
   */
  const navigateTo = useCallback(
    (nodeId: string) => {
      const n = nodes[nodeId]
      if (n) setCenter(n.Node_X + 150, n.Node_Y + 70, { zoom: 1, duration: 400 })
    },
    [nodes, setCenter]
  )

  /**
   * 地圖點擊：平移到該位置（維持目前縮放）
   */
  const onMinimapClick = useCallback(
    (_event: unknown, position: { x: number; y: number }) => {
      setCenter(position.x, position.y, { zoom: getViewport().zoom, duration: 400 })
    },
    [setCenter, getViewport]
  )

  /**
   * 搜尋跳轉：當節點已載入，置中並選取
   */
  useEffect(() => {
    if (focusNodeId && nodes[focusNodeId]) {
      navigateTo(focusNodeId)
      setSelectedId(focusNodeId)
      onFocusHandled?.()
    }
  }, [focusNodeId, nodes, navigateTo, onFocusHandled])

  /**
   * 閱覽模式：自動置中到目前節點
   * 使用 rAF 避開 fitView 的競態
   */
  const nodesInitialized = useNodesInitialized()
  const centeredForReading = useRef(false)

  useEffect(() => {
    if (!readingMode) {
      centeredForReading.current = false
      return
    }
    if (centeredForReading.current || !nodesInitialized) return
    if (!currentNodeId || !nodes[currentNodeId]) return

    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      navigateTo(currentNodeId)
      centeredForReading.current = true
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [readingMode, currentNodeId, nodes, navigateTo, nodesInitialized])

  /**
   * 首次進場置中：畫布資料是非同步載入的，React Flow 的 fitView prop 只會在初次掛載
   * （此時還沒有節點）執行一次，導致節點載入後停在畫面外。
   * 由於大綱型資料可能高達上萬像素，直接 fitView 會被壓到最小縮放(10%)而看不清，
   * 因此改為以可讀縮放置中到「最上方(根)節點」，使用者落地即可看到清楚內容，再自行縮放總覽。
   */
  const didInitialFit = useRef(false)
  useEffect(() => {
    if (didInitialFit.current) return
    if (rfNodes.length === 0) return

    // 以重試方式置中到最上方節點：
    // 1) 不依賴 useNodesInitialized（實測在本情境可能一直為 false 而永不觸發）。
    // 2) 等到節點確實有有效座標、且容器尺寸（側欄隱藏/滿版等版面調整）穩定後再置中，
    //    因為 setCenter 依「呼叫當下」的容器尺寸計算，太早呼叫會以過時(較窄)尺寸置中而偏左。
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const tryCenter = () => {
      const positioned = getNodes().filter(
        (node) => node.position && Number.isFinite(node.position.y)
      )
      if (positioned.length === 0) {
        if (attempts++ < 12) timer = setTimeout(tryCenter, 150)
        return
      }
      // 取 Y 座標最小者作為進場焦點（通常是大綱的根節點）
      const topNode = positioned.reduce((highest, node) =>
        node.position.y <= highest.position.y ? node : highest
      )
      const nodeWidth = topNode.measured?.width ?? topNode.width ?? 200
      const nodeHeight = topNode.measured?.height ?? topNode.height ?? 80
      setCenter(
        topNode.position.x + nodeWidth / 2,
        topNode.position.y + nodeHeight / 2,
        { zoom: 0.9, duration: 400 }
      )
      didInitialFit.current = true
    }
    timer = setTimeout(tryCenter, 300)
    return () => clearTimeout(timer)
  }, [rfNodes.length, getNodes, setCenter])

  /**
   * 行內連結點擊：跳轉到目標節點
   */
  const onLinkClick = useCallback(
    (linkId: string) => {
      const link = inlineLinks[linkId]
      if (link) navigateTo(link.InlineLink_TargetNodeId)
    },
    [inlineLinks, navigateTo]
  )

  /**
   * 計算新子節點位置
   * 放在父節點下方，向右避開既有節點
   */
  const childPosition = useCallback(
    (parentId: string): { x: number; y: number } | undefined => {
      const all = getNodes()
      const parent = all.find((n) => n.id === parentId)
      if (!parent) return undefined

      const widthOf = (n: RfNode) => n.measured?.width ?? (n.width as number | undefined) ?? NODE_MIN_WIDTH
      const heightOf = (n: RfNode) => n.measured?.height ?? (n.height as number | undefined) ?? 160

      const GAP_Y = 60
      const STEP_X = NODE_MIN_WIDTH + 48
      const candW = NODE_MIN_WIDTH
      const candH = 220

      const y = parent.position.y + heightOf(parent) + GAP_Y
      const others = all.filter((n) => n.id !== parentId)

      const overlaps = (x: number) =>
        others.some(
          (o) =>
            x < o.position.x + widthOf(o) &&
            x + candW > o.position.x &&
            y < o.position.y + heightOf(o) &&
            y + candH > o.position.y
        )

      let x = parent.position.x
      let guard = 0
      while (overlaps(x) && guard++ < 60) x += STEP_X

      return { x, y }
    },
    [getNodes]
  )

  /**
   * 構建節點資料
   */
  const buildData = useCallback(
    (node: NodeDto): QaNodeData => ({
      node,
      highlights: highlightsByNode[node.Node_Id] ?? [],
      links: linksBySource[node.Node_Id] ?? [],
      spotlight: spotlightNodeIds.has(node.Node_Id),
      pending: !!pending[node.Node_Id],
      nodeOptions: nodeOptionsAll.filter((o) => o.id !== node.Node_Id),
      modelOptions: models.filter((m) => m.Kind !== 'image'),
      timezone: timezone || 'UTC',
      onAsk: () => actions.ask(node.Node_Id, childPosition(node.Node_Id)),
      onFollowup: (question) =>
        actions.askFollowup(
          node.Node_Id,
          question,
          '',
          0,
          0,
          '',
          '',
          childPosition(node.Node_Id)
        ),
      onCancel: () =>
        // TODO: 實作 cancelAsk
        console.log('Cancel ask'),
      onSetModel: (model) => actions.setNodeModel(node.Node_Id, model),
      onGenerateImage: (imageModelKey) =>
        // TODO: 實作 generateImage
        console.log('Generate image:', imageModelKey),
      onGenerateImageInline: (text, start, end, prefix, suffix) =>
        // TODO: 實作 generateImageInline
        console.log('Generate image inline:', text),
      hasImageModel: models.some((m) => m.Kind === 'image'),
      imageModelOptions: models.filter((m) => m.Kind === 'image'),
      // 框選提問：走 askInlineLink（後端建立回答節點 + 行內連結 + 連線，且用完整節點內容＋
      // 祖先脈絡＋框選文字組 Prompt）。舊版誤接 askFollowup，會丟失框選脈絡且不產生連線。
      onAskInline: (text, start, end, prefix, suffix, question) =>
        actions.askInlineLink(node.Node_Id, text, start, end, prefix, suffix, question, childPosition(node.Node_Id)),
      onHighlight: async (text, start, end, prefix, suffix, color) => {
        const created = await actions.createHighlight({
          nodeId: node.Node_Id,
          anchorText: text,
          start,
          end,
          anchorPrefix: prefix,
          anchorSuffix: suffix,
          color,
        })
        return created?.Highlight_Id ?? null
      },
      onUpdateHighlight: (highlightId, color) => actions.updateHighlight(highlightId, color),
      onLinkToNode: (text, start, end, prefix, suffix, targetNodeId) =>
        actions.createInlineLink({
          sourceNodeId: node.Node_Id,
          anchorText: text,
          anchorStart: start,
          anchorEnd: end,
          anchorPrefix: prefix,
          anchorSuffix: suffix,
          targetNodeId,
        }),
      onDeleteHighlight: (id) =>
        actions.deleteHighlight(id),
      onLinkClick,
      onEditContent: (content) => actions.updateNodeContent(node.Node_Id, content),
      onDelete: () => actions.deleteNode(node.Node_Id),
      onResize: (w, h) => actions.updateNodeLayout(node.Node_Id, { Width: w, Height: h }),
    }),
    [actions, highlightsByNode, linksBySource, spotlightNodeIds, pending, nodeOptionsAll, models, onLinkClick, childPosition, timezone]
  )

  /**
   * 同步節點到 React Flow
   */
  useEffect(() => {
    setRfNodes((prev: RfNode<QaNodeData>[]) => {
      const prevById = new Map(prev.map((n: RfNode<QaNodeData>) => [n.id, n]))
      return Object.values(nodes).map((node: NodeDto) => {
        const p = prevById.get(node.Node_Id) as RfNode<QaNodeData> | undefined
        const rawWidth = node.Node_Width ?? ((p?.style as Record<string, unknown>)?.width as number | undefined) ?? NODE_MIN_WIDTH
        const width = Math.max(rawWidth, NODE_MIN_WIDTH)
        const height = node.Node_Height ?? ((p?.style as Record<string, unknown>)?.height as number | undefined)

        return {
          id: node.Node_Id,
          type: 'qa' as const,
          position: (p?.position ?? { x: node.Node_X, y: node.Node_Y }) as { x: number; y: number },
          style: height ? { width, height } : { width },
          selected: node.Node_Id === selectedId,
          data: buildData(node),
        }
      })
    })
  }, [nodes, buildData, selectedId, setRfNodes])

  /**
   * 同步邊到 React Flow
   */
  useEffect(() => {
    setRfEdges(
      Object.values(edges).map((e) => ({
        id: e.Edge_Id,
        source: e.Edge_SourceNodeId,
        target: e.Edge_TargetNodeId,
        sourceHandle: e.Edge_SourceHandle ?? undefined,
        targetHandle: e.Edge_TargetHandle ?? undefined,
        type: 'deletable',
        data: { spotlight: e.Edge_Id === spotlightEdgeId, onDelete: actions.deleteEdge },
      }))
    )
  }, [edges, spotlightEdgeId, actions, setRfEdges])

  /**
   * 新連線建立
   */
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) {
        actions.createEdge({
          sourceNodeId: c.source,
          targetNodeId: c.target,
          sourceHandle: c.sourceHandle,
          targetHandle: c.targetHandle,
        })
      }
    },
    [actions]
  )

  /**
   * 邊拖曳重接
   */
  const reconnectOk = useRef(true)

  const onReconnectStart = useCallback(() => {
    reconnectOk.current = false
  }, [])

  const onReconnect = useCallback(
    (oldEdge: Edge, c: Connection) => {
      if (c.source && c.target) {
        reconnectOk.current = true
        actions.reconnectEdge(oldEdge.id, {
          sourceNodeId: c.source,
          targetNodeId: c.target,
          sourceHandle: c.sourceHandle,
          targetHandle: c.targetHandle,
        })
      }
    },
    [actions]
  )

  const onReconnectEnd = useCallback(
    (_: unknown, edge: Edge) => {
      if (!reconnectOk.current) {
        actions.deleteEdge(edge.id)
      }
    },
    [actions]
  )

  /**
   * 新增節點
   */
  const addNode = () => {
    const selected = selectedId ? nodes[selectedId] : null
    if (selected) {
      actions.createNode({
        x: selected.Node_X + 40,
        y: selected.Node_Y + 200,
        parentId: selected.Node_Id,
      })
    } else {
      const pos = screenToFlowPosition({ x: 220, y: 180 })
      actions.createNode({
        x: pos.x,
        y: pos.y,
      })
    }
  }

  const selectedNode = selectedId ? nodes[selectedId] : null

  return (
    <div className="relative flex h-full w-full" data-kaiwen-theme={theme || 'warmpaper'}>
      {/* 左側節點清單側欄（移植自原版開問啦）：畫布設定 + 節點清單大綱樹 */}
      <LeftSidebar
        canvasId={canvasId}
        nodes={nodes}
        selectedId={selectedId}
        onFocus={(id) => {
          setSelectedId(id)
          navigateTo(id)
        }}
      />
      <div className="relative h-full flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          reconnectRadius={16}
          onNodeDragStop={(_: unknown, node: RfNode) => {
            actions.updateNodeLayout(node.id, {
              X: node.position.x,
              Y: node.position.y,
            })
          }}
          onNodeClick={(_: unknown, node: RfNode) => {
            setSelectedId(node.id)
            setDrawerOpen(true)
            onNodeFocus?.(node.id)
          }}
          onEdgeClick={(_: unknown, edge: Edge) => {
            setSpotlightEdgeId((cur) => (cur === edge.id ? null : edge.id))
            setSelectedId(null)
          }}
          onPaneClick={() => {
            setSpotlightEdgeId(null)
            setSelectedId(null)
          }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          zoomOnDoubleClick={false}
          // 標註繪圖中：鎖住畫布所有平移/縮放/節點互動，讓筆畫不會連帶移動畫布。
          panOnDrag={!annoDrawing}
          nodesDraggable={!annoDrawing}
          nodesConnectable={!annoDrawing}
          elementsSelectable={!annoDrawing}
          panOnScroll={annoDrawing ? false : panOnScroll}
          zoomOnScroll={annoDrawing ? false : !panOnScroll}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <MiniMap pannable zoomable position="bottom-right" onClick={onMinimapClick} />
          <ZoomControl />
        </ReactFlow>

        {/* 新增節點按鈕 */}
        <button
          className="absolute left-4 top-4 z-10 rounded-lg border border-[var(--kw-border)] bg-[var(--kw-surface)] px-3 py-1.5 text-sm text-[var(--kw-text)] shadow hover:bg-[var(--kw-surface-2)]"
          onClick={addNode}
          data-testid="add-node"
          title="新增節點（若已選取節點，則建為其子節點）"
        >
          ＋ 新增節點
        </button>

        {/* 畫布標註層（便利貼 / 圖片板 / 手繪塗鴉 + 橡皮擦）——工具列固定右下角，繪圖時鎖住畫布。 */}
        <CanvasAnnotationLayer canvasId={canvasId} onDrawingActiveChange={setAnnoDrawing} />
      </div>

      {/* 右側編輯面板 */}
      {drawerOpen && selectedNode && (
        <RightDrawer
          node={selectedNode}
          nodes={nodes}
          nodeOptions={nodeOptionsAll}
          outgoingLinks={Object.values(inlineLinks).filter(
            (l) => l.InlineLink_SourceNodeId === selectedNode.Node_Id
          )}
          incomingLinks={Object.values(inlineLinks).filter(
            (l) => l.InlineLink_TargetNodeId === selectedNode.Node_Id
          )}
          edges={Object.values(edges)}
          onClose={() => setDrawerOpen(false)}
          onSaveContent={(content) => actions.updateNodeContent(selectedNode.Node_Id, content)}
          onDeleteNode={() => {
            actions.deleteNode(selectedNode.Node_Id)
            setDrawerOpen(false)
            setSelectedId(null)
          }}
          onDeleteEdge={(edgeId) => actions.deleteEdge(edgeId)}
          onDeleteLink={(linkId) => actions.deleteInlineLink(linkId)}
          onUpdateLinkTarget={(linkId, targetNodeId) =>
            actions.updateInlineLinkTarget(linkId, targetNodeId)
          }
          onNavigate={(nodeId) => navigateTo(nodeId)}
          timezone={timezone}
        />
      )}

      {/* 文字選取浮現面板 */}
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          anchorText={selection.text}
          nodeOptions={nodeOptionsAll}
          onAsk={(question) => {
            actions.askFollowup(
              selection.nodeId,
              question,
              selection.text,
              selection.start,
              selection.end,
              selection.prefix,
              selection.suffix,
              { x: selection.rect.left, y: selection.rect.top }
            )
            setSelection(null)
          }}
          onHighlight={(colorName) => {
            actions.createHighlight({
              nodeId: selection.nodeId,
              anchorText: selection.text,
              start: selection.start,
              end: selection.end,
              anchorPrefix: selection.prefix,
              anchorSuffix: selection.suffix,
              color: colorName,
            })
            setSelection(null)
          }}
          onLinkToNode={(targetNodeId) => {
            actions.createInlineLink({
              sourceNodeId: selection.nodeId,
              anchorText: selection.text,
              anchorStart: selection.start,
              anchorEnd: selection.end,
              anchorPrefix: selection.prefix,
              anchorSuffix: selection.suffix,
              targetNodeId,
            })
            setSelection(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * 畫布視圖（包裹 Provider）
 */
export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
