/**
 * 垃圾桶 Modal — 管理已刪除的畫布與節點
 *
 * 功能：
 * - 列出已刪除的畫布（含節點數量、刪除時間）
 * - 列出已刪除的節點（含片段、內容預覽、建立/刪除時間、所在畫布）
 * - 提供還原、永久刪除、清空垃圾桶操作
 * - 還原後通知上層重新整理（onRestored 回調）
 */

import { useCallback, useEffect, useState } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import { formatDateTime } from '../lib/datetime'
import type { TrashListingDto } from '../kaiwen-types'
import { useConfirm } from '@/components/ConfirmProvider'

/**
 * TrashModal 對外 props 介面
 */
interface TrashModalProps {
  /**
   * Modal 開啟狀態
   */
  open: boolean

  /**
   * 關閉 modal 時的回調
   */
  onClose: () => void

  /**
   * 任何還原 / 永久刪除操作後的回調：讓上層重新整理畫布清單
   * （還原的節點會由 SSE 即時長回開著的畫布）
   */
  onRestored?: () => void

  /**
   * 使用者時區 (IANA 時區字串，如 "Asia/Taipei")
   * @default "UTC"
   */
  timezone?: string
}

/**
 * 垃圾桶 Modal：fixed 可關閉 modal，列出已刪除項目並支援還原、永久刪除
 */
