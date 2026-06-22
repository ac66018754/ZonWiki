/**
 * 文本選取浮現面板 — 框選文字後提問或畫重點
 *
 * 功能：
 * - 框選文字後浮現小面板
 * - 輸入問題 → 送出產生回答節點 + 行內連結
 * - 選色畫重點（highlight）
 * - 連結到現有節點
 * - 生成圖片（若有圖片模型）
 *
 * 使用 portal 定位，不受畫布縮放影響
 */

import { createPortal } from 'react-dom'
import { ColorPickerInline } from '@/components/ColorPicker'

/**
 * 高亮色彩配置
 */
export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#fef3c7',
  pink: '#fbcfe8',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  purple: '#e9d5ff',
}

interface SelectionPopoverProps {
  /**
   * 選取文本的邊界矩形（用於定位）
   */
  rect: DOMRect

  /**
   * 選取的文本內容
   */
  anchorText: string

  /**
   * 節點選項（用於「連結到」下拉單）
   */
  nodeOptions: { id: string; label: string }[]

  /**
   * 提問回調（輸入問題並送出時觸發）
   */
  onAsk: (question: string) => void

  /**
   * 畫重點回調（選色時觸發）
   */
  onHighlight: (colorName: string) => void

  /**
   * 連結到節點回調
   */
  onLinkToNode: (targetNodeId: string) => void

  /**
   * 生成圖片回調（可選）
   */
  onGenerateImage?: () => void
}

/**
 * 文本選取浮現面板
 */
export function SelectionPopover({
  rect,
  anchorText,
  nodeOptions,
  onAsk,
  onHighlight,
  onLinkToNode,
  onGenerateImage,
}: SelectionPopoverProps) {
  // 問題輸入狀態
  const [question, setQuestion] = React.useState('')

  // 計算浮現面板位置（相對視窗，不受縮放影響）
  const top = Math.min(window.innerHeight - 120, rect.bottom + 6)
  const left = Math.min(window.innerWidth - 280, rect.left)

  return createPortal(
    <div
      className="kw-popover fixed z-50 w-64 space-y-2 rounded-lg border p-2 shadow-xl"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        borderColor: 'var(--kw-border)',
        backgroundColor: 'var(--kw-surface)',
        color: 'var(--kw-text)',
      }}
      data-testid="selection-popover"
    >
      {/* 選取文字提示 */}
      <div className="mb-1 truncate text-[10px] text-[var(--kw-muted)]">
        針對「{anchorText.slice(0, 20)}」
      </div>

      {/* 問題輸入與提問按鈕 */}
      <div className="flex gap-1">
        <input
          className="flex-1 rounded border px-2 py-1 text-xs outline-none focus:border-[var(--kw-ring)]"
          style={{
            borderColor: 'var(--kw-border)',
            backgroundColor: 'var(--kw-surface)',
            color: 'var(--kw-text)',
          }}
          placeholder="輸入問題（送出後文字可點擊）…"
          value={question}
          autoFocus
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAsk(question)
          }}
          data-testid="selection-question"
        />
        <button
          className="rounded px-2 text-xs font-medium text-[var(--kw-primary-fg)] hover:brightness-95"
          style={{ backgroundColor: 'var(--kw-primary)' }}
          onClick={() => onAsk(question)}
          data-testid="ask-selection"
        >
          問
        </button>
        {onGenerateImage && (
          <button
            className="rounded border px-2 text-xs font-medium hover:brightness-95"
            style={{
              borderColor: 'var(--kw-border)',
              backgroundColor: 'var(--kw-accent-soft-bg)',
              color: 'var(--kw-accent-soft-fg)',
            }}
            title="以選取文字生成圖片"
            onClick={onGenerateImage}
            data-testid="generate-image-selection"
          >
            生圖
          </button>
        )}
      </div>

      {/* 畫重點（完整色盤，無斷點） */}
      <div className="space-y-1">
        <span className="text-[10px] text-[var(--kw-muted)]">畫重點</span>
        <ColorPickerInline onPick={onHighlight} />
      </div>

      {/* 連結到節點 */}
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-[10px] text-[var(--kw-muted)]">連結到</span>
        <select
          className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px] outline-none focus:border-[var(--kw-ring)]"
          style={{
            borderColor: 'var(--kw-border)',
            backgroundColor: 'var(--kw-surface)',
            color: 'var(--kw-text)',
          }}
          defaultValue=""
          onChange={(e) => e.target.value && onLinkToNode(e.target.value)}
          data-testid="link-to-node"
        >
          <option value="" disabled>
            選擇節點…
          </option>
          {nodeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>,
    document.body
  )
}

// Import React for JSX
import React from 'react'
