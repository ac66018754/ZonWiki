'use client'

/**
 * KaiWen 畫布元件 — 主容器
 * 移植自開問啦原始 App.tsx，適配 ZonWiki 架構
 *
 * 功能：
 * - 畫布清單管理（新增、重名、刪除）
 * - 節點與邊的即時編輯（React Flow）
 * - SSE 即時推播
 * - 四種顯示模式切換
 * - 時區設定
 * - 垃圾桶
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasToolbar } from '@/components/CanvasToolbarContext'
import { kaiwenApi } from './kaiwen-api'
import { useCanvas } from './hooks/useCanvas'
import { useNotifications } from './hooks/useNotifications'
import { CanvasView } from './kaiwen-components/CanvasView'
import { ChatView } from './kaiwen-components/ChatView'
import { SettingsModal } from './kaiwen-components/SettingsModal'
import { NotificationCenter } from './kaiwen-components/NotificationCenter'
import { CanvasMenu } from './kaiwen-components/CanvasMenu'
import { logger } from '@/lib/logger'
import type { CanvasDto, AiModelDto } from './kaiwen-types'
import './kaiwen.css'

interface KaiWenCanvasProps {
  /**
   * 當前主題（由 Header 傳入或從 localStorage 讀）
   * 可選值：warmpaper | light | dark | night
   */
  theme?: 'warmpaper' | 'light' | 'dark' | 'night'

  /**
   * 當前時區（由 Header 傳入）
   * IANA 格式，例：Asia/Taipei
   */
  timezone?: string

  /**
   * 使用者是否已登入
   */
  isAuthenticated?: boolean
}

