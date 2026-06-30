import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import type { NodeDto } from '../kaiwen-types'
import { NodeNavigator } from './NodeNavigator'
import { CanvasSystemPanel } from './CanvasSystemPanel'

interface LeftSidebarProps {
  /**
   * 畫布 ID
   */
  canvasId: string

  /**
   * 畫布中所有節點的 map（key: Node_Id, value: NodeDto）
   */
  nodes: Record<string, NodeDto>

  /**
   * 目前已選取的節點 ID（為 null 時無選取）
   */
  selectedId: string | null

  /**
   * 使用者點擊節點時的 callback（傳入該節點的 Node_Id）
   */
  onFocus: (nodeId: string) => void
}

/**
 * 區塊標題列（VS Code 側欄風格）：整列可點以展開 / 收合該區塊。
 */
function SectionHeader({
  title,
  open,
  onToggle,
  testid,
}: {
  title: string
  open: boolean
  onToggle: () => void
  testid: string
}) {
  return (
    <button
      className="flex w-full shrink-0 items-center gap-1.5 border-b border-[var(--kw-border)] bg-[var(--kw-surface-2)] px-2 py-1 text-left hover:brightness-[1.03]"
      onClick={onToggle}
      data-testid={testid}
      title={open ? '收合' : '展開'}
    >
      <span className="w-3 text-[10px] text-[var(--kw-muted)]">{open ? '▾' : '▸'}</span>
      <span className="text-[11px] font-semibold text-[var(--kw-text)]">{title}</span>
    </button>
  )
}

/**
 * 左側單一側欄（VS Code 風格）：上下分層兩個可收合區塊——「畫布設定」與「節點清單」。
 * 整個側欄可收合成細條；各區塊也可獨立展開 / 收合，展開狀態存 localStorage。
 * 側欄本身可隱藏、可拖曳調寬（寬度與隱藏狀態存 localStorage）。
 *
 * 對外介面：
 * - canvasId: 畫布 ID
 * - nodes: 節點 map（key: Node_Id）
 * - selectedId: 目前選取節點的 ID（nullable）
 * - onFocus: 使用者點擊節點時觸發的 callback（傳入 nodeId）
 */
