/**
 * 聊天視圖：線性化分支樹為可滾動聊天串（手機友善）
 *
 * 功能：
 * - 把分支樹線性化成 root → current → leaf 的單一聊天路徑
 * - 樹的父子關係以 Edge（畫布上的連線）優先、Node_ParentId 為輔
 * - 分叉處左右露出相鄰兄弟卡片一角（可點切換）
 * - 節點地圖（modal）總覽整個樹狀結構，含目前位置標記
 * - 自動滾動至目前節點
 *
 * Props 介面與開問啦原版相同：
 * { nodes, edges, inlineLinks, highlights, pending, models, currentNodeId, onNodeFocus, actions }
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NodeDto, EdgeDto, HighlightDto, InlineLinkDto, AiModelDto } from '../kaiwen-types'
import type { CanvasActions } from '../hooks/useCanvas'
import { ChatCard } from './ChatCard'

/**
 * 聊天視圖的 props 介面
 */
interface ChatViewProps {
  /** 節點清單（以 ID 為鍵的物件） */
  nodes: Record<string, NodeDto>
  /** 邊清單（以 ID 為鍵的物件） */
  edges: Record<string, EdgeDto>
  /** 行內連結清單（框選文字產生的連結） */
  inlineLinks: Record<string, InlineLinkDto>
  /** 高亮清單（選取文字的重點標記） */
  highlights: Record<string, HighlightDto>
  /** 待完成的操作（以節點 ID 為鍵的 true 值） */
  pending: Record<string, true>
  /** 可用的 AI 模型列表 */
  models: AiModelDto[]
  /** 目前焦點節點 ID（由應用跨畫布記住） */
  currentNodeId?: string | null
  /** 節點焦點變化回調（點擊節點、切兄弟、地圖選取時觸發） */
  onNodeFocus: (id: string) => void
  /** 節點操作方法（建立、更新、刪除等） */
  actions: CanvasActions
}

/** 虛擬根節點 ID（無父節點的節點會以此為父） */
const ROOT = '__root__'

/**
 * 抽取節點內容的首行作為摘要
 * 用於 PeekStrip 與 MapTree 的標籤顯示
 *
 * @param content - 節點內容（Markdown 格式）
 * @returns 首行摘要（去除 Markdown 語法）
 */