export function KaiWenCanvas({
  theme = 'warmpaper',
  timezone = 'Asia/Taipei',
  isAuthenticated = true,
}: KaiWenCanvasProps) {
  // 畫布清單狀態
  const [canvases, setCanvases] = useState<CanvasDto[]>([])
  const [canvasId, setCanvasId] = useState<string | null>(
    () => (typeof window !== 'undefined' ? localStorage.getItem('kaiwen:canvasId') : null)
  )

  // 僅在掛載後才渲染互動畫布：避免 SSR（無 localStorage）與 client（從 localStorage 還原選取畫布）
  // 的初始 HTML 不一致而觸發 hydration 錯誤（React Flow 等互動元件本就只應在 client 渲染）。
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // 掛載後才切為 true，作為「僅 client 渲染」的水合(hydration)守衛 —— 這是刻意的同步 setState，
    // 用來避開 SSR/client 初始 HTML 不一致；故停用「effect 內勿同步 setState」規則。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // 即時主題：以全站主題（<html data-theme>，由 Header 主題切換器控制）為準，
  // 而非僅用伺服器端傳入的 user.displayMode（會過時、與目前切換不同步）。
  // 透過 MutationObserver 監看 data-theme 變化，讓畫布與全站夜間/亮色即時同步。
  const [liveTheme, setLiveTheme] =
    useState<'warmpaper' | 'light' | 'dark' | 'night'>(theme)
  useEffect(() => {
    const readTheme = () => {
      const attr = document.documentElement.getAttribute('data-theme')
      if (attr === 'warmpaper' || attr === 'light' || attr === 'dark' || attr === 'night') {
        setLiveTheme(attr)
      }
    }
    readTheme()
    const observer = new MutationObserver(readTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  // 模型清單
  const [models, setModels] = useState<AiModelDto[]>([])

  // 設定面板開關（垃圾桶已合併到全站統一垃圾桶頁 /trash）
  const [showSettings, setShowSettings] = useState(false)

  // 把開問啦工具列「上送」到全站 Header（透過 Context；實際送出在下方 publish effect）。
  const { setNode: setCanvasToolbar } = useCanvasToolbar()

  // 視圖模式：canvas / reading / chat
  const [viewMode, setViewMode] = useState<'canvas' | 'reading' | 'chat'>(
    () =>
      (typeof window !== 'undefined'
        ? (localStorage.getItem('kaiwen:viewMode') as 'canvas' | 'reading' | 'chat')
        : null) || 'canvas'
  )

  // 滾輪平移模式（滑鼠滾輪改為拖曳而非縮放）
  const [panOnScroll, setPanOnScroll] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('kaiwen:panOnScroll') === '1' : false
  )

  // 搜尋跳轉
  const [focus, setFocus] = useState<{ canvasId: string; nodeId?: string } | null>(null)

  // 每張畫布記錄「目前節點」
  const [currentByCanvas, setCurrentByCanvas] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem('kaiwen:currentNode') || '{}')
    } catch {
      return {}
    }
  })

  const currentNodeId = canvasId ? currentByCanvas[canvasId] ?? null : null
  const setCurrentNode = useCallback(
    (id: string) =>
      setCurrentByCanvas((m) =>
        canvasId ? { ...m, [canvasId]: id } : m
      ),
    [canvasId]
  )

  // 通知中心
  const notifications = useNotifications()

  // 定義推播回調
  const handlePushNotification = (message: string) => {
    notifications.push({
      type: 'info',
      message,
    })
  }

  // 畫布資料狀態（節點、邊、錯誤等）
  const canvas = useCanvas(canvasId, handlePushNotification)

  // 將陣列轉成 React Flow 需要的對映「物件」。
  // 關鍵：一定要 useMemo——否則每次本元件重繪都產生「全新物件」，
  // 會讓 CanvasView 的節點同步 effect 每次都重建所有 rfNodes（節點全部重渲染），
  // 造成平移卡頓。原版開問啦是直接傳入 hook 內穩定的物件參考，故順暢。
  const nodeMap = useMemo(
    () => Object.fromEntries(canvas.nodes.map((n) => [n.Node_Id, n])),
    [canvas.nodes]
  )
  const edgeMap = useMemo(
    () => Object.fromEntries(canvas.edges.map((e) => [e.Edge_Id, e])),
    [canvas.edges]
  )
  const inlineLinkMap = useMemo(
    () => Object.fromEntries(canvas.inlineLinks.map((l) => [l.InlineLink_Id, l])),
    [canvas.inlineLinks]
  )
  const highlightMap = useMemo(
    () => Object.fromEntries(canvas.highlights.map((h) => [h.Highlight_Id, h])),
    [canvas.highlights]
  )
  const pendingMap = useMemo(
    () => Object.fromEntries(Array.from(canvas.pending).map((id) => [id, true as const])),
    [canvas.pending]
  )

  // 同步 localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('kaiwen:timezone', timezone)
  }, [timezone])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('kaiwen:viewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // canvasId 為 null（例如剛刪掉最後一張畫布）時要「移除」鍵，
    // 否則殘留的舊 ID 會在下次載入時被還原 → 對已刪除畫布發 GET 造成 404 錯誤風暴。
    if (canvasId) {
      localStorage.setItem('kaiwen:canvasId', canvasId)
    } else {
      localStorage.removeItem('kaiwen:canvasId')
    }
  }, [canvasId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('kaiwen:currentNode', JSON.stringify(currentByCanvas))
  }, [currentByCanvas])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('kaiwen:panOnScroll', panOnScroll ? '1' : '0')
  }, [panOnScroll])

  // 載入可用模型
  const loadModels = useCallback(() => {
    kaiwenApi.listModels().then(setModels).catch(() => setModels([]))
  }, [])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  // 穩定的 modal 回調：避免每次本元件重繪都產生新函式，導致子 modal 的 useEffect 反覆重跑
  // （SettingsModal 會在 onClose 變動時重新載入＋輪詢健檢，不穩定的 onClose 會造成請求風暴）。
  const closeSettings = useCallback(() => setShowSettings(false), [])

  // 載入畫布清單
  const refreshCanvases = useCallback(async () => {
    try {
      const list = await kaiwenApi.listCanvases()
      setCanvases(list)
      return list
    } catch (error) {
      logger.error('Failed to load canvases:', error)
      notifications.push({
        type: 'error',
        message: '無法載入畫布清單',
      })
      return []
    }
    // 只相依穩定的 push（notifications.push 為 useCallback），避免通知變動就重建 refreshCanvases
    // 進而讓畫布載入 effect 反覆執行（請求風暴）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.push])

  // 初次載入畫布清單 + 還原上次選取的畫布。
  // 用 ref 守衛確保「只在掛載時跑一次」，杜絕任何相依重建造成的 /canvases 請求風暴（684 次/秒）。
  const didLoadCanvasesRef = useRef(false)
  useEffect(() => {
    if (didLoadCanvasesRef.current) return
    didLoadCanvasesRef.current = true
    let isMounted = true;
    (async () => {
      try {
        const list = await refreshCanvases()
        if (isMounted) {
          // 還原上次畫布；若已刪除則選第一張
          setCanvasId((cur) =>
            cur && list.some((c) => c.Canvas_Id === cur) ? cur : list[0]?.Canvas_Id ?? null
          )
        }
      } catch {
        // 忽略錯誤
      }
    })()
    return () => {
      isMounted = false
    }
    // 僅掛載執行一次（refreshCanvases 已穩定，仍加守衛雙重保險）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 畫布操作
  const createCanvas = async () => {
    try {
      const title = `畫布 ${canvases.length + 1}`
      // 用建立 API 回傳的新畫布 ID 立即切換過去（不靠 refresh 後的清單順序猜）
      const created = await kaiwenApi.createCanvas(title)
      await refreshCanvases()
      if (created?.Canvas_Id) setCanvasId(created.Canvas_Id)
    } catch (error) {
      logger.error('Failed to create canvas:', error)
      notifications.push({
        type: 'error',
        message: '無法建立畫布',
      })
    }
  }

  const renameCanvas = async () => {
    if (!canvasId) return
    const current = canvases.find((c) => c.Canvas_Id === canvasId)
    const name = window.prompt('畫布新名稱', current?.Canvas_Title ?? '')
    if (name && name.trim()) {
      try {
        await kaiwenApi.renameCanvas(canvasId, name.trim())
        await refreshCanvases()
      } catch (error) {
        logger.error('Failed to rename canvas:', error)
        notifications.push({
          type: 'error',
          message: '無法重新命名畫布',
        })
      }
    }
  }

  const deleteCurrentCanvas = async () => {
    if (!canvasId || !window.confirm('確定要刪除這張畫布嗎？')) return
    const deletingId = canvasId
    try {
      await kaiwenApi.deleteCanvas(deletingId)
      // 樂觀：先從本地清單移除並切到下一張，避免「刪了還在、要刷新才更新」
      const remaining = canvases.filter((c) => c.Canvas_Id !== deletingId)
      setCanvases(remaining)
      setCanvasId(remaining.length > 0 ? remaining[0].Canvas_Id : null)
      await refreshCanvases()
    } catch (error) {
      logger.error('Failed to delete canvas:', error)
      notifications.push({
        type: 'error',
        message: '無法刪除畫布',
      })
    }
  }

  // 把開問啦工具列「上送」到全站 Header（只在 /canvas、掛載後）。
  // 依關鍵狀態重送，讓按鈕行為（切換畫布/視圖/平移等）保持最新；離開頁面(unmount)時清掉。
  useEffect(() => {
    if (!mounted) return
    setCanvasToolbar(
      <div className="kaiwen-toolbar">
        {/* 切換 / 改名 / 刪除畫布 收攏在一個下拉（對齊開問啦原版） */}
        <CanvasMenu
          canvases={canvases}
          canvasId={canvasId}
          onSelect={(id) => setCanvasId(id)}
          onRename={renameCanvas}
          onDelete={deleteCurrentCanvas}
        />

        <select
          className="kw-select"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as 'canvas' | 'reading' | 'chat')}
          title="視圖模式：畫布 / 閱覽（乾淨畫布）/ 聊天（線性聊天室）"
          data-testid="view-mode"
        >
          <option value="canvas">🗺 畫布</option>
          <option value="reading">📖 閱覽</option>
          <option value="chat">💬 聊天</option>
        </select>

        {viewMode !== 'chat' && (
          <button
            className={`kw-btn ${panOnScroll ? 'kw-btn-primary' : ''}`}
            onClick={() => setPanOnScroll((v) => !v)}
            title={panOnScroll ? '目前：滾輪平移，點擊改為縮放' : '目前：滾輪縮放，點擊改為平移'}
          >
            {panOnScroll ? '🖐 平移' : '🔍 縮放'}
          </button>
        )}

        <NotificationCenter
          items={notifications.items}
          unread={notifications.unread}
          timezone={timezone}
          onMarkAllRead={notifications.markAllRead}
          onClearAll={notifications.clearAll}
          onRemove={notifications.remove}
          onJump={(cid, nid) => {
            setCanvasId(cid)
            setFocus({ canvasId: cid, nodeId: nid })
          }}
        />

        <button className="kw-btn" onClick={() => setShowSettings(true)} title="設定（時區、AI 模型管理、健檢）">
          ⚙ 設定
        </button>
        <button className="kw-btn" onClick={createCanvas} title="新增畫布">
          ＋新畫布
        </button>
      </div>
    )
    return () => setCanvasToolbar(null)
    // createCanvas 等 inline handler 刻意不列入相依，避免每次重繪都重送造成多餘渲染
    // notifications.items/unread 列入：通知變動時重送以更新鈴鐺紅點（NotificationCenter 自身 open 狀態由 reconcile 保留）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, canvasId, canvases, viewMode, panOnScroll, setCanvasToolbar, notifications.items, notifications.unread])

  if (!isAuthenticated) {
    return (
      <div className="kaiwen-container">
        <div className="kw-empty">
          <p>請登入以使用開問啦</p>
        </div>
      </div>
    )
  }

  if (!mounted) {
    // 掛載前先給一個穩定的容器（與伺服器端輸出一致），避免 hydration 不一致
    return <div className="kaiwen-container" data-kaiwen-theme={liveTheme} />
  }

  return (
    <div className="kaiwen-container" data-kaiwen-theme={liveTheme}>
      {/* 工具列已透過 Context 上送到全站 Header（見上方 publishToolbar effect），此處不再渲染 */}

      {/* 主內容區 */}
      <main className="kaiwen-main">
        {canvasId ? (
          <div className="kaiwen-canvas">
            {viewMode === 'chat' ? (
              /* 聊天視圖：把分支樹線性化成可滾動聊天串（手機友善） */
              <ChatView
                nodes={nodeMap}
                edges={edgeMap}
                inlineLinks={inlineLinkMap}
                highlights={highlightMap}
                pending={pendingMap}
                models={models}
                currentNodeId={currentNodeId}
                onNodeFocus={setCurrentNode}
                actions={canvas.actions}
              />
            ) : (
              /* 畫布 / 閱覽視圖：空間式 React Flow 畫布（reading 切入時自動置中） */
              <CanvasView
                canvasId={canvasId}
                nodes={nodeMap}
                edges={edgeMap}
                inlineLinks={inlineLinkMap}
                highlights={highlightMap}
                pending={pendingMap}
                models={models}
                actions={canvas.actions}
                panOnScroll={panOnScroll}
                theme={liveTheme}
                timezone={timezone}
                // 閱覽模式：切入時自動置中到目前節點（與「畫布」模式區隔）
                readingMode={viewMode === 'reading'}
                currentNodeId={currentNodeId}
                onNodeFocus={setCurrentNode}
                focusNodeId={focus && focus.canvasId === canvasId ? focus.nodeId : null}
                onFocusHandled={() => setFocus(null)}
              />
            )}

            {/* 錯誤提示 */}
            {canvas.error && (
              <div
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  maxWidth: '320px',
                  padding: '0.75rem',
                  backgroundColor: 'var(--kw-danger-soft-bg)',
                  color: 'var(--kw-danger-soft-fg)',
                  border: `1px solid var(--kw-danger)`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  zIndex: 50,
                }}
                onClick={canvas.actions.clearError}
              >
                ⚠ {canvas.error}（點擊關閉）
              </div>
            )}
          </div>
        ) : (
          <div className="kw-empty">
            <p>還沒有畫布。建立一張，開始把你的問答長成心智圖。</p>
            <button className="kw-btn-primary" onClick={createCanvas}>
              建立第一張畫布
            </button>
          </div>
        )}
      </main>

      {/* 設定面板（時區 + AI 模型管理 + 健檢） */}
      {showSettings && (
        <SettingsModal
          timezone={timezone}
          onClose={closeSettings}
          onModelsChanged={loadModels}
        />
      )}
    </div>
  )
}
