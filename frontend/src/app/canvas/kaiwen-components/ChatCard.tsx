/**
 * 聊天卡片：聊天視圖中的單一節點卡片
 *
 * 功能：
 * - 顯示節點內容（Markdown 渲染 + 高亮 + 行內連結）
 * - 支援編輯模式（雙擊進入）
 * - 複用 NodeContent 與 SelectionPopover
 * - 支援框選提問、畫重點、生圖、連結等操作
 * - 依節點來源（user/ai/image）顯示對應 AI 動作
 * - 分叉處顯示「n/m」與切換兄弟按鈕
 */

import { useEffect, useRef, useState } from 'react'
import React from 'react'
import type { AiModelDto, HighlightDto, InlineLinkDto, NodeDto } from '../kaiwen-types'
import type { CanvasActions } from '../hooks/useCanvas'
import { captureSelection } from '../lib/anchor'
import { NodeContent } from './NodeContent'
import { SelectionPopover } from './SelectionPopover'

/**
 * 聊天卡片的 props 介面
 */
interface ChatCardProps {
  /** 節點資料 */
  node: NodeDto
  /** 該節點的高亮列表 */
  highlights: HighlightDto[]
  /** 該節點的行內連結列表 */
  links: InlineLinkDto[]
  /** 是否正在等待 AI 回應 */
  pending: boolean
  /** 是否為目前焦點節點 */
  current: boolean
  /** 非圖片 AI 模型選項 */
  modelOptions: AiModelDto[]
  /** 圖片 AI 模型選項 */
  imageModelOptions: AiModelDto[]
  /** 其他節點選項（用於「連結到」下拉單） */
  nodeOptions: { id: string; label: string }[]
  /** 此節點在兄弟中的索引 */
  siblingIndex: number
  /** 兄弟總數 */
  siblingCount: number
  /** 上一個兄弟按鈕回調 */
  onPrevSibling: () => void
  /** 下一個兄弟按鈕回調 */
  onNextSibling: () => void
  /** 節點操作方法 */
  actions: CanvasActions
  /** 點擊卡片任一處（非拖曳選字）即把它設為「目前節點」 */
  onActivate: () => void
  /** 點擊行內連結時跳到對應節點 */
  onJump: (nodeId: string) => void
}

/**
 * 文本選取的相關資訊
 */
interface ActiveSelection {
  /** 選取的文字 */
  text: string
  /** 開始位置 */
  start: number
  /** 結束位置 */
  end: number
  /** 前文窗 */
  prefix: string
  /** 後文窗 */
  suffix: string
  /** 選取的邊界矩形 */
  rect: DOMRect
}

/**
 * 聊天卡片主元件
 *
 * 流程：
 * 1. 渲染卡片標題列（節點 ID、模型選擇、AI 動作按鈕）
 * 2. 若編輯模式：顯示 textarea
 * 3. 若正常：使用 NodeContent 顯示 Markdown + 標註
 * 4. 框選文字時，用 SelectionPopover 浮現操作面板
 */
