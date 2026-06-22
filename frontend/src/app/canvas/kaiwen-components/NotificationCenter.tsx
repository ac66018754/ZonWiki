'use client'

import { useEffect, useRef, useState } from 'react'
import type { Notification } from '../hooks/useNotifications'
import { formatDateTime } from '../lib/datetime'

/**
 * 通知中心 Props
 */
interface NotificationCenterProps {
  /** 通知清單（含 id）。 */
  items: (Notification & { id: string })[]
  /** 未讀數。 */
  unread: number
  /** 顯示時區（IANA）。 */
  timezone: string
  /** 標記全部已讀。 */
  onMarkAllRead: () => void
  /** 清除全部。 */
  onClearAll: () => void
  /** 移除單則。 */
  onRemove: (id: string) => void
  /** 前往該通知對應的節點（切畫布並聚焦）。 */
  onJump: (canvasId: string, nodeId?: string) => void
}

/**
 * 通知中心（Header 鈴鐺 + 下拉面板）：累積 AI 錯誤等事件，未讀以紅點數字標示。
 * 點開即標記全部已讀；可逐則前往對應節點、移除，或一鍵清除全部。
 * 移植自原版開問啦 NotificationCenter，欄位改用移植版 useNotifications 的型別（timestamp 為毫秒數）。
 */
export function NotificationCenter({
  items,
  unread,
  timezone,
  onMarkAllRead,
  onClearAll,
  onRemove,
  onJump,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 開啟時：標記全部已讀，並監聽點擊外部關閉。
  useEffect(() => {
    if (!open) return
    onMarkAllRead()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open, onMarkAllRead])

  // 把毫秒時間戳轉成 ISO 字串供 formatDateTime 使用（依使用者時區顯示）
  const fmt = (ts?: number) =>
    ts ? formatDateTime(new Date(ts).toISOString(), timezone) : ''

  return (
    <div className="relative" ref={ref}>
      <button
        className="kw-btn relative"
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-button"
        title="通知中心（AI 錯誤與事件）"
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-[var(--kw-danger)] px-1 text-center text-[10px] font-bold leading-4 text-white"
            data-testid="notification-badge"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="kw-popover absolute right-0 top-full z-50 mt-1 w-96 max-w-[90vw] rounded-lg border shadow-xl"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b border-[var(--kw-border)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--kw-text)]">通知中心</span>
            <button
              className="text-[11px] text-[var(--kw-muted)] hover:text-[var(--kw-danger)] disabled:opacity-40"
              onClick={onClearAll}
              disabled={items.length === 0}
              data-testid="notification-clear"
            >
              清除全部
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-[var(--kw-muted)]">目前沒有通知 🎉</div>
            ) : (
              <ul className="divide-y divide-[var(--kw-border)]">
                {items.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 px-3 py-2">
                    <span
                      className={`mt-0.5 shrink-0 text-xs ${n.type === 'error' ? 'text-[var(--kw-danger)]' : 'text-[var(--kw-muted)]'}`}
                      title={n.type === 'error' ? '錯誤' : '訊息'}
                    >
                      {n.type === 'error' ? '⚠' : 'ℹ'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-xs text-[var(--kw-text)]">{n.message}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[10px] text-[var(--kw-muted)]">{fmt(n.timestamp)}</span>
                        {n.canvasId && n.nodeId && (
                          <button
                            className="text-[10px] text-[var(--kw-accent-soft-fg)] hover:underline"
                            onClick={() => {
                              onJump(n.canvasId!, n.nodeId)
                              setOpen(false)
                            }}
                          >
                            前往節點 ↗
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      className="shrink-0 text-xs text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                      onClick={() => onRemove(n.id)}
                      title="移除此通知"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
