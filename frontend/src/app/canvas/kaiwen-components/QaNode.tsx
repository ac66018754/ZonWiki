/**
 * QA 節點 — React Flow 自訂節點元件
 *
 * 功能：
 * - 顯示節點內容（Markdown）、時間戳、AI 模型
 * - 節點狀態：使用者提問 / AI 回答 / 圖片
 * - 操作：編輯、刪除、求 AI、生圖、提問、選取標註
 * - 可拖曳調整大小（NodeResizer）
 * - 4 向連接點（上下左右）
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type Node as RfNode, type NodeProps } from '@xyflow/react'
import type { AiModelDto, HighlightDto, InlineLinkDto, NodeDto } from '../kaiwen-types'
import { formatDateTime, formatShort } from '../lib/datetime'
import { captureSelection } from '../lib/anchor'
import { NodeContent } from './NodeContent'
import { SelectionPopover } from './SelectionPopover'

/**
 * 節點資料結構
 */
export interface QaNodeData {
  /** 節點實體 */
  node: NodeDto
  /** 節點的高亮標註 */
  highlights: HighlightDto[]
  /** 節點的行內連結 */
  links: InlineLinkDto[]
  /** 是否被聚光（邊聚光時） */
  spotlight: boolean
  /** 是否正在等待 AI 回應 */
  pending: boolean
  /** 可用節點列表（用於行內連結目標） */
  nodeOptions: { id: string; label: string }[]
  /** AI 模型列表 */
  modelOptions: AiModelDto[]
  /** 時區 */
  timezone?: string

  // ========== 回調函式 ==========

  /** 求 AI 回應 */
  onAsk: () => void
  /** 提問（接續對話） */
  onFollowup: (question: string) => void
  /** 中止 AI 生成 */
  onCancel: () => void
  /** 設定節點 AI 模型 */
  onSetModel: (model: string) => void
  /** 生圖 */
  onGenerateImage: (imageModelKey?: string) => void
  /** 行內生圖（選取片段） */
  onGenerateImageInline: (
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string
  ) => void
  /** 是否有圖片模型可用 */
  hasImageModel: boolean
  /** 圖片模型列表 */
  imageModelOptions: AiModelDto[]
  /** 行內提問（選取片段） */
  onAskInline: (
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    question: string
  ) => void
  /** 新增高亮 */
  onHighlight: (
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    color: string
  ) => void
  /** 新增行內連結 */
  onLinkToNode: (
    anchorText: string,
    start: number,
    end: number,
    prefix: string,
    suffix: string,
    targetNodeId: string
  ) => void
  /** 刪除高亮 */
  onDeleteHighlight: (id: string) => void
  /** 行內連結點擊 */
  onLinkClick: (linkId: string) => void
  /** 編輯內容 */
  onEditContent: (content: string) => void
  /** 刪除節點 */
  onDelete: () => void
  /** 調整大小 */
  onResize: (width: number, height: number) => void

  [key: string]: unknown
}

/**
 * React Flow 節點型別
 */
export type QaRfNode = RfNode<QaNodeData, 'qa'>

/**
 * 節點最小寬度
 * 需大到讓表頭（時間/模型/按鈕）完整顯示，文字不被截斷
 */
export const NODE_MIN_WIDTH = 408

/**
 * 連接點樣式
 */
const HANDLE_CLASS = '!h-2.5 !w-2.5 !border !border-[var(--kw-border-strong)] !bg-[var(--kw-surface)]'

/**
 * 活動文字選取資訊
 */
interface ActiveSelection {
  text: string
  start: number
  end: number
  prefix: string
  suffix: string
  rect: DOMRect
}

/**
 * QA 節點元件實作
 *
 * 佈局：
 * 1. 表頭：時間 + 操作按鈕（求AI / 提問 / 生圖 / 中止 / 刪除）
 * 2. 模型列：節點 ID + 模型下拉
 * 3. 提問框：若為 AI 節點且未編輯，顯示提問輸入框
 * 4. 內容區：Markdown 渲染或 textarea 編輯
 * 5. 選取框：滑鼠釋放時顯示的提問/標註彈窗（位置由 SelectionPopover 控制）
 */
