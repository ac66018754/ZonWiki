'use client'

import { useEffect, useState } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import { formatShort } from '../lib/datetime'
import { CategorySection } from './CategorySection'
import { SystemPromptSection } from './SystemPromptSection'
import type { AiModelConfigDto, HealthStateDto, ModelHealthDto } from '../kaiwen-types'

/**
 * 設定面板 Modal — 時區 + AI 模型管理 + 健檢
 *
 * @param timezone - 當前時區 IANA 碼（e.g. "Asia/Taipei"），若未提供則從 localStorage 讀取，預設 "Asia/Taipei"
 * @param onClose - 關閉 modal 時的回呼
 * @param onModelsChanged - 模型儲存後的回呼，用於父層重新載入模型清單
 */
interface SettingsModalProps {
  timezone?: string
  onClose: () => void
  onModelsChanged?: () => void
}

/**
 * 時區下拉選項清單
 */
const TIMEZONE_ZONES: { value: string; label: string }[] = [
  { value: 'Asia/Taipei', label: '台北 (UTC+8)' },
  { value: 'Asia/Hong_Kong', label: '香港 (UTC+8)' },
  { value: 'Asia/Shanghai', label: '上海 (UTC+8)' },
  { value: 'Asia/Tokyo', label: '東京 (UTC+9)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
  { value: 'America/Los_Angeles', label: '洛杉磯 (UTC-8/-7)' },
  { value: 'America/New_York', label: '紐約 (UTC-5/-4)' },
  { value: 'Europe/London', label: '倫敦 (UTC+0/+1)' },
]

/**
 * 健檢狀態顯示樣式表
 */
const HEALTH_STATUS: Record<string, { dot: string; cls: string; label: string }> = {
  ok: { dot: '●', cls: 'text-[var(--kw-success)]', label: '正常' },
  fail: { dot: '●', cls: 'text-[var(--kw-danger)]', label: '異常' },
  checking: { dot: '◌', cls: 'text-[var(--kw-muted)]', label: '檢查中…' },
  unknown: { dot: '○', cls: 'text-[var(--kw-muted)]', label: '未檢查' },
}

/**
 * 模型內部列表項目結構（帶暫時 uid 便於展開/摺疊）
 */
interface ModelRow {
  uid: number
  m: AiModelConfigDto
}

let uidCounter = 0

/**
 * 建立空白模型物件（新增模型時使用）
 */
function blankModel(): AiModelConfigDto {
  return {
    Key: '',
    Label: '',
    Provider: 'OpenAiCompatible',
    Kind: 'chat',
    Enabled: false,
    ModelId: '',
    BaseUrl: '',
    ApiKey: '',
    Notes: '',
  }
}

/**
 * 自 BaseUrl 提取 origin（用於分組模型）
 */
function originOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * 決定模型分組：本機 CLI 一組；其餘依 Service URL 的 origin 分組；沒填 URL 歸「未設定」
 */
function groupOf(m: AiModelConfigDto): { key: string; label: string } {
  if (m.Provider === 'ClaudeCli') {
    return { key: 'local', label: '本機 CLI（claude，免金鑰）' }
  }
  const origin = originOf(m.BaseUrl)
  return origin
    ? { key: origin, label: origin }
    : { key: '__none__', label: '（未設定 Service URL）' }
}

export function SettingsModal({ timezone: propTimezone, onClose, onModelsChanged }: SettingsModalProps) {
  // ─────── 時區狀態 ───────
  const [timezone, setTimezone] = useState<string>('Asia/Taipei')

  // ─────── 模型管理狀態 ───────
  const [rows, setRows] = useState<ModelRow[]>([])
  const [health, setHealth] = useState<HealthStateDto | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // ─────── System Prompt 版本管理 ───────
  const [promptVersion, setPromptVersion] = useState(0)

  /**
   * 初始化時：載入時區、模型設定、健檢狀態
   */
  useEffect(() => {
    // 從 localStorage 或 props 讀取時區
    const storedTz = typeof window !== 'undefined' ? localStorage.getItem('kaiwen:timezone') : null
    const initialTz = propTimezone || storedTz || 'Asia/Taipei'
    setTimezone(initialTz)

    // 載入模型設定
    kaiwenApi
      .getModelsConfig()
      .then((cfg) => setRows(cfg.map((m) => ({ uid: ++uidCounter, m }))))
      .catch(() => setRows([]))

    // 載入初始健檢狀態
    loadHealth()

    // 每 3 秒輪詢健檢狀態
    const timer = window.setInterval(loadHealth, 3000)

    // ESC 鍵關閉（若無未儲存的變更）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dirty) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('keydown', onKey)
    }
  }, [dirty, onClose, propTimezone])

  /**
   * 讀取健檢狀態
   */
  const loadHealth = () => {
    kaiwenApi
      .getHealth()
      .then(setHealth)
      .catch(() => undefined)
  }

  /**
   * 建立健檢狀態 Key → ModelHealthDto 的對應表
   */
  const healthByKey: Record<string, ModelHealthDto> = {}
  for (const r of health?.Results ?? []) {
    healthByKey[r.Key] = r
  }

  /**
   * 修改模型欄位
   */
  const patch = (uid: number, field: keyof AiModelConfigDto, value: string | boolean) => {
    setRows((rs) =>
      rs.map((r) =>
        r.uid === uid
          ? { uid, m: { ...r.m, [field]: value } }
          : r
      )
    )
    setDirty(true)
  }

  /**
   * 新增空白模型
   */
  const addModel = () => {
    const uid = ++uidCounter
    setRows((rs) => [...rs, { uid, m: blankModel() }])
    setExpanded((e) => new Set(e).add(uid))
    setDirty(true)
  }

  /**
   * 刪除模型
   */
  const removeModel = (uid: number) => {
    setRows((rs) => rs.filter((r) => r.uid !== uid))
    setDirty(true)
  }

  /**
   * 切換模型列表項的展開/摺疊
   */
  const toggleExpand = (uid: number) => {
    setExpanded((e) => {
      const n = new Set(e)
      n.has(uid) ? n.delete(uid) : n.add(uid)
      return n
    })
  }

  /**
   * 切換模型群組的展開/摺疊
   */
  const toggleGroup = (key: string) => {
    setCollapsedGroups((g) => {
      const n = new Set(g)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  /**
   * 全部展開：清空 collapsedGroups 和 expanded
   */
  const expandAll = () => {
    setCollapsedGroups(new Set())
    setExpanded(new Set())
  }

  /**
   * 全部收合：把所有群組 key 加入 collapsedGroups，清空 expanded
   */
  const collapseAll = () => {
    const allKeys = new Set(groups.map((g) => g.key))
    setCollapsedGroups(allKeys)
    setExpanded(new Set())
  }

  /**
   * 儲存時區到 localStorage
   */
  const saveTimezone = (tz: string) => {
    setTimezone(tz)
    if (typeof window !== 'undefined') {
      localStorage.setItem('kaiwen:timezone', tz)
    }
  }

  /**
   * 儲存模型設定到後端
   */
  const saveModels = async () => {
    const models = rows.map((r) => r.m)
    const keys = models.map((m) => m.Key.trim())

    // 驗證：每個模型都要有 Key
    if (keys.some((k) => !k)) {
      setMessage('每個模型都要填 Key。')
      return
    }

    // 驗證：Key 不可重複
    if (new Set(keys).size !== keys.length) {
      setMessage('Key 不可重複。')
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const saved = await kaiwenApi.saveModelsConfig(models)
      setRows(saved.map((m) => ({ uid: ++uidCounter, m })))
      setDirty(false)
      setMessage('已儲存（已即時生效）。')
      onModelsChanged?.()
      // 延遲後重新載入健檢狀態
      window.setTimeout(loadHealth, 800)
    } catch (e) {
      setMessage(`儲存失敗：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  /**
   * 切換自動健檢
   */
  const toggleAutoHealth = async (enabled: boolean) => {
    try {
      const r = await kaiwenApi.setHealthEnabled(enabled)
      setHealth((s) => (s ? { ...s, Enabled: r.Enabled } : s))
      window.setTimeout(loadHealth, 600)
    } catch {
      /* 忽略錯誤 */
    }
  }

  /**
   * 立即執行一次健檢
   */
  const checkNow = () => {
    kaiwenApi.checkHealthNow().catch(() => undefined)
    window.setTimeout(loadHealth, 800)
  }

  // ─────── 樣式類別 ───────
  const inputCls =
    'w-full rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]'
  const labelCls = 'mb-0.5 block text-[10px] text-[var(--kw-muted)]'

  /**
   * 渲染單一模型列表項
   */
  const renderModelRow = ({ uid, m }: ModelRow) => {
    const h = healthByKey[m.Key]
    const meta = HEALTH_STATUS[h?.Status ?? 'unknown'] ?? HEALTH_STATUS.unknown
    const isOpen = expanded.has(uid)
    const origin = originOf(m.BaseUrl)

    return (
      <li key={uid} className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)]">
        {/* 模型列表項標題列 */}
        <div
          className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
          onClick={() => toggleExpand(uid)}
          role="button"
          title={isOpen ? '收合' : '展開'}
        >
          {/* 展開箭頭 */}
          <span className="w-3 shrink-0 text-[10px] text-[var(--kw-muted)]">
            {isOpen ? '▾' : '▸'}
          </span>

          {/* 健檢狀態指示 */}
          <span className={meta.cls} title={meta.label}>
            {meta.dot}
          </span>

          {/* 啟用複選框 */}
          <input
            type="checkbox"
            checked={m.Enabled}
            onChange={(e) => patch(uid, 'Enabled', e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            title="啟用（前端下拉才會出現）"
          />

          {/* 模型顯示名稱 */}
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--kw-text)]">
            {m.Label || m.Key || '(未命名)'}
            <span className="ml-1 text-[10px] text-[var(--kw-muted)]">
              {m.Provider === 'ClaudeCli' ? '本機' : m.Kind === 'image' ? '圖片' : m.Provider}
            </span>
          </span>

          {/* 延遲時間（若有） */}
          {h?.Status === 'ok' && h.LatencyMs != null && (
            <span className="shrink-0 text-[10px] text-[var(--kw-muted)]">
              {h.LatencyMs}ms
            </span>
          )}

          {/* 最後檢查時間 */}
          <span className="shrink-0 text-[10px] text-[var(--kw-muted)]">
            {formatShort(h?.CheckedAtUtc, timezone)}
          </span>

          {/* 刪除按鈕 */}
          <button
            className="shrink-0 rounded px-1 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
            onClick={(e) => {
              e.stopPropagation()
              removeModel(uid)
            }}
            title="刪除此模型"
          >
            🗑
          </button>
        </div>

        {/* 健檢失敗時顯示錯誤信息 */}
        {h?.Status === 'fail' && h.Error && (
          <div className="break-words px-2 pb-1.5 text-[11px] text-[var(--kw-danger)]">
            {h.Error}
          </div>
        )}

        {/* 展開時顯示詳細編輯欄位 */}
        {isOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--kw-border)] p-2">
            {/* Key（識別鍵） */}
            <div>
              <label className={labelCls}>Key（識別鍵）</label>
              <input
                className={inputCls}
                value={m.Key}
                onChange={(e) => patch(uid, 'Key', e.target.value)}
              />
            </div>

            {/* Label（顯示名稱） */}
            <div>
              <label className={labelCls}>Label（顯示名稱）</label>
              <input
                className={inputCls}
                value={m.Label}
                onChange={(e) => patch(uid, 'Label', e.target.value)}
              />
            </div>

            {/* Provider 下拉選單 */}
            <div>
              <label className={labelCls}>Provider</label>
              <select
                className={inputCls}
                value={m.Provider}
                onChange={(e) => patch(uid, 'Provider', e.target.value)}
              >
                <option value="OpenAiCompatible">OpenAiCompatible（HTTP）</option>
                <option value="ClaudeCli">ClaudeCli（本機）</option>
              </select>
            </div>

            {/* Kind（用途）下拉選單 */}
            <div>
              <label className={labelCls}>用途 Kind</label>
              <select
                className={inputCls}
                value={m.Kind}
                onChange={(e) => patch(uid, 'Kind', e.target.value)}
              >
                <option value="chat">chat（文字）</option>
                <option value="image">image（圖片）</option>
              </select>
            </div>

            {/* ModelId（模型代號） */}
            <div>
              <label className={labelCls}>ModelId（模型代號）</label>
              <input
                className={inputCls}
                value={m.ModelId ?? ''}
                onChange={(e) => patch(uid, 'ModelId', e.target.value)}
              />
            </div>

            {/* Service URL（BaseUrl） */}
            <div>
              <label className={labelCls}>Service URL（BaseUrl）</label>
              <input
                className={inputCls}
                value={m.BaseUrl ?? ''}
                onChange={(e) => patch(uid, 'BaseUrl', e.target.value)}
                placeholder="https://.../v1"
              />
            </div>

            {/* API Key */}
            <div>
              <label className={labelCls}>API Key（可填 $ENV 或直接貼）</label>
              <input
                className={inputCls}
                value={m.ApiKey ?? ''}
                onChange={(e) => patch(uid, 'ApiKey', e.target.value)}
              />
            </div>

            {/* Note（備註） */}
            <div>
              <label className={labelCls}>Note（備註）</label>
              <input
                className={inputCls}
                value={m.Notes ?? ''}
                onChange={(e) => patch(uid, 'Notes', e.target.value)}
              />
            </div>

            {/* 供應商網站連結 */}
            {origin && (
              <div className="col-span-2">
                <a
                  className="text-[11px] text-[var(--kw-accent-soft-fg)] hover:underline"
                  href={origin}
                  target="_blank"
                  rel="noreferrer"
                >
                  前往供應商網站（{origin}）↗
                </a>
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  /**
   * 按 Service URL / 本機 分組模型（保留首次出現順序）
   */
  const groups: { key: string; label: string; rows: ModelRow[] }[] = []
  const groupByKey = new Map<string, { key: string; label: string; rows: ModelRow[] }>()
  for (const r of rows) {
    const g = groupOf(r.m)
    let bucket = groupByKey.get(g.key)
    if (!bucket) {
      bucket = { key: g.key, label: g.label, rows: [] }
      groupByKey.set(g.key, bucket)
      groups.push(bucket)
    }
    bucket.rows.push(r)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Modal 容器 */}
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-[var(--kw-bg)] shadow-lg">
        {/* Modal 標題列 */}
        <header className="kw-header flex shrink-0 items-center justify-between border-b border-[var(--kw-border)] px-4 py-3">
          <span className="text-base font-semibold text-[var(--kw-text)]">設定</span>
          <button
            className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-3 py-1 text-sm text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]"
            onClick={onClose}
            title="關閉設定"
          >
            ✕ 關閉
          </button>
        </header>

        {/* Modal 內容區 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
            {/* ===== 時區設定區 ===== */}
            <div className="rounded-lg border border-[var(--kw-border)]">
              <div className="bg-[var(--kw-surface-2)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--kw-text)]">時區顯示</h3>
              </div>
              <div className="space-y-2 p-3">
                <select
                  className="w-full max-w-xs rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-sm text-[var(--kw-text)]"
                  value={timezone}
                  onChange={(e) => saveTimezone(e.target.value)}
                >
                  {TIMEZONE_ZONES.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </select>
                <div className="text-[11px] text-[var(--kw-muted)]">
                  所有顯示時間都會換算成此時區（資料一律以 UTC 儲存）。
                </div>
              </div>
            </div>

            {/* ===== AI 模型管理區 ===== */}
            <div className="rounded-lg border border-[var(--kw-border)]">
              <div className="bg-[var(--kw-surface-2)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--kw-text)]">AI 模型管理</h3>
              </div>
              <div className="space-y-3 p-3">
                {/* 健檢與控制按鈕列 */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {/* 全部展開 / 全部收合 */}
                    <button
                      className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-1.5 py-0.5 text-[10px] text-[var(--kw-text)] cursor-pointer hover:bg-[var(--kw-surface-2)]"
                      onClick={expandAll}
                      title="展開所有群組與模型"
                    >
                      展開
                    </button>
                    <button
                      className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-1.5 py-0.5 text-[10px] text-[var(--kw-text)] cursor-pointer hover:bg-[var(--kw-surface-2)]"
                      onClick={collapseAll}
                      title="收合所有群組與模型"
                    >
                      收合
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 自動健檢複選框 */}
                    <label className="flex items-center gap-1 text-[11px] text-[var(--kw-text)]">
                      <input
                        type="checkbox"
                        checked={health?.Enabled ?? false}
                        onChange={(e) => toggleAutoHealth(e.target.checked)}
                      />
                      每小時自動檢查
                    </label>

                    {/* 立即檢查按鈕 */}
                    <button
                      className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]"
                      onClick={checkNow}
                    >
                      立即檢查
                    </button>

                    {/* 新增模型按鈕 */}
                    <button
                      className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] hover:bg-[var(--kw-surface-2)]"
                      onClick={addModel}
                    >
                      ＋ 新增模型
                    </button>

                    {/* 儲存按鈕 */}
                    <button
                      className="rounded bg-[var(--kw-primary)] px-3 py-1 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
                      onClick={saveModels}
                      disabled={saving || !dirty}
                    >
                      {saving ? '儲存中…' : dirty ? '儲存設定 *' : '已儲存'}
                    </button>
                  </div>
                </div>

                {/* 訊息區（成功/失敗） */}
                {message && (
                  <div className="text-[11px] text-[var(--kw-accent-soft-fg)]">
                    {message}
                  </div>
                )}

                {/* 模型列表 */}
                {rows.length === 0 ? (
                  <div className="text-[11px] text-[var(--kw-muted)]">
                    尚無模型，點「＋ 新增模型」開始。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groups.map((g) => {
                      const collapsed = collapsedGroups.has(g.key)
                      const enabledCount = g.rows.filter((r) => r.m.Enabled).length

                      return (
                        <div
                          key={g.key}
                          className="rounded-lg border border-[var(--kw-border)]"
                        >
                          {/* 群組標題列 */}
                          <div
                            className="flex cursor-pointer items-center gap-2 rounded-t-lg bg-[var(--kw-surface-2)] px-2 py-1.5"
                            onClick={() => toggleGroup(g.key)}
                            role="button"
                            title={collapsed ? '展開群組' : '收合群組'}
                          >
                            {/* 展開箭頭 */}
                            <span className="w-3 shrink-0 text-[10px] text-[var(--kw-muted)]">
                              {collapsed ? '▸' : '▾'}
                            </span>

                            {/* 群組標題 */}
                            <span
                              className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--kw-text)]"
                              title={g.label}
                            >
                              {g.label}
                            </span>

                            {/* 群組統計 */}
                            <span className="shrink-0 text-[10px] text-[var(--kw-muted)]">
                              {g.rows.length} 個模型 · {enabledCount} 啟用
                            </span>
                          </div>

                          {/* 群組內模型列表 */}
                          {!collapsed && (
                            <ul className="space-y-1.5 p-1.5">
                              {g.rows.map(renderModelRow)}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 底部提示文字 */}
                <div className="text-[10px] text-[var(--kw-muted)]">
                  健檢只測文字模型（不含圖片模型）。本頁可直接編輯，等同改設定檔；金鑰只存在本機該檔（已
                  gitignore）。
                </div>
              </div>
            </div>

            {/* ===== System Prompt 管理區 ===== */}
            <div className="rounded-lg border border-[var(--kw-border)]">
              <div className="bg-[var(--kw-surface-2)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--kw-text)]">System Prompt 管理</h3>
              </div>
              <div className="space-y-3 p-3">
                <SystemPromptSection onChanged={() => setPromptVersion(v => v + 1)} />
              </div>
            </div>

            {/* ===== 畫布分類管理區 ===== */}
            <div className="rounded-lg border border-[var(--kw-border)]">
              <div className="bg-[var(--kw-surface-2)] px-3 py-2">
                <h3 className="text-sm font-semibold text-[var(--kw-text)]">畫布分類管理</h3>
              </div>
              <div className="space-y-3 p-3">
                <CategorySection version={promptVersion} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
