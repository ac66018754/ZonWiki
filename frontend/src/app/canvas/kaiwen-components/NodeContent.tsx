/**
 * 節點內容 — Markdown 渲染與標註應用
 *
 * 功能：
 * - 以 Markdown 渲染節點內容（支援 GFM）
 * - 在渲染後覆蓋高亮與行內連結
 * - 支援編輯模式（雙擊進入）
 * - AI 生成中狀態指示
 */

import { useLayoutEffect, type RefObject } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { applyAnnotations, type AnnoHighlight, type AnnoLink } from '../lib/annotate'
import { toAbsoluteAttachmentUrl } from '@/lib/attachmentUrl'

/**
 * 網址轉換：附件相對路徑（/api/attachments/{id}，節點編輯器貼圖產生）補成 API 絕對網址
 * （本地 dev 前後端跨埠時 <img> 才載得到），再交給 react-markdown 預設安全過濾。
 */
const attachmentUrlTransform = (url: string) => defaultUrlTransform(toAbsoluteAttachmentUrl(url))

/**
 * 節點內容元件 Props
 */
interface NodeContentProps {
  /** 節點內容（Markdown 格式） */
  content: string
  /** 高亮標註 */
  highlights: AnnoHighlight[]
  /** 行內連結標註 */
  links: AnnoLink[]
  /** 是否編輯模式 */
  editing: boolean
  /** 是否正在等待 AI 回應 */
  pending: boolean
  /** 內容容器參考 */
  containerRef: RefObject<HTMLDivElement>
  /** 滑鼠釋放事件（用於偵測文字選取） */
  onMouseUp: () => void
  /** 連結點擊回調 */
  onLinkClick: (linkId: string) => void
  /** 高亮點擊回調（移除） */
  onHighlightClick: (highlightId: string) => void
  /** 開始編輯回調（通常由雙擊觸發） */
  onStartEdit: () => void
}

/**
 * 節點內容顯示與編輯元件
 *
 * 流程：
 * 1. 若 pending：顯示加載動畫
 * 2. 若 editing：顯示 textarea（由父元件 QaNode 控制）
 * 3. 正常：渲染 Markdown，然後用 applyAnnotations 覆蓋標註
 *
 * 標註更新時機：
 * - useLayoutEffect 在 DOM 渲染後立即執行，確保能正確定位 text nodes
 * - 依賴 content, highlights, links，任何變化都重新應用
 */
export function NodeContent({
  content,
  highlights,
  links,
  editing,
  pending,
  containerRef,
  onMouseUp,
  onLinkClick,
  onHighlightClick,
  onStartEdit,
}: NodeContentProps) {
  const showPending = pending && content.length === 0

  // 在 DOM 更新後套用標註
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || editing || showPending) return

    applyAnnotations(el, highlights, links)
  }, [content, highlights, links, editing, showPending, containerRef])

  /**
   * 點擊事件處理
   * 委派：檢查點擊目標是否帶有 data-link-id 或 data-highlight-id
   */
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement

    // 檢查是否點擊行內連結
    const link = target.closest('[data-link-id]') as HTMLElement | null
    if (link?.dataset.linkId) {
      onLinkClick(link.dataset.linkId)
      return
    }

    // 檢查是否點擊高亮
    const hl = target.closest('[data-highlight-id]') as HTMLElement | null
    if (hl?.dataset.highlightId) {
      onHighlightClick(hl.dataset.highlightId)
    }
  }

  return (
    <div
      ref={containerRef}
      className="qa-content nodrag"
      data-testid="node-content"
      onPointerUp={onMouseUp}
      onClick={handleClick}
      onDoubleClick={onStartEdit}
    >
      {showPending ? (
        // AI 生成中狀態
        <div className="kw-pending" data-testid="node-pending">
          <span className="kw-spinner" /> AI 生成中…
        </div>
      ) : (
        // Markdown 渲染（加 key 避免 React 複用舊 DOM）
        <ReactMarkdown key={content} remarkPlugins={[remarkGfm]} urlTransform={attachmentUrlTransform}>
          {content || '（雙擊以編輯）'}
        </ReactMarkdown>
      )}
    </div>
  )
}