export function LeftSidebar({
  canvasId,
  nodes,
  selectedId,
  onFocus,
}: LeftSidebarProps) {
  /**
   * 左側欄寬度（px）：200–520px，存 localStorage（"kaiwen:leftSidebarWidth"）
   */
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem('kaiwen:leftSidebarWidth')
    if (stored) {
      const parsed = parseInt(stored, 10)
      return Number.isFinite(parsed) && parsed >= 200 && parsed <= 520 ? parsed : 280
    }
    return 280
  })

  /**
   * 左側欄是否隱藏（存 localStorage: "kaiwen:leftSidebarHidden"）
   */
  const [hidden, setHidden] = useState(() =>
    localStorage.getItem('kaiwen:leftSidebarHidden') === '1'
  )

  /**
   * 「畫布設定」區塊展開狀態（存 localStorage: "kaiwen:sidebarSettingsOpen"）
   */
  const [settingsOpen, setSettingsOpen] = useState(() =>
    localStorage.getItem('kaiwen:sidebarSettingsOpen') === '1'
  )

  /**
   * 「節點清單」區塊展開狀態（存 localStorage: "kaiwen:sidebarNodesOpen"）
   */
  const [nodesOpen, setNodesOpen] = useState(() =>
    localStorage.getItem('kaiwen:sidebarNodesOpen') !== '0'
  )

  /**
   * 拖曳 bar 是否正在拖動（用以標記 isDragging 狀態）
   */
  const [isDragging, setIsDragging] = useState(false)

  /**
   * 參考 LeftSidebar 容器 DOM，用於計算拖曳時的寬度
   */
  const sidebarRef = useRef<HTMLElement>(null)

  /**
   * 更新寬度到 localStorage
   */
  useEffect(() => {
    localStorage.setItem('kaiwen:leftSidebarWidth', String(width))
  }, [width])

  /**
   * 更新隱藏狀態到 localStorage
   */
  useEffect(() => {
    localStorage.setItem('kaiwen:leftSidebarHidden', hidden ? '1' : '0')
  }, [hidden])

  /**
   * 更新「畫布設定」區塊展開狀態到 localStorage
   */
  useEffect(() => {
    localStorage.setItem('kaiwen:sidebarSettingsOpen', settingsOpen ? '1' : '0')
  }, [settingsOpen])

  /**
   * 更新「節點清單」區塊展開狀態到 localStorage
   */
  useEffect(() => {
    localStorage.setItem('kaiwen:sidebarNodesOpen', nodesOpen ? '1' : '0')
  }, [nodesOpen])

  /**
   * 處理拖曳 bar 的滑鼠按下事件
   */
  const handleDragStart = useCallback(() => {
    setIsDragging(true)
  }, [])

  /**
   * 處理拖曳過程中的滑鼠移動，更新側欄寬度
   */
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return

      // 計算新寬度：sidebar 容器到滑鼠 x 位置的距離
      const rect = sidebarRef.current.getBoundingClientRect()
      const newWidth = e.clientX - rect.left

      // 限制在 200–520px 之間
      const clamped = Math.max(200, Math.min(520, newWidth))
      setWidth(clamped)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('pointermove', handleMouseMove)
    document.addEventListener('pointerup', handleMouseUp)

    return () => {
      document.removeEventListener('pointermove', handleMouseMove)
      document.removeEventListener('pointerup', handleMouseUp)
    }
  }, [isDragging])

  /**
   * 若側欄已隱藏，僅顯示展開按鈕（»）的細條版本
   */
  if (hidden) {
    return (
      <div className="kw-drawer flex h-full w-9 shrink-0 flex-col items-center border-r pt-2">
        <button
          className="rounded p-1 text-[var(--kw-text)] hover:bg-[var(--kw-surface)] cursor-pointer"
          onClick={() => setHidden(false)}
          title="展開側欄"
          data-testid="sidebar-expand"
        >
          »
        </button>
      </div>
    )
  }

  const sectionBody = (cls: string, children: ReactNode) => (
    <div className={cls}>{children}</div>
  )

  return (
    <aside
      ref={sidebarRef}
      className="kw-drawer relative flex h-full shrink-0 flex-col border-r"
      style={{ width: `${width}px` }}
      data-testid="left-sidebar"
    >
      {/* 側欄頂部：「側欄」標籤與隱藏按鈕 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--kw-border)] px-2 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--kw-text)]">
          側欄
        </span>
        <button
          className="rounded p-1 text-[var(--kw-muted)] hover:bg-[var(--kw-surface)] hover:text-[var(--kw-text)] cursor-pointer"
          onClick={() => setHidden(true)}
          title="隱藏側欄"
          data-testid="sidebar-hide"
        >
          «
        </button>
      </div>

      {/* 區塊一：畫布設定 */}
      <SectionHeader
        title="畫布設定"
        open={settingsOpen}
        onToggle={() => setSettingsOpen((v) => !v)}
        testid="section-canvas-settings"
      />
      {settingsOpen &&
        sectionBody(
          'max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-b border-[var(--kw-border)]',
          <CanvasSystemPanel canvasId={canvasId} active={settingsOpen} />
        )}

      {/* 區塊二：節點清單 */}
      <SectionHeader
        title={`節點清單（${Object.keys(nodes).length}）`}
        open={nodesOpen}
        onToggle={() => setNodesOpen((v) => !v)}
        testid="section-nodes"
      />
      {nodesOpen &&
        sectionBody(
          'min-h-0 flex-1 overflow-hidden',
          <NodeNavigator nodes={nodes} selectedId={selectedId} onFocus={onFocus} />
        )}

      {/* 可拖曳的右邊界 bar：用於調整側欄寬度 */}
      <div
        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--kw-primary)] transition-colors ${
          isDragging ? 'bg-[var(--kw-primary)]' : 'bg-transparent'
        }`}
        onPointerDown={handleDragStart}
        title="拖曳以調整側欄寬度"
        data-testid="sidebar-resize-bar"
      />
    </aside>
  )
}
