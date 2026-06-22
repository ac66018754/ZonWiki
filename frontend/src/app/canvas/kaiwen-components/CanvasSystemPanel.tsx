import { useCallback, useEffect, useState } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import type { CanvasSystemConfigDto, CategoryWithLinksDto, SystemPromptDto } from '../kaiwen-types'

interface CanvasSystemPanelProps {
  /**
   * 畫布 ID
   */
  canvasId: string

  /**
   * 此區塊是否展開中（由 LeftSidebar 控制）；展開時才載入資料。
   */
  active: boolean
}

const sourceLabel = (s: string) => (s === 'global' ? '全域' : s === 'category' ? '分類' : '自選')
const sourceCls = (s: string) =>
  s === 'global'
    ? 'bg-[var(--kw-primary-soft-bg)] text-[var(--kw-primary-soft-fg)]'
    : s === 'category'
      ? 'bg-[var(--kw-accent-soft-bg)] text-[var(--kw-accent-soft-fg)]'
      : 'bg-[var(--kw-success-soft-bg)] text-[var(--kw-success-soft-fg)]'

/**
 * 「畫布設定」區塊內容（由 LeftSidebar 提供標題列與收合）：設定此畫布所屬分類、額外選用的 System Prompt，
 * 並列出「實際生效」的 System Prompt（全域 / 分類 / 自選 三來源，去重後）。
 */
export function CanvasSystemPanel({ canvasId, active }: CanvasSystemPanelProps) {
  const [config, setConfig] = useState<CanvasSystemConfigDto | null>(null)
  const [categories, setCategories] = useState<CategoryWithLinksDto[]>([])
  const [prompts, setPrompts] = useState<SystemPromptDto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return Promise.all([kaiwenApi.getCanvasSystem(canvasId), kaiwenApi.listCategories(), kaiwenApi.listSystemPrompts()])
      .then(([cfg, cats, ps]) => {
        setConfig(cfg)
        setCategories(cats)
        setPrompts(ps)
      })
      .catch((e) => setError(String(e)))
  }, [canvasId])

  // 切換畫布時清掉舊資料；面板開啟時（或畫布變更時若開著）載入。
  useEffect(() => {
    setConfig(null)
  }, [canvasId])
  useEffect(() => {
    if (active) load()
  }, [active, load])

  // 等待重載完成才解除 busy（配合 disabled={busy}），避免快速連點讀到舊狀態而覆蓋彼此。
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const toggleInSet = (cur: string[], id: string) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])

  const effective = config?.Effective ?? []
  // 全域 System Prompt 已自動套用到所有畫布，不應出現在「額外選用」清單裡。
  const selectablePrompts = prompts.filter((p) => !p.SystemPrompt_IsGlobal)

  return (
    <div className="space-y-3 p-2 text-xs" data-testid="canvas-system-panel">
      {error && <div className="rounded border border-[var(--kw-danger)] bg-[var(--kw-danger-soft-bg)] px-2 py-1 text-[11px] text-[var(--kw-danger-soft-fg)]">⚠ {error}</div>}
        {/* 所屬分類 */}
        <div>
          <div className="mb-1 text-[10px] font-semibold text-[var(--kw-muted)]">所屬分類</div>
          {categories.length === 0 ? (
            <div className="text-[11px] text-[var(--kw-muted)]">尚無分類（到設定頁新增）</div>
          ) : (
            categories.map((c) => (
              <label key={c.Category_Id} className="flex items-center gap-1.5 text-[var(--kw-text)]">
                <input
                  type="checkbox"
                  disabled={busy || !config}
                  checked={config?.CategoryIds.includes(c.Category_Id) ?? false}
                  onChange={() => config && run(() => kaiwenApi.setCanvasCategories(canvasId, toggleInSet(config.CategoryIds, c.Category_Id)))}
                />
                <span className="truncate">{c.Category_Name}</span>
              </label>
            ))
          )}
        </div>

        {/* 額外選用的 System Prompt */}
        <div>
          <div className="mb-1 text-[10px] font-semibold text-[var(--kw-muted)]">額外選用的 System Prompt</div>
          {selectablePrompts.length === 0 ? (
            <div className="text-[11px] text-[var(--kw-muted)]">尚無可額外選用的 System Prompt（全域的會自動套用）</div>
          ) : (
            selectablePrompts.map((p) => (
              <label key={p.SystemPrompt_Id} className="flex items-center gap-1.5 text-[var(--kw-text)]">
                <input
                  type="checkbox"
                  disabled={busy || !config}
                  checked={config?.OwnPromptIds.includes(p.SystemPrompt_Id) ?? false}
                  onChange={() => config && run(() => kaiwenApi.setCanvasOwnPrompts(canvasId, toggleInSet(config.OwnPromptIds, p.SystemPrompt_Id)))}
                />
                <span className="truncate">{p.SystemPrompt_Title}</span>
              </label>
            ))
          )}
        </div>

        {/* 實際生效 */}
        <div>
          <div className="mb-1 text-[10px] font-semibold text-[var(--kw-muted)]">實際生效的 System Prompt（{effective.length}）</div>
          {effective.length === 0 ? (
            <div className="text-[11px] text-[var(--kw-muted)]">目前沒有生效的 System Prompt</div>
          ) : (
            <ul className="space-y-1">
              {effective.map((e) => (
                <li key={e.SystemPrompt_Id} className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-1.5 py-1" title={e.Content}>
                  <div className="flex items-center gap-1">
                    <span className={`shrink-0 rounded px-1 text-[9px] ${sourceCls(e.Source)}`}>
                      {sourceLabel(e.Source)}
                      {e.Source === 'category' && e.CategoryName ? `：${e.CategoryName}` : ''}
                    </span>
                    <span className="truncate text-[var(--kw-text)]">{e.Title}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
    </div>
  )
}