function firstLine(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)

  if (!line) return '(空白節點)'

  // 圖片檢測
  if (/^!\[.*\]\(.*\)$/.test(line)) return '🖼 圖片'

  // 移除 Markdown 標記符號
  const clean = line
    .replace(/^#{1,6}\s*/, '') // 移除標題前綴
    .replace(/[*_`>]/g, '') // 移除粗體/斜體/程式碼/引用符
    .trim()

  return clean.length > 0 ? clean : '(空白節點)'
}

/**
 * 聊天視圖主元件
 */
export function ChatView({
  nodes,
  inlineLinks,
  highlights,
  pending,
  models,
  edges,
  currentNodeId,
  onNodeFocus,
  actions,
}: ChatViewProps) {
  // 每個節點已選中的子節點（用於分叉時記住使用者的選擇）
  const [chosenChild, setChosenChild] = useState<Record<string, string>>({})
  // 節點地圖 modal 的開關狀態
  const [mapOpen, setMapOpen] = useState(false)
  // 目前節點的 DOM 參考（用於自動滾動）
  const currentRef = useRef<HTMLDivElement>(null)

  /**
   * 建構「每個節點的父節點」對應表
   *
   * 父節點的選取優先順序：
   * 1. 畫布上指入此節點的連線來源（若有多條，取建立時間最早、再以 ID 字典序）
   * 2. 若無指入連線，則用 Node_ParentId
   * 3. 都沒有為根（null）
   * 4. 防環：若形成循環，斷成根
   *
   * 與後端 AncestryService 的選邊邏輯一致。
   */
  const parentOf = useMemo(() => {
    const ids = new Set(Object.keys(nodes))
    // 收集指入各節點的連線
    const incoming = new Map<string, { source: string; created: string; edgeId: string }>()

    for (const e of Object.values(edges)) {
      // 只考慮來源與目標都存在的邊
      if (!ids.has(e.Edge_SourceNodeId) || !ids.has(e.Edge_TargetNodeId)) continue

      const created = e.Edge_CreatedDateTime ?? ''
      const prev = incoming.get(e.Edge_TargetNodeId)

      // 比較：優先選早建立的，同時間再比 ID 字典序
      const isEarlier =
        !prev || created < prev.created || (created === prev.created && e.Edge_Id < prev.edgeId)

      if (isEarlier) {
        incoming.set(e.Edge_TargetNodeId, {
          source: e.Edge_SourceNodeId,
          created,
          edgeId: e.Edge_Id,
        })
      }
    }

    // 建構父節點對應表
    const pmap: Record<string, string | null> = {}
    for (const n of Object.values(nodes)) {
      const byParentId = n.Node_ParentId && ids.has(n.Node_ParentId) ? n.Node_ParentId : null
      pmap[n.Node_Id] = incoming.get(n.Node_Id)?.source ?? byParentId ?? null
    }

    // 防環：每個節點都做一次完整上溯，若再次遇到自己就斷成根
    for (const id of Object.keys(pmap)) {
      const seen = new Set<string>()
      let cur: string | null = id

      while (cur) {
        if (seen.has(cur)) {
          pmap[id] = null
          break
        }
        seen.add(cur)
        cur = pmap[cur] ?? null
      }
    }

    return pmap
  }, [nodes, edges])

  /**
   * 建構「每個父節點的子節點列表」
   * 子節點按建立時間排序（從早到晚）
   */
  const childrenByParent = useMemo(() => {
    const m = new Map<string, NodeDto[]>()

    for (const n of Object.values(nodes)) {
      const pid = parentOf[n.Node_Id] ?? ROOT
      ;(m.get(pid) ?? m.set(pid, []).get(pid)!).push(n)
    }

    // 按建立時間排序
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (a.Node_CreatedDateTime ?? '').localeCompare(b.Node_CreatedDateTime ?? '')
      )
    }

    return m
  }, [nodes, parentOf])

  /** 查詢某節點的子節點列表 */
  const childrenOf = (id: string) => childrenByParent.get(id) ?? []

  /**
   * 計算預設葉節點（若未指定 currentNodeId，則跳到此處）
   * 演算法：從根開始，每層選最早的子節點，直到到達葉子
   */
  const defaultLeaf = useMemo(() => {
    let pid = ROOT
    let leaf: string | null = null
    const seen = new Set<string>()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const kids = childrenByParent.get(pid) ?? []
      if (kids.length === 0 || seen.has(kids[0].Node_Id)) break

      leaf = kids[0].Node_Id
      seen.add(leaf)
      pid = leaf
    }

    return leaf
  }, [childrenByParent])

  /**
   * 有效的目前節點
   * 若 currentNodeId 有效則用之，否則用預設葉節點，再否則為 null
   */
  const effectiveCurrent =
    currentNodeId && nodes[currentNodeId] ? currentNodeId : defaultLeaf

  /**
   * 聊天路徑：從目前節點向上走到根，再向下走到葉子
   *
   * 向上遍歷：沿著 parentOf 上升至根
   * 向下遍歷：每層選 chosenChild[當前節點] 或第一個子節點，直到葉子
   */
  const path = useMemo(() => {
    if (!effectiveCurrent || !nodes[effectiveCurrent]) return []

    // 向上遍歷至根
    const up: NodeDto[] = []
    let curId: string | null = effectiveCurrent
    const guard = new Set<string>()

    while (curId && nodes[curId] && !guard.has(curId)) {
      guard.add(curId)
      up.unshift(nodes[curId])
      curId = parentOf[curId] ?? null
    }

    // 向下遍歷至葉子
    const down: NodeDto[] = []
    let pid = effectiveCurrent
    const seen = new Set(up.map((x) => x.Node_Id))

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const kids = childrenOf(pid)
      if (kids.length === 0) break

      const chosen = kids.find((k) => k.Node_Id === chosenChild[pid]) ?? kids[0]
      if (seen.has(chosen.Node_Id)) break

      seen.add(chosen.Node_Id)
      down.push(chosen)
      pid = chosen.Node_Id
    }

    return [...up, ...down]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCurrent, nodes, parentOf, childrenByParent, chosenChild])

  /**
   * 自動滾動至目前節點
   */
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [effectiveCurrent, path.length])

  /**
   * 建構「每個節點的高亮列表」與「每個節點的行內連結列表」
   * 以便在渲染卡片時直接查詢
   */
  const highlightsByNode = useMemo(() => {
    const m: Record<string, HighlightDto[]> = {}
    for (const h of Object.values(highlights)) {
      ;(m[h.Highlight_NodeId] ??= []).push(h)
    }
    return m
  }, [highlights])

  const linksBySource = useMemo(() => {
    const m: Record<string, InlineLinkDto[]> = {}
    for (const l of Object.values(inlineLinks)) {
      ;(m[l.InlineLink_SourceNodeId] ??= []).push(l)
    }
    return m
  }, [inlineLinks])

  /**
   * 節點選項（用於「連結到」下拉單）
   * 排除目前節點本身
   */
  const nodeOptions = useMemo(
    () =>
      Object.values(nodes).map((n) => ({
        id: n.Node_Id,
        label: firstLine(n.Node_Content),
      })),
    [nodes]
  )

  /**
   * AI 模型分類
   */
  const modelOptions = models.filter((m) => m.Kind !== 'image')
  const imageModelOptions = models.filter((m) => m.Kind === 'image')

  /**
   * 切換節點到某個兄弟
   *
   * @param node - 目前節點
   * @param dir - 方向：-1 為上一個兄弟，+1 為下一個兄弟
   */
  const switchSibling = (node: NodeDto, dir: 1 | -1) => {
    const parent = parentOf[node.Node_Id] ?? ROOT
    const siblings = childrenOf(parent)
    const idx = siblings.findIndex((s) => s.Node_Id === node.Node_Id)
    const next = siblings[idx + dir]

    if (!next) return

    // 記住此分叉點的選擇，並更新焦點
    setChosenChild((c) => ({ ...c, [parent]: next.Node_Id }))
    onNodeFocus(next.Node_Id)
  }

  /**
   * 路徑上的節點 ID 集合（用於地圖高亮）
   */
  const pathIds = new Set(path.map((n) => n.Node_Id))

  // 空狀態：無節點
  if (path.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--kw-muted)]">
        <p className="text-sm">這張畫布還沒有節點。</p>
        <p className="text-xs">切到「畫布」視圖新增節點，或在此開始。</p>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-y-auto bg-[var(--kw-bg)]">
      {/* 聊天卡片容器 */}
      <div className="mx-auto w-full max-w-2xl space-y-3 px-2 py-4 pb-24 sm:px-3">
        {path.map((node) => {
          const parent = parentOf[node.Node_Id] ?? ROOT
          const siblings = childrenOf(parent)
          const idx = siblings.findIndex((s) => s.Node_Id === node.Node_Id)
          const isCurrent = node.Node_Id === effectiveCurrent
          const hasSiblings = siblings.length > 1

          return (
            <div key={node.Node_Id} ref={isCurrent ? currentRef : undefined} className="flex items-stretch gap-1.5">
              {/* 左兄弟 Peek 條 */}
              {hasSiblings && (
                <PeekStrip
                  dir="prev"
                  sibling={siblings[idx - 1]}
                  onClick={() => switchSibling(node, -1)}
                />
              )}

              {/* 主卡片 */}
              <div className="min-w-0 flex-1">
                <ChatCard
                  node={node}
                  highlights={highlightsByNode[node.Node_Id] ?? []}
                  links={linksBySource[node.Node_Id] ?? []}
                  pending={!!pending[node.Node_Id]}
                  current={isCurrent}
                  modelOptions={modelOptions}
                  imageModelOptions={imageModelOptions}
                  nodeOptions={nodeOptions.filter((o) => o.id !== node.Node_Id)}
                  siblingIndex={idx}
                  siblingCount={siblings.length}
                  onPrevSibling={() => switchSibling(node, -1)}
                  onNextSibling={() => switchSibling(node, 1)}
                  actions={actions}
                  onActivate={() => onNodeFocus(node.Node_Id)}
                  onJump={(id) => onNodeFocus(id)}
                />
              </div>

              {/* 右兄弟 Peek 條 */}
              {hasSiblings && (
                <PeekStrip
                  dir="next"
                  sibling={siblings[idx + 1]}
                  onClick={() => switchSibling(node, 1)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 地圖按鈕 */}
      <button
        className="fixed bottom-4 right-4 z-20 rounded-full border border-[var(--kw-border)] bg-[var(--kw-surface)] px-4 py-2 text-sm text-[var(--kw-text)] shadow-lg hover:bg-[var(--kw-surface-2)]"
        onClick={() => setMapOpen(true)}
        data-testid="chat-map-open"
        title="節點地圖（看分支結構與所在位置）"
      >
        🗺 地圖
      </button>

      {/* 節點地圖 Modal */}
      {mapOpen && (
        <div className="fixed inset-0 z-30 flex" data-testid="chat-map">
          <div className="flex-1 bg-black/40" onClick={() => setMapOpen(false)} />
          <aside className="kw-drawer flex h-full w-80 max-w-[88vw] flex-col border-l">
            {/* 地圖標題列 */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--kw-border)] px-3 py-2">
              <span className="text-sm font-semibold text-[var(--kw-text)]">
                節點地圖（{Object.keys(nodes).length}）
              </span>
              <button
                className="rounded px-2 text-[var(--kw-muted)] hover:text-[var(--kw-text)]"
                onClick={() => setMapOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* 樹狀列表 */}
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              <MapTree
                rootChildren={childrenOf(ROOT)}
                childrenOf={childrenOf}
                pathIds={pathIds}
                currentId={effectiveCurrent}
                onPick={(id) => {
                  onNodeFocus(id)
                  setMapOpen(false)
                }}
              />
            </div>

            {/* 圖例 */}
            <div className="shrink-0 border-t border-[var(--kw-border)] px-3 py-1.5 text-[10px] text-[var(--kw-muted)]">
              ● 紫＝你在這裡；● 藍＝目前路徑；⑂ ＝分叉。點任一節點即跳到它。
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

/**
 * 分叉處左右露出的相鄰兄弟卡片一角
 *
 * 功能：
 * - 顯示相鄰兄弟節點的內容摘要
 * - 可點擊切換到該兄弟
 * - 若該方向無兄弟，顯示等寬空白以對齐
 */
function PeekStrip({
  dir,
  sibling,
  onClick,
}: {
  /** 方向：prev（左/上） 或 next（右/下） */
  dir: 'prev' | 'next'
  /** 兄弟節點（可能為 undefined） */
  sibling: NodeDto | undefined
  /** 點擊回調 */
  onClick: () => void
}) {
  if (!sibling) {
    // 無兄弟時顯示等寬空白
    return <div className="w-9 shrink-0 sm:w-16" />
  }

  return (
    <button
      className="kw-card sticky top-3 flex max-h-40 w-9 shrink-0 flex-col items-center gap-1 self-start overflow-hidden rounded-xl border p-1 opacity-70 hover:opacity-100 sm:w-16"
      onClick={onClick}
      data-testid={`peek-${dir}`}
      title={`${dir === 'prev' ? '上一個' : '下一個'}分支：${firstLine(sibling.Node_Content)}`}
    >
      <span className="text-[var(--kw-muted)]">{dir === 'prev' ? '‹' : '›'}</span>
      <span className="line-clamp-5 text-[8px] leading-tight text-[var(--kw-muted)]">
        {firstLine(sibling.Node_Content)}
      </span>
    </button>
  )
}

/**
 * 節點地圖：樹狀結構總覽
 *
 * 功能：
 * - 以連接線（├ └ │）畫出樹狀結構
 * - 節點為彩色圓點：
 *   - 紫 = 目前所在
 *   - 藍 = 目前路徑
 *   - 灰 = 其他
 * - 分叉處標 ⑂ 與分支數
 * - 可點擊節點跳轉
 */
function MapTree({
  rootChildren,
  childrenOf,
  pathIds,
  currentId,
  onPick,
}: {
  /** 根節點的子節點列表 */
  rootChildren: NodeDto[]
  /** 查詢子節點的函式 */
  childrenOf: (id: string) => NodeDto[]
  /** 目前路徑上的節點 ID 集合 */
  pathIds: Set<string>
  /** 目前焦點節點 ID */
  currentId: string | null
  /** 節點選取回調 */
  onPick: (id: string) => void
}) {
  const rows: ReactNode[] = []
  const seen = new Set<string>()

  /**
   * 遞迴遍歷樹並生成渲染列表
   *
   * @param node - 當前節點
   * @param prefix - 樹線前綴（用於縮進與連線）
   * @param isLast - 是否為父節點的最後一個子節點
   */
  const walk = (node: NodeDto, prefix: string, isLast: boolean) => {
    if (seen.has(node.Node_Id)) return
    seen.add(node.Node_Id)

    const kids = childrenOf(node.Node_Id)
    const isCurrent = node.Node_Id === currentId
    const onPath = pathIds.has(node.Node_Id)

    // 圓點顏色：紫 > 藍 > 灰
    const dotCls = isCurrent
      ? 'bg-[var(--kw-primary)] ring-2 ring-[var(--kw-ring)]'
      : onPath
        ? 'bg-[var(--kw-accent)]'
        : 'bg-[var(--kw-border-strong)]'

    // 標籤顏色
    const labelCls = isCurrent
      ? 'font-bold text-[var(--kw-primary)]'
      : onPath
        ? 'text-[var(--kw-text)]'
        : 'text-[var(--kw-muted)]'

    rows.push(
      <button
        key={node.Node_Id}
        className="flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left hover:bg-[var(--kw-surface)]"
        onClick={() => onPick(node.Node_Id)}
        title={firstLine(node.Node_Content)}
      >
        {/* 樹線 */}
        <span className="whitespace-pre font-mono text-[11px] leading-none text-[var(--kw-faint)]">
          {prefix + (isLast ? '└' : '├')}
        </span>

        {/* 圓點 */}
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotCls}`} />

        {/* 標籤 */}
        <span className={`min-w-0 flex-1 truncate text-[11px] ${labelCls}`}>
          {firstLine(node.Node_Content)}
        </span>

        {/* 當前位置指示 */}
        {isCurrent && <span className="shrink-0 text-[9px] text-[var(--kw-primary)]">◀在這</span>}

        {/* 分叉指示 */}
        {kids.length > 1 && (
          <span className="shrink-0 text-[9px] text-[var(--kw-muted)]">⑂{kids.length}</span>
        )}
      </button>
    )

    // 遞迴處理子節點
    const childPrefix = prefix + (isLast ? '  ' : '│ ')
    kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1))
  }

  // 從根開始遍歷
  rootChildren.forEach((r, i) => walk(r, '', i === rootChildren.length - 1))

  return <>{rows}</>
}
