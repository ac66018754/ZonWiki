/**
 * 右側編輯面板 — 節點內容編輯、行內連結與邊管理
 *
 * 功能：
 * - 編輯節點內容（Markdown textarea）
 * - 管理可點擊連結（outgoing）：選色、改目標、刪除、導覽
 * - 管理反向連結（incoming）：導覽、刪除
 * - 相連邊（edges）：刪除
 * - 節點資訊（ID、建立/編輯時間）
 * - 節點刪除
 */

import { useEffect, useState, useCallback } from 'react'
import type { EdgeDto, InlineLinkDto, NodeDto } from '../kaiwen-types'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { LinkedEntitiesBar } from '@/components/LinkedEntitiesBar'
import { useConfirm } from '@/components/ConfirmProvider'

interface RightDrawerProps {
  /**
   * 當前編輯的節點
   */
  node: NodeDto

  /**
   * 所有節點對映（用於反向連結顯示）
   */
  nodes: Record<string, NodeDto>

  /**
   * 節點選項（用於改連結目標）
   */
  nodeOptions: { id: string; label: string }[]

  /**
   * 來自此節點的行內連結（可點擊文字）
   */
  outgoingLinks: InlineLinkDto[]

  /**
   * 連到此節點的行內連結（反向連結）
   */
  incomingLinks: InlineLinkDto[]

  /**
   * 相連的邊（outgoing + incoming）
   */
  edges: EdgeDto[]

  /**
   * 關閉面板
   */
  onClose: () => void

  /**
   * 儲存內容變更
   */
  onSaveContent: (content: string) => void

  /**
   * 刪除節點
   */
  onDeleteNode: () => void

  /**
   * 刪除邊
   */
  onDeleteEdge: (edgeId: string) => void

  /**
   * 刪除行內連結
   */
  onDeleteLink: (linkId: string) => void

  /**
   * 更新行內連結目標
   */
  onUpdateLinkTarget: (linkId: string, targetNodeId: string) => void

  /**
   * 導覽到節點（平移）
   */
  onNavigate: (nodeId: string) => void

  /**
   * 時區（用於日期顯示）
   */
  timezone?: string
}

/**
 * 格式化日期時間
 */
function formatDateTime(isoString?: string, timezone = 'UTC'): string {
  if (!isoString) return '無'
  try {
    const date = new Date(isoString)
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: timezone,
    }).format(date)
  } catch {
    return isoString
  }
}

/**
 * 產生節點內容摘要（用於連結目標選擇框）
 */
function snippet(nodes: Record<string, NodeDto>, id: string): string {
  const content = nodes[id]?.Node_Content?.trim()
  if (!content) return '(已刪除/空白)'
  return content.length > 22 ? content.slice(0, 22) + '…' : content
}

/**
 * 右側編輯面板
 */
