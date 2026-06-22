/**
 * useNotifications Hook — 管理通知中心狀態
 *
 * 功能：
 * - 新增、移除、清除通知
 * - 追蹤未讀通知數
 * - 自動過期（可選）
 */

import { useState, useCallback, useMemo } from 'react'

export interface Notification {
  /**
   * 通知唯一 ID
   */
  id?: string

  /**
   * 通知類型
   */
  type: 'success' | 'error' | 'warning' | 'info'

  /**
   * 通知訊息
   */
  message: string

  /**
   * 是否已讀
   */
  read?: boolean

  /**
   * 建立時間戳
   */
  timestamp?: number

  /**
   * 關聯的畫布 ID（跳轉用）
   */
  canvasId?: string

  /**
   * 關聯的節點 ID（跳轉用）
   */
  nodeId?: string
}

export interface NotificationActions {
  /**
   * 新增通知
   */
  push: (notification: Notification) => void

  /**
   * 移除單一通知
   */
  remove: (id: string) => void

  /**
   * 標記全部為已讀
   */
  markAllRead: () => void

  /**
   * 清除全部通知
   */
  clearAll: () => void

  /**
   * 取得未讀通知數
   */
  unread: number

  /**
   * 通知清單
   */
  items: (Notification & { id: string })[]
}

let notificationIdCounter = 0

/**
 * 管理應用通知狀態
 */
export function useNotifications(): NotificationActions {
  const [notifications, setNotifications] = useState<(Notification & { id: string })[]>([])

  const push = useCallback((notification: Notification) => {
    const id = notification.id || `notif-${++notificationIdCounter}`
    const item: Notification & { id: string } = {
      ...notification,
      id,
      read: notification.read ?? false,
      timestamp: notification.timestamp ?? Date.now(),
    }
    setNotifications((prev) => [item, ...prev])

    // 非 error 類型自動過期（5 秒後移除）
    if (notification.type !== 'error') {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id))
      }, 5000)
    }
  }, [])

  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true }))
    )
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  const unread = notifications.filter((n) => !n.read).length

  // 回傳物件用 useMemo 穩定化：方法皆為 useCallback(穩定)，只有 items/unread 變動才換新物件。
  // 否則每次重繪都產生新物件，會讓相依它的 useCallback/effect(如 refreshCanvases)無限重建 → 請求風暴。
  return useMemo(
    () => ({ push, remove, markAllRead, clearAll, unread, items: notifications }),
    [push, remove, markAllRead, clearAll, unread, notifications]
  )
}
