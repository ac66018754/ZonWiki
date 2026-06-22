'use client'

import { useCallback, useEffect, useState } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import type { CanvasDto, CategoryWithLinksDto, SystemPromptDto } from '../kaiwen-types'

interface CategorySectionProps {
  /**
   * System Prompt 清單變動時遞增此值，觸發重新載入可選 Prompt。
   */
  version: number
}

const inputCls =
  'w-full rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]'

/**
 * 「畫布分類區」：分類的新增 / 改名 / 刪除；展開分類可勾選「包含哪些畫布」與「吃到哪些 System Prompt」。
 * 畫布↔分類、分類↔Prompt 皆為多對多；每次勾選即整組更新。
 */
export function CategorySection({ version }: CategorySectionProps) {
  const [cats, setCats] = useState<CategoryWithLinksDto[]>([])
  const [canvases, setCanvases] = useState<CanvasDto[]>([])
  const [prompts, setPrompts] = useState<SystemPromptDto[]>([])
  const [newName, setNewName] = useState('')
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return Promise.all([kaiwenApi.listCategories(), kaiwenApi.listCanvases(), kaiwenApi.listSystemPrompts()])
      .then(([c, cv, p]) => {
        setCats(c)
        setCanvases(cv)
        setPrompts(p)
        setNameDrafts(Object.fromEntries(c.map((x) => [x.Category_Id, x.Category_Name])))
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load, version])

  // 等待重載完成才解除 busy（配合 disabled={busy}），避免快速連點覆蓋彼此。
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

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const expandAll = () => setExpanded(new Set(cats.map((c) => c.Category_Id)))

  const collapseAll = () => setExpanded(new Set())

  const toggleInSet = (current: string[], id: string) =>
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id]

  // 全域 System Prompt 已自動套用到所有畫布，分類不需（也不應）再選用它。
  const selectablePrompts = prompts.filter((p) => !p.SystemPrompt_IsGlobal)

  return (
    <div className="space-y-3">
      {error && <div className="rounded border border-[var(--kw-danger)] bg-[var(--kw-danger-soft-bg)] px-2 py-1 text-[11px] text-[var(--kw-danger-soft-fg)]">⚠ {error}</div>}
      {/* 新增分類 */}
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          placeholder="新增分類名稱（例如：工作、研究、廣告）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) run(async () => { await kaiwenApi.createCategory(newName.trim()); setNewName('') })
          }}
          data-testid="new-category-name"
        />
        <button
          className="shrink-0 rounded bg-[var(--kw-primary)] px-2.5 py-1 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
          disabled={busy || !newName.trim()}
          onClick={() => run(async () => { await kaiwenApi.createCategory(newName.trim()); setNewName('') })}
          data-testid="add-category"
        >
          ＋ 新增分類
        </button>
      </div>
      {/* 全部展開 / 全部收合 */}
      {cats.length > 0 && (
        <div className="flex justify-end gap-1">
          <button
            className="cursor-pointer text-[11px] text-[var(--kw-muted)] hover:text-[var(--kw-text)] hover:underline"
            onClick={expandAll}
            title="展開所有分類"
          >
            全部展開
          </button>
          <span className="text-[11px] text-[var(--kw-muted)]">·</span>
          <button
            className="cursor-pointer text-[11px] text-[var(--kw-muted)] hover:text-[var(--kw-text)] hover:underline"
            onClick={collapseAll}
            title="收合所有分類"
          >
            全部收合
          </button>
        </div>
      )}

      {cats.length === 0 ? (
        <div className="text-[11px] text-[var(--kw-muted)]">尚無分類，於上方新增。</div>
      ) : (
        <ul className="space-y-2">
          {cats.map((cat) => {
            const open = expanded.has(cat.Category_Id)
            return (
              <li key={cat.Category_Id} className="rounded border border-[var(--kw-border)] bg-[var(--kw-surface)]">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    className="w-3 shrink-0 text-[10px] text-[var(--kw-muted)]"
                    onClick={() => toggleExpand(cat.Category_Id)}
                    title={open ? '收合' : '展開'}
                  >
                    {open ? '▾' : '▸'}
                  </button>
                  <input
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-[var(--kw-text)] hover:border-[var(--kw-border)] focus:border-[var(--kw-ring)] focus:outline-none"
                    value={nameDrafts[cat.Category_Id] ?? cat.Category_Name}
                    onChange={(e) => setNameDrafts((s) => ({ ...s, [cat.Category_Id]: e.target.value }))}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== cat.Category_Name) run(() => kaiwenApi.renameCategory(cat.Category_Id, v))
                    }}
                  />
                  <span className="shrink-0 text-[10px] text-[var(--kw-muted)]">
                    {cat.CanvasIds.length} 畫布 · {cat.PromptIds.length} Prompt
                  </span>
                  <button
                    className="shrink-0 rounded px-1 text-[var(--kw-muted)] hover:text-[var(--kw-danger)]"
                    onClick={() => {
                      if (window.confirm(`刪除分類「${cat.Category_Name}」？（不會刪除其中的畫布或 Prompt）`)) run(() => kaiwenApi.deleteCategory(cat.Category_Id))
                    }}
                    title="刪除分類"
                  >
                    🗑
                  </button>
                </div>

                {open && (
                  <div className="grid grid-cols-2 gap-3 border-t border-[var(--kw-border)] p-2">
                    <div>
                      <div className="mb-1 text-[10px] font-semibold text-[var(--kw-muted)]">包含的畫布</div>
                      <div className="max-h-40 space-y-0.5 overflow-y-auto">
                        {canvases.length === 0 && <div className="text-[11px] text-[var(--kw-muted)]">尚無畫布</div>}
                        {canvases.map((c) => (
                          <label key={c.Canvas_Id} className="flex items-center gap-1.5 text-xs text-[var(--kw-text)]">
                            <input
                              type="checkbox"
                              checked={cat.CanvasIds.includes(c.Canvas_Id)}
                              disabled={busy}
                              onChange={() => run(() => kaiwenApi.setCategoryCanvases(cat.Category_Id, toggleInSet(cat.CanvasIds, c.Canvas_Id)))}
                            />
                            <span className="truncate">{c.Canvas_Title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] font-semibold text-[var(--kw-muted)]">吃到的 System Prompt</div>
                      <div className="max-h-40 space-y-0.5 overflow-y-auto">
                        {selectablePrompts.length === 0 && (
                          <div className="text-[11px] text-[var(--kw-muted)]">尚無可選用的 System Prompt（全域的會自動套用）</div>
                        )}
                        {selectablePrompts.map((p) => (
                          <label key={p.SystemPrompt_Id} className="flex items-center gap-1.5 text-xs text-[var(--kw-text)]">
                            <input
                              type="checkbox"
                              checked={cat.PromptIds.includes(p.SystemPrompt_Id)}
                              disabled={busy}
                              onChange={() => run(() => kaiwenApi.setCategoryPrompts(cat.Category_Id, toggleInSet(cat.PromptIds, p.SystemPrompt_Id)))}
                            />
                            <span className="truncate">{p.SystemPrompt_Title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