export function ChatCard({
  node,
  highlights,
  links,
  pending,
  current,
  modelOptions,
  imageModelOptions,
  nodeOptions,
  siblingIndex,
  siblingCount,
  onPrevSibling,
  onNextSibling,
  actions,
  onActivate,
  onJump,
}: ChatCardProps) {
  /** 內容容器的 DOM 參考 */
  const contentRef = useRef<HTMLDivElement | null>(null)

  /** 是否進入編輯模式 */
  const [editing, setEditing] = useState(false)
  /** 編輯草稿（暫存編輯中的內容） */
  const [draft, setDraft] = useState(node.Node_Content)
  /** 當前的文本選取 */
  const [selection, setSelection] = useState<ActiveSelection | null>(null)
  /** 提問輸入框的狀態（null 表示未開啟，字串表示輸入中） */
  const [followUp, setFollowUp] = useState<string | null>(null)
  /** 生圖菜單的開啟狀態 */
  const [imgMenu, setImgMenu] = useState(false)
  /** 生圖菜單的 DOM 參考（用於檢測點擊範圍） */
  const imgMenuRef = useRef<HTMLDivElement>(null)
  /** 複製 ID 後的反饋狀態 */
  const [copied, setCopied] = useState(false)

  /**
   * 複製節點 ID 並短暫顯示反饋
   */
  const copyId = () => {
    navigator.clipboard?.writeText(node.Node_Id).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  /**
   * 判斷節點來源與可用操作
   *
   * - user：使用者輸入，可「請 AI 回應」、生圖
   * - ai：AI 回答，可「提問」（follow-up）
   * - image：圖片節點，通常無操作
   */
  const origin = node.Node_Origin ?? 'user'
  const canAsk = origin === 'user'
  const canFollowup = origin === 'ai'
  const showModel = canAsk || canFollowup
  const hasImageModel = imageModelOptions.length > 0

  /**
   * 生圖菜單：點擊外側關閉
   */
  useEffect(() => {
    if (!imgMenu) return

    const onDown = (e: MouseEvent) => {
      if (!imgMenuRef.current?.contains(e.target as Node)) {
        setImgMenu(false)
      }
    }

    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [imgMenu])

  /**
   * 文本選取浮現面板：點擊外側關閉
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

  /**
   * 滑鼠釋放時檢測文本選取
   * 若有效的文本選取，則記錄位置與內容供 SelectionPopover 顯示
   */
  const handleMouseUp = () => {
    if (editing || !contentRef.current || node.Node_Content.length === 0) return

    const sel = captureSelection(contentRef.current)
    const range = window.getSelection()

    if (sel && range && range.rangeCount > 0) {
      setSelection({ ...sel, rect: range.getRangeAt(0).getBoundingClientRect() })
    } else {
      setSelection(null)
    }
  }

  /**
   * 清除文本選取
   */
  const clearSelection = () => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  /** 按鈕樣式類別 */
  const btn = 'nodrag rounded px-1.5 py-0.5 text-xs font-medium'

  return (
    <div
      className={`kw-card rounded-xl border shadow-sm ${current ? 'kw-card-selected' : ''}`}
      data-testid="chat-card"
      data-node-id={node.Node_Id}
      onClick={onActivate}
    >
      {/* ========== 動作列 ========== */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--kw-border)] px-2 py-1">
        {/* 左側：節點 ID、兄弟切換、模型選擇 */}
        <div className="flex min-w-0 items-center gap-1.5">
          {/* 節點 ID 按鈕 */}
          <button
            className="shrink-0 rounded bg-[var(--kw-code)] px-1 font-mono text-[9px] text-[var(--kw-muted)] hover:text-[var(--kw-text)]"
            onClick={copyId}
            data-testid="chat-node-id"
            title={`節點編號 ${node.Node_Id}（點擊複製）`}
          >
            {copied ? '已複製' : `#${node.Node_Id.slice(0, 6)}`}
          </button>

          {/* 兄弟切換 */}
          {siblingCount > 1 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--kw-muted)]"
              data-testid="sibling-switch"
            >
              <button
                className="rounded px-1 hover:bg-[var(--kw-surface-2)]"
                onClick={onPrevSibling}
                title="上一個分支"
              >
                ‹
              </button>
              <span>
                {siblingIndex + 1}/{siblingCount}
              </span>
              <button
                className="rounded px-1 hover:bg-[var(--kw-surface-2)]"
                onClick={onNextSibling}
                title="下一個分支"
              >
                ›
              </button>
            </span>
          )}

          {/* AI 模型選擇下拉單 */}
          {showModel && (
            <select
              className="nodrag min-w-0 max-w-[150px] rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-1 py-0.5 text-[10px] text-[var(--kw-text)]"
              title="選擇此節點的 AI 模型"
              value={node.Node_Model ?? ''}
              onChange={(e) => actions.setNodeModel(node.Node_Id, e.target.value)}
            >
              <option value="">自動（用預設）</option>
              {modelOptions.map((m, i) => (
                <option key={`${m.Key}-${i}`} value={m.Key}>
                  {m.Label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 右側：AI 動作按鈕與刪除鈕 */}
        <div className="flex shrink-0 items-center gap-1">
          {pending ? (
            // AI 生成中：顯示中斷按鈕
            <button
              className={`${btn} border border-[var(--kw-border)] bg-[var(--kw-danger-soft-bg)] text-[var(--kw-danger-soft-fg)]`}
              onClick={() => actions.cancelAsk(node.Node_Id)}
              title="中斷生成（保留已生成內容）"
            >
              ■ 中斷
            </button>
          ) : (
            <>
              {/* 請 AI 回應（針對 user 節點） */}
              {canAsk && (
                <button
                  className={`${btn} text-[var(--kw-accent-soft-fg)] hover:bg-[var(--kw-accent-soft-bg)]`}
                  onClick={() => actions.ask(node.Node_Id)}
                >
                  ▶ 請AI回應
                </button>
              )}

              {/* 提問（針對 ai 節點） */}
              {canFollowup && (
                <button
                  className={`${btn} text-[var(--kw-success-soft-fg)] hover:bg-[var(--kw-success-soft-bg)]`}
                  onClick={() => setFollowUp((v) => (v === null ? '' : null))}
                >
                  💬 提問
                </button>
              )}

              {/* 生圖（針對 user 節點 & 有圖片模型） */}
              {canAsk && hasImageModel && (
                imageModelOptions.length <= 1 ? (
                  <button
                    className={`${btn} text-[var(--kw-accent-soft-fg)] hover:bg-[var(--kw-accent-soft-bg)]`}
                    onClick={() =>
                      actions.generateImage(node.Node_Id, imageModelOptions[0]?.Key)
                    }
                  >
                    生圖
                  </button>
                ) : (
                  <div className="relative" ref={imgMenuRef}>
                    <button
                      className={`${btn} text-[var(--kw-accent-soft-fg)] hover:bg-[var(--kw-accent-soft-bg)]`}
                      onClick={() => setImgMenu((v) => !v)}
                    >
                      生圖 ▾
                    </button>
                    {imgMenu && (
                      <div className="kw-popover absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border shadow-xl">
                        {imageModelOptions.map((m) => (
                          <button
                            key={m.Key}
                            className="nodrag block w-full truncate rounded px-2 py-1 text-left text-xs text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]"
                            onClick={() => {
                              actions.generateImage(node.Node_Id, m.Key)
                              setImgMenu(false)
                            }}
                          >
                            {m.Label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </>
          )}

          {/* 刪除節點 */}
          <button
            className="nodrag kw-muted text-xs hover:text-[var(--kw-danger)]"
            onClick={() => actions.deleteNode(node.Node_Id)}
            title="刪除節點"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ========== 提問輸入框（Follow-up） ========== */}
      {followUp !== null && (
        <div className="nodrag flex gap-1 border-b border-[var(--kw-border)] p-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
            placeholder="接續這段對話追問…"
            value={followUp}
            autoFocus
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && followUp.trim()) {
                actions.askFollowup(
                  node.Node_Id,
                  followUp.trim(),
                  '',
                  0,
                  0,
                  '',
                  ''
                )
                setFollowUp(null)
              }
            }}
          />
          <button
            className="rounded border border-[var(--kw-border)] bg-[var(--kw-success-soft-bg)] px-2 text-xs font-medium text-[var(--kw-success-soft-fg)] disabled:opacity-40"
            disabled={!followUp.trim()}
            onClick={() => {
              actions.askFollowup(
                node.Node_Id,
                followUp.trim(),
                '',
                0,
                0,
                '',
                ''
              )
              setFollowUp(null)
            }}
          >
            問
          </button>
        </div>
      )}

      {/* ========== 內容區 ========== */}
      {editing ? (
        // 編輯模式：textarea
        <textarea
          className="nodrag m-2 h-40 resize-none rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] p-2 text-sm text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
          style={{ width: 'calc(100% - 1rem)' }}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== node.Node_Content) {
              actions.updateNodeContent(node.Node_Id, draft)
            }
          }}
        />
      ) : (
        // 顯示模式：Markdown + 標註
        <NodeContent
          content={node.Node_Content}
          highlights={highlights.map((h) => ({
            id: h.Highlight_Id,
            anchorText: h.Highlight_AnchorText,
            start: h.Highlight_Start,
            prefix: h.Highlight_AnchorPrefix,
            suffix: h.Highlight_AnchorSuffix,
            color: h.Highlight_Color,
          }))}
          links={links.map((l) => ({
            id: l.InlineLink_Id,
            anchorText: l.InlineLink_AnchorText,
            start: l.InlineLink_AnchorStart,
            prefix: l.InlineLink_AnchorPrefix,
            suffix: l.InlineLink_AnchorSuffix,
            detached: l.InlineLink_Detached,
          }))}
          editing={editing}
          pending={pending}
          containerRef={contentRef as React.RefObject<HTMLDivElement>}
          onMouseUp={handleMouseUp}
          onLinkClick={(linkId) => {
            const l = links.find((x) => x.InlineLink_Id === linkId)
            if (l) onJump(l.InlineLink_TargetNodeId)
          }}
          onHighlightClick={(id) => actions.deleteHighlight(id)}
          onStartEdit={() => {
            clearSelection()
            setDraft(node.Node_Content)
            setEditing(true)
          }}
        />
      )}

      {/* ========== 文本選取浮現面板 ========== */}
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          anchorText={selection.text}
          nodeOptions={nodeOptions}
          onAsk={(question) => {
            actions.askInlineLink(
              node.Node_Id,
              selection.text,
              selection.start,
              selection.end,
              selection.prefix,
              selection.suffix,
              question
            )
            clearSelection()
          }}
          onHighlight={(color) => {
            actions.addHighlight(
              node.Node_Id,
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
            actions.linkToNode(
              node.Node_Id,
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
            hasImageModel
              ? () => {
                  actions.generateImageInline(
                    node.Node_Id,
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