export function RightDrawer({
  node,
  nodes,
  nodeOptions,
  outgoingLinks,
  incomingLinks,
  edges,
  onClose,
  onSaveContent,
  onDeleteNode,
  onDeleteEdge,
  onDeleteLink,
  onUpdateLinkTarget,
  onNavigate,
  timezone = 'UTC',
}: RightDrawerProps) {
  const confirm = useConfirm()
  // 編輯草稿狀態
  const [draft, setDraft] = useState(node.Node_Content)

  useEffect(() => {
    // 使用 queueMicrotask 延遲 setState，避免同步呼叫
    queueMicrotask(() => {
      setDraft(node.Node_Content)
    })
  }, [node.Node_Id, node.Node_Content])

  // 複製節點 ID 提示
  const [copied, setCopied] = useState(false)
  const copyId = () => {
    navigator.clipboard?.writeText(node.Node_Id).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  // 分組邊
  const outgoingEdges = edges.filter((e) => e.Edge_SourceNodeId === node.Node_Id)
  const incomingEdges = edges.filter((e) => e.Edge_TargetNodeId === node.Node_Id)

  return (
    <aside
      className="kw-drawer flex h-full w-[340px] max-w-[92vw] shrink-0 flex-col border-l shadow-xl"
      data-testid="right-drawer"
      style={{
        borderColor: 'var(--kw-border)',
        backgroundColor: 'var(--kw-surface-2)',
        color: 'var(--kw-text)',
      }}
    >
      {/* 頂部標題列 */}
      <header
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: 'var(--kw-border)' }}
      >
        <span className="text-sm font-semibold">節點編輯</span>
        <button
          className="rounded p-1 text-[var(--kw-muted)] hover:bg-[var(--kw-surface)] hover:text-[var(--kw-text)]"
          onClick={onClose}
          title="關閉"
          data-testid="drawer-close"
        >
          ✕
        </button>
      </header>

      {/* 滾動內容區 */}
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        style={{
          backgroundColor: 'var(--kw-surface-2)',
        }}
      >
        {/* 節點資訊 */}
        <section className="text-[11px] text-[var(--kw-muted)]" data-testid="drawer-dates">
          <div className="mb-1 flex items-center gap-1">
            <span className="shrink-0">節點編號</span>
            <code
              className="min-w-0 flex-1 select-all break-all rounded px-1 py-0.5 font-mono text-[10px] text-[var(--kw-text)]"
              style={{ backgroundColor: 'var(--kw-code)' }}
              data-testid="drawer-node-id"
              title="點「複製」或直接選取整段"
            >
              {node.Node_Id}
            </code>
            <button
              className="shrink-0 rounded px-1 hover:text-[var(--kw-text)]"
              onClick={copyId}
              data-testid="copy-node-id"
              title="複製節點編號"
            >
              {copied ? '已複製' : '📋'}
            </button>
          </div>
          <div>建立：{formatDateTime(node.Node_CreatedDateTime, timezone)}</div>
          <div>最後編輯：{formatDateTime(node.Node_UpdatedDateTime, timezone)}</div>
        </section>

        {/* 關聯列：此節點關聯的任務/子任務/筆記，可搜尋既有項目來關聯（點任務→回到當天行事曆） */}
        <LinkedEntitiesBar
          type="node"
          id={node.Node_Id}
          sourceTitle={(node.Node_Content || '').split('\n')[0].slice(0, 60)}
        />

        {/* 內容編輯 */}
        <section>
          <div className="mb-1 text-[11px] font-medium text-[var(--kw-muted)]">
            內容（Markdown）
          </div>
          <MarkdownEditor
            key={node.Node_Id}
            value={draft}
            onChange={setDraft}
            onBlur={() => draft !== node.Node_Content && onSaveContent(draft)}
            minHeight={160}
            placeholder="用 Markdown 撰寫內容…"
          />
        </section>

        {/* 可點擊連結（outgoing） */}
        <section>
          <div className="mb-1 text-[11px] font-medium text-[var(--kw-muted)]">
            可點擊連結（此節點內 → 其他節點）
          </div>
          {outgoingLinks.length === 0 ? (
            <p className="text-[11px] text-[var(--kw-muted)]">尚無。框選文字並提問即可建立。</p>
          ) : (
            <ul className="space-y-1">
              {outgoingLinks.map((link) => (
                <li
                  key={link.InlineLink_Id}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
                  style={{
                    borderColor: 'var(--kw-border)',
                    backgroundColor: 'var(--kw-surface)',
                  }}
                >
                  <span
                    className="shrink-0 rounded px-1 text-[var(--kw-primary-soft-fg)]"
                    style={{ backgroundColor: 'var(--kw-primary-soft-bg)' }}
                  >
                    「{link.InlineLink_AnchorText.slice(0, 8)}」
                  </span>
                  <span style={{ color: 'var(--kw-muted)' }}>→</span>
                  <select
                    className="min-w-0 flex-1 rounded border px-1 py-0.5"
                    style={{
                      borderColor: 'var(--kw-border)',
                      backgroundColor: 'var(--kw-surface)',
                      color: 'var(--kw-text)',
                    }}
                    value={link.InlineLink_TargetNodeId}
                    onChange={(e) => onUpdateLinkTarget(link.InlineLink_Id, e.target.value)}
                    title="改連結目標"
                  >
                    {!nodeOptions.some((o) => o.id === link.InlineLink_TargetNodeId) && (
                      <option value={link.InlineLink_TargetNodeId}>
                        {snippet(nodes, link.InlineLink_TargetNodeId)}
                      </option>
                    )}
                    {nodeOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="shrink-0 font-medium hover:underline"
                    style={{ color: 'var(--kw-accent-soft-fg)' }}
                    onClick={() => onNavigate(link.InlineLink_TargetNodeId)}
                    title="跳到目標"
                  >
                    跳
                  </button>
                  <button
                    className="shrink-0 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                    onClick={() => onDeleteLink(link.InlineLink_Id)}
                    title="刪除連結"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 反向連結（incoming） */}
        <section>
          <div className="mb-1 text-[11px] font-medium text-[var(--kw-muted)]">
            反向連結（其他節點 → 此節點）
          </div>
          {incomingLinks.length === 0 ? (
            <p className="text-[11px] text-[var(--kw-muted)]">尚無。</p>
          ) : (
            <ul className="space-y-1">
              {incomingLinks.map((link) => (
                <li
                  key={link.InlineLink_Id}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
                  style={{
                    borderColor: 'var(--kw-border)',
                    backgroundColor: 'var(--kw-surface)',
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {snippet(nodes, link.InlineLink_SourceNodeId)}
                  </span>
                  <span
                    className="shrink-0 rounded px-1 text-[var(--kw-accent-soft-fg)]"
                    style={{ backgroundColor: 'var(--kw-accent-soft-bg)' }}
                  >
                    「{link.InlineLink_AnchorText.slice(0, 8)}」
                  </span>
                  <button
                    className="shrink-0 font-medium hover:underline"
                    style={{ color: 'var(--kw-accent-soft-fg)' }}
                    onClick={() => onNavigate(link.InlineLink_SourceNodeId)}
                    title="跳到來源"
                  >
                    跳
                  </button>
                  <button
                    className="shrink-0 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                    onClick={() => onDeleteLink(link.InlineLink_Id)}
                    title="刪除連結"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 相連邊 */}
        <section>
          <div className="mb-1 text-[11px] font-medium text-[var(--kw-muted)]">
            相連邊（outgoing + incoming）
          </div>
          {outgoingEdges.length === 0 && incomingEdges.length === 0 ? (
            <p className="text-[11px] text-[var(--kw-muted)]">尚無。拖曳節點即可建立。</p>
          ) : (
            <div className="space-y-2">
              {/* Outgoing 邊 */}
              {outgoingEdges.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold text-[var(--kw-primary)]">
                    送出邊
                  </div>
                  <ul className="space-y-1">
                    {outgoingEdges.map((edge) => (
                      <li
                        key={edge.Edge_Id}
                        className="flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
                        style={{
                          borderColor: 'var(--kw-border)',
                          backgroundColor: 'var(--kw-surface)',
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          → {snippet(nodes, edge.Edge_TargetNodeId)}
                        </span>
                        <button
                          className="shrink-0 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                          onClick={() => onDeleteEdge(edge.Edge_Id)}
                          title="刪除邊"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Incoming 邊 */}
              {incomingEdges.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold text-[var(--kw-accent)]">
                    接收邊
                  </div>
                  <ul className="space-y-1">
                    {incomingEdges.map((edge) => (
                      <li
                        key={edge.Edge_Id}
                        className="flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
                        style={{
                          borderColor: 'var(--kw-border)',
                          backgroundColor: 'var(--kw-surface)',
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {snippet(nodes, edge.Edge_SourceNodeId)} →
                        </span>
                        <button
                          className="shrink-0 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                          onClick={() => onDeleteEdge(edge.Edge_Id)}
                          title="刪除邊"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 底部刪除按鈕 */}
      <footer
        className="border-t px-4 py-3"
        style={{ borderColor: 'var(--kw-border)' }}
      >
        <button
          className="w-full rounded px-3 py-2 text-sm font-medium text-[var(--kw-danger-soft-fg)] hover:text-[var(--kw-danger)]"
          style={{ backgroundColor: 'var(--kw-danger-soft-bg)' }}
          onClick={async () => {
            if (await confirm({ message: '確定要刪除這個節點嗎？', danger: true })) {
              onDeleteNode()
              onClose()
            }
          }}
          data-testid="delete-node"
        >
          刪除節點
        </button>
      </footer>
    </aside>
  )
}