export function TrashModal({
  open,
  onClose,
  onRestored,
  timezone = 'UTC',
}: TrashModalProps) {
  const confirm = useConfirm()
  // 垃圾桶清單資料
  const [listing, setListing] = useState<TrashListingDto | null>(null)

  // 加載中狀態（初次載入垃圾桶清單）
  const [loading, setLoading] = useState(false)

  // 操作中狀態（還原、刪除、清空時鎖定按鈕）
  const [busy, setBusy] = useState(false)

  // 錯誤或成功訊息
  const [message, setMessage] = useState<string | null>(null)

  /**
   * 重新載入垃圾桶清單
   */
  const reload = useCallback(() => {
    setLoading(true)
    return kaiwenApi
      .getTrash()
      .then(setListing)
      .catch((e) => setMessage(String(e)))
      .finally(() => setLoading(false))
  }, [])

  /**
   * 打開時初始化：載入清單、監聽 Escape 鍵
   */
  useEffect(() => {
    if (!open) return
    setMessage(null)
    reload()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, reload, onClose])

  /**
   * 通用操作包裝：執行中鎖按鈕，完成後重載垃圾桶並通知上層
   */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setMessage(null)
      try {
        await action()
        await reload()
        onRestored?.()
      } catch (e) {
        setMessage(String(e))
      } finally {
        setBusy(false)
      }
    },
    [reload, onRestored]
  )

  if (!open) return null

  const canvases = listing?.Canvases ?? []
  const nodes = listing?.Nodes ?? []
  const isEmpty = canvases.length === 0 && nodes.length === 0
  const totalCount = canvases.length + nodes.length

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        data-testid="trash-modal-backdrop"
      />

      {/* 垃圾桶 Modal */}
      <div
        className="fixed inset-0 z-50 m-auto max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--kw-border)] bg-[var(--kw-bg)] shadow-lg"
        data-testid="trash-modal"
      >
        {/* 標題列 */}
        <header className="kw-header flex shrink-0 items-center justify-between gap-2 border-b border-[var(--kw-border)] px-4 py-3">
          <span className="text-base font-semibold text-[var(--kw-text)]">
            🗑 垃圾桶
            {totalCount > 0 && (
              <span className="ml-1 text-xs font-normal text-[var(--kw-muted)]">
                （{totalCount}）
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {/* 清空垃圾桶按鈕 */}
            <button
              className="rounded border border-[var(--kw-danger)] px-3 py-1 text-sm text-[var(--kw-danger)] hover:bg-[var(--kw-danger-soft-bg)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={async () => {
                if (
                  await confirm({
                    message: '確定要清空垃圾桶嗎？所有項目將「永久刪除」，無法復原。',
                    danger: true,
                    confirmLabel: '永久清空',
                  })
                ) {
                  run(() => kaiwenApi.emptyTrash())
                }
              }}
              disabled={busy || isEmpty}
              data-testid="trash-empty"
              title="永久刪除垃圾桶內所有項目"
            >
              清空垃圾桶
            </button>

            {/* 關閉按鈕 */}
            <button
              className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-3 py-1 text-sm text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]"
              onClick={onClose}
              data-testid="trash-close"
              title="關閉垃圾桶"
            >
              ✕ 關閉
            </button>
          </div>
        </header>

        {/* 內容區域 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-4">
            {/* 錯誤訊息 */}
            {message && (
              <div className="rounded border border-[var(--kw-danger)] bg-[var(--kw-danger-soft-bg)] px-3 py-2 text-sm text-[var(--kw-danger-soft-fg)]">
                ⚠ {message}
              </div>
            )}

            {/* 加載中狀態 */}
            {loading && !listing ? (
              <div className="py-16 text-center text-sm text-[var(--kw-muted)]">
                載入中…
              </div>
            ) : isEmpty ? (
              /* 空狀態 */
              <div className="py-16 text-center text-[var(--kw-muted)]">
                <div className="text-3xl">🗑</div>
                <p className="mt-2 text-sm">垃圾桶是空的。</p>
                <p className="mt-1 text-xs">
                  刪除的畫布或節點會先進到這裡，可隨時還原。
                </p>
              </div>
            ) : (
              <>
                {/* 已刪除的畫布區塊 */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-[var(--kw-text)]">
                    已刪除的畫布
                    {canvases.length > 0 && (
                      <span className="ml-1 text-xs font-normal text-[var(--kw-muted)]">
                        （{canvases.length}）
                      </span>
                    )}
                  </h2>
                  {canvases.length === 0 ? (
                    <div className="text-xs text-[var(--kw-muted)]">
                      沒有已刪除的畫布。
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {canvases.map((c) => (
                        <li
                          key={c.Canvas_Id}
                          className="flex items-center gap-2 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-3 py-2"
                        >
                          {/* 畫布圖示 */}
                          <span
                            className="shrink-0 text-base"
                            title="畫布"
                          >
                            🗂
                          </span>

                          {/* 畫布訊息 */}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-[var(--kw-text)]">
                              {c.Canvas_Title || '(未命名畫布)'}
                            </div>
                            <div className="text-[11px] text-[var(--kw-muted)]">
                              {c.NodeCount} 個節點 · 刪除於{' '}
                              {formatDateTime(c.DeletedAtUtc, timezone)}
                            </div>
                          </div>

                          {/* 還原按鈕 */}
                          <button
                            className="shrink-0 rounded bg-[var(--kw-primary)] px-2.5 py-1 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
                            onClick={() =>
                              run(() => kaiwenApi.restoreCanvas(c.Canvas_Id))
                            }
                            disabled={busy}
                            title="還原此畫布（含其節點）"
                          >
                            還原
                          </button>

                          {/* 永久刪除按鈕 */}
                          <button
                            className="shrink-0 rounded border border-[var(--kw-danger)] px-2.5 py-1 text-xs text-[var(--kw-danger)] hover:bg-[var(--kw-danger-soft-bg)] disabled:opacity-40"
                            onClick={async () => {
                              if (
                                await confirm({
                                  message: `確定要永久刪除畫布「${
                                    c.Canvas_Title || '未命名'
                                  }」嗎？此動作無法復原。`,
                                  danger: true,
                                  confirmLabel: '永久刪除',
                                })
                              ) {
                                run(() => kaiwenApi.purgeCanvas(c.Canvas_Id))
                              }
                            }}
                            disabled={busy}
                            title="永久刪除（無法復原）"
                          >
                            永久刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* 已刪除的節點區塊 */}
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-[var(--kw-text)]">
                    已刪除的節點
                    {nodes.length > 0 && (
                      <span className="ml-1 text-xs font-normal text-[var(--kw-muted)]">
                        （{nodes.length}）
                      </span>
                    )}
                  </h2>
                  {nodes.length === 0 ? (
                    <div className="text-xs text-[var(--kw-muted)]">
                      沒有個別刪除的節點。
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {nodes.map((n) => (
                        <li
                          key={n.Node_Id}
                          className="flex items-start gap-2 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-3 py-2"
                        >
                          {/* 節點圖示 */}
                          <span
                            className="mt-0.5 shrink-0 text-base"
                            title="節點"
                          >
                            📄
                          </span>

                          {/* 節點訊息 */}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-[var(--kw-text)]">
                              {n.Snippet || '(空白節點)'}
                            </div>
                            {n.ContentPreview &&
                              n.ContentPreview !== n.Snippet && (
                                <div className="mt-0.5 line-clamp-2 text-xs text-[var(--kw-muted)]">
                                  {n.ContentPreview}
                                </div>
                              )}
                            <div className="mt-1 text-[11px] text-[var(--kw-muted)]">
                              建立於 {formatDateTime(n.CreatedAtUtc, timezone)} ·
                              刪除於 {formatDateTime(n.DeletedAtUtc, timezone)} ·
                              畫布：{n.Canvas_Title}
                            </div>
                          </div>

                          {/* 還原按鈕 */}
                          <button
                            className="mt-0.5 shrink-0 rounded bg-[var(--kw-primary)] px-2.5 py-1 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
                            onClick={() =>
                              run(() => kaiwenApi.restoreNode(n.Node_Id))
                            }
                            disabled={busy}
                            title="還原此節點"
                          >
                            還原
                          </button>

                          {/* 永久刪除按鈕 */}
                          <button
                            className="shrink-0 rounded border border-[var(--kw-danger)] px-2.5 py-1 text-xs text-[var(--kw-danger)] hover:bg-[var(--kw-danger-soft-bg)] disabled:opacity-40"
                            onClick={async () => {
                              if (
                                await confirm({
                                  message: '確定要永久刪除此節點嗎？此動作無法復原。',
                                  danger: true,
                                  confirmLabel: '永久刪除',
                                })
                              ) {
                                run(() => kaiwenApi.purgeNode(n.Node_Id))
                              }
                            }}
                            disabled={busy}
                            title="永久刪除（無法復原）"
                          >
                            永久刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* 幫助文字 */}
                <div className="text-[11px] text-[var(--kw-muted)]">
                  還原畫布會一併救回其底下的節點與連線；還原的節點會即時長回開著的畫布。「永久刪除」與「清空垃圾桶」皆無法復原。
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