function QaNodeComponent({ data, selected }: NodeProps<QaRfNode>) {
  const { node } = data

  // 節點來源決定可用動作
  const origin = node.Node_Origin ?? 'user'
  const canAsk = origin === 'user' // 求 AI 回應 + 生圖
  const canFollowup = origin === 'ai' // 提問
  const showModel = canAsk || canFollowup

  // 狀態管理
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.Node_Content)
  const [selection, setSelection] = useState<ActiveSelection | null>(null)
  const [followUp, setFollowUp] = useState<string | null>(null)

  // 節點 ID 複製提示
  const [idCopied, setIdCopied] = useState(false)
  const copyNodeId = () => {
    navigator.clipboard?.writeText(node.Node_Id).catch(() => undefined)
    setIdCopied(true)
    window.setTimeout(() => setIdCopied(false), 1500)
  }

  const timezone = data.timezone || 'UTC'

  /**
   * 滑鼠釋放時檢測文字選取
   * 若未在編輯模式且節點有內容，擷取選取資訊供 SelectionPopover 使用
   */
  const handleMouseUp = () => {
    if (editing || !contentRef.current) return
    if (node.Node_Content.length === 0) return

    const sel = captureSelection(contentRef.current)
    if (sel) {
      const range = window.getSelection()?.getRangeAt(0)
      if (range) {
        setSelection({ ...sel, rect: range.getBoundingClientRect() })
      }
    } else {
      setSelection(null)
    }
  }

  /**
   * 清除選取與 DOM 選取狀態
   */
  const clearSelection = () => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  /**
   * 點擊節點外部時關閉選取框
   * 使用捕獲階段搶在 React Flow 的 pane 事件之前
   */
  useEffect(() => {
    if (!selection) return

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-testid="selection-popover"]')) {
        setSelection(null)
        window.getSelection()?.removeAllRanges()
      }
    }

    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [selection])

  return (
    <div
      className={`kw-card flex h-full w-full flex-col rounded-xl border shadow-sm ${
        data.spotlight ? 'node-spotlight' : selected ? 'kw-card-selected' : ''
      }`}
      data-testid="qa-node"
    >
      {/* 節點大小調整控制 */}
      <NodeResizer
        minWidth={NODE_MIN_WIDTH}
        minHeight={90}
        isVisible={selected}
        onResizeEnd={(_: unknown, p: { width: number; height: number }) => data.onResize(p.width, p.height)}
      />

      {/* 連接點：上下左右 */}
      <Handle type="source" position={Position.Top} id="t" className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Right} id="r" className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Bottom} id="b" className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Left} id="l" className={HANDLE_CLASS} />

      {/* 表頭：時間戳與操作按鈕 */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--kw-border)] px-2 py-1">
        <div
          className="kw-muted shrink-0 whitespace-nowrap text-[9px] leading-tight"
          title={`建立時間：${formatDateTime(node.Node_CreatedDateTime, timezone)}\n編輯時間：${formatDateTime(node.Node_UpdatedDateTime, timezone)}`}
          data-testid="node-dates"
        >
          <div>建立時間：{formatShort(node.Node_CreatedDateTime, timezone)}</div>
          <div>編輯時間：{formatShort(node.Node_UpdatedDateTime, timezone)}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {data.pending ? (
            // AI 生成中：顯示中止鈕
            <button
              className="nodrag rounded border border-[var(--kw-border)] bg-[var(--kw-danger-soft-bg)] px-1.5 py-0.5 text-xs font-medium text-[var(--kw-danger-soft-fg)] hover:brightness-95"
              title="中斷此回答的生成（已生成內容會保留）"
              onClick={data.onCancel}
              data-testid="cancel-ask"
            >
              ■ 中斷
            </button>
          ) : (
            <>
              {/* 求 AI 回應（使用者節點） */}
              {canAsk && (
                <button
                  className="nodrag rounded px-1.5 py-0.5 text-xs font-medium text-[var(--kw-accent-soft-fg)] hover:bg-[var(--kw-accent-soft-bg)]"
                  title="以此節點內容請 AI 回應（產生連結的回答節點）"
                  onClick={data.onAsk}
                  data-testid="ask-node"
                >
                  ▶ 請AI回應
                </button>
              )}

              {/* 提問（AI 節點） */}
              {canFollowup && (
                <button
                  className="nodrag rounded px-1.5 py-0.5 text-xs font-medium text-[var(--kw-success-soft-fg)] hover:bg-[var(--kw-success-soft-bg)]"
                  title="提問（接續這段對話再問）"
                  onClick={() => setFollowUp((v) => (v === null ? '' : null))}
                  data-testid="followup-toggle"
                >
                  💬 提問
                </button>
              )}

              {/* 生圖（使用者節點） */}
              {canAsk && data.hasImageModel && (
                <button
                  className="nodrag rounded px-1.5 py-0.5 text-xs font-medium text-[var(--kw-accent-soft-fg)] hover:bg-[var(--kw-accent-soft-bg)]"
                  title="以此節點內容生成圖片"
                  onClick={() => data.onGenerateImage()}
                  data-testid="generate-image"
                >
                  🖼 生圖
                </button>
              )}

              {/* 刪除鈕：先確認再刪。刪除為軟刪除，可在「垃圾桶」復原。 */}
              <button
                className="nodrag kw-muted text-xs hover:text-[var(--kw-danger)]"
                title="刪除節點（可在垃圾桶復原）"
                onClick={() => {
                  if (
                    window.confirm(
                      '確定要刪除此節點嗎？\n刪除後會移到「垃圾桶」，可隨時復原。'
                    )
                  ) {
                    data.onDelete()
                  }
                }}
                data-testid="delete-node"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {/* 模型列：節點 ID + 模型下拉 */}
      {showModel && (
        <div className="flex items-center gap-1.5 border-b border-[var(--kw-border)] px-2 py-1">
          <button
            className="nodrag shrink-0 rounded bg-[var(--kw-code)] px-1 font-mono text-[9px] text-[var(--kw-muted)] hover:text-[var(--kw-text)]"
            onClick={copyNodeId}
            data-testid="node-id-chip"
            title={`節點編號 ${node.Node_Id}（點擊複製）`}
          >
            {idCopied ? '已複製' : `#${node.Node_Id.slice(0, 5)}`}
          </button>

          <span className="kw-muted shrink-0 text-[10px]">模型</span>

          <select
            className="nodrag min-w-0 flex-1 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-1.5 py-0.5 text-[11px] text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
            title="選擇此節點提問所用的 AI 模型"
            value={node.Node_Model ?? ''}
            onChange={(e) => data.onSetModel(e.target.value)}
            data-testid="node-model"
          >
            <option value="">自動（用預設）</option>
            {data.modelOptions.map((m: AiModelDto, i: number) => (
              <option key={`${m.Key}-${i}`} value={m.Key}>
                {m.Label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 提問框：AI 節點且未編輯 */}
      {!editing && followUp !== null && canFollowup && (
        <div className="nodrag flex gap-1 border-b border-[var(--kw-border)] p-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
            placeholder="接續這段對話追問…"
            value={followUp}
            autoFocus
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && followUp.trim()) {
                data.onFollowup(followUp.trim())
                setFollowUp(null)
              }
            }}
            data-testid="followup-input"
          />
          <button
            className="rounded border border-[var(--kw-border)] bg-[var(--kw-success-soft-bg)] px-2 text-xs font-medium text-[var(--kw-success-soft-fg)] hover:brightness-95 disabled:opacity-40"
            disabled={!followUp.trim()}
            onClick={() => {
              data.onFollowup(followUp.trim())
              setFollowUp(null)
            }}
            data-testid="followup-submit"
          >
            問
          </button>
        </div>
      )}

      {/* 編輯或顯示內容 */}
      {editing ? (
        <textarea
          className="nodrag m-2 h-40 flex-1 resize-none rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] p-2 text-sm text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== node.Node_Content) {
              data.onEditContent(draft)
            }
          }}
          data-testid="content-editor"
        />
      ) : (
        <NodeContent
          content={node.Node_Content}
          highlights={data.highlights.map((h: HighlightDto) => ({
            id: h.Highlight_Id,
            anchorText: h.Highlight_AnchorText,
            start: h.Highlight_Start,
            prefix: h.Highlight_AnchorPrefix,
            suffix: h.Highlight_AnchorSuffix,
            color: h.Highlight_Color,
          }))}
          links={data.links.map((l: InlineLinkDto) => ({
            id: l.InlineLink_Id,
            anchorText: l.InlineLink_AnchorText,
            start: l.InlineLink_AnchorStart,
            prefix: l.InlineLink_AnchorPrefix,
            suffix: l.InlineLink_AnchorSuffix,
            detached: l.InlineLink_Detached,
          }))}
          editing={editing}
          pending={data.pending}
          containerRef={contentRef as React.RefObject<HTMLDivElement>}
          onMouseUp={handleMouseUp}
          onLinkClick={data.onLinkClick}
          onHighlightClick={data.onDeleteHighlight}
          onStartEdit={() => {
            setSelection(null)
            window.getSelection()?.removeAllRanges()
            setDraft(node.Node_Content)
            setEditing(true)
          }}
        />
      )}

      {/* 文字選取彈窗：框選後浮現，可提問 / 畫重點 / 連結到其他節點 / 生圖 */}
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          anchorText={selection.text}
          nodeOptions={data.nodeOptions}
          onAsk={(question) => {
            if (!question.trim()) return
            data.onAskInline(
              selection.text,
              selection.start,
              selection.end,
              selection.prefix,
              selection.suffix,
              question.trim()
            )
            clearSelection()
          }}
          onHighlight={(color) => {
            data.onHighlight(
              selection.text,
              selection.start,
              selection.end,
              selection.prefix,
              selection.suffix,
              color
            )
            clearSelection()
          }}
          onLinkToNode={(targetNodeId) => {
            data.onLinkToNode(
              selection.text,
              selection.start,
              selection.end,
              selection.prefix,
              selection.suffix,
              targetNodeId
            )
            clearSelection()
          }}
          onGenerateImage={
            data.hasImageModel
              ? () => {
                  data.onGenerateImageInline(
                    selection.text,
                    selection.start,
                    selection.end,
                    selection.prefix,
                    selection.suffix
                  )
                  clearSelection()
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

/**
 * 導出 memoized 版本，避免不必要的重新渲染
 */
export const QaNode = memo(QaNodeComponent)
