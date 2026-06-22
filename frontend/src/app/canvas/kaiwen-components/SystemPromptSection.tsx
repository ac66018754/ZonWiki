'use client'

import { useCallback, useEffect, useState } from 'react'
import { kaiwenApi } from '../kaiwen-api'
import type { SystemPromptDto } from '../kaiwen-types'

interface SystemPromptSectionProps {
  /**
   * 任何新增 / 更新 / 刪除後呼叫，讓「畫布分類區」重新載入可選的 Prompt 清單。
   */
  onChanged?: () => void
}

const inputCls =
  'w-full rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]'

type Draft = { Title: string; Content: string; IsGlobal: boolean }

/**
 * 「System Prompt 區」：只管提示本身（標題 / 內容 / 是否全域）的新增、編輯、刪除，保持乾淨；
 * 不在此設定被哪些分類選用（那在「畫布分類區」設定）。
 */
export function SystemPromptSection({ onChanged }: SystemPromptSectionProps) {
  const [list, setList] = useState<SystemPromptDto[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [newP, setNewP] = useState<Draft>({ Title: '', Content: '', IsGlobal: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return kaiwenApi
      .listSystemPrompts()
      .then((l) => {
        setList(l)
        setDrafts(
          Object.fromEntries(
            l.map((p) => [p.SystemPrompt_Id, { Title: p.SystemPrompt_Title, Content: p.SystemPrompt_Content, IsGlobal: p.SystemPrompt_IsGlobal }]),
          ),
        )
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const patch = (id: string, field: keyof Draft, value: string | boolean) =>
    setDrafts((s) => ({ ...s, [id]: { ...s[id], [field]: value } }))

  const isDirty = (p: SystemPromptDto) => {
    const d = drafts[p.SystemPrompt_Id]
    if (!d) return false
    return d.Title !== p.SystemPrompt_Title || d.Content !== p.SystemPrompt_Content || d.IsGlobal !== p.SystemPrompt_IsGlobal
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded border border-[var(--kw-danger)] bg-[var(--kw-danger-soft-bg)] px-2 py-1 text-[11px] text-[var(--kw-danger-soft-fg)]">⚠ {error}</div>}
      {/* 新增 */}
      <div className="space-y-1.5 rounded border border-dashed border-[var(--kw-border)] p-2">
        <input
          className={inputCls}
          placeholder="標題（例如：嚴謹的技術顧問）"
          value={newP.Title}
          onChange={(e) => setNewP({ ...newP, Title: e.target.value })}
          data-testid="new-prompt-title"
        />
        <textarea
          className={`${inputCls} h-20 resize-none`}
          placeholder="System Prompt 內容（會在提問時注入給 AI）…"
          value={newP.Content}
          onChange={(e) => setNewP({ ...newP, Content: e.target.value })}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[11px] text-[var(--kw-text)]">
            <input type="checkbox" checked={newP.IsGlobal} onChange={(e) => setNewP({ ...newP, IsGlobal: e.target.checked })} />
            套用為全域（所有畫布都吃到）
          </label>
          <button
            className="rounded bg-[var(--kw-primary)] px-2.5 py-1 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
            disabled={busy || !newP.Title.trim()}
            onClick={() =>
              run(async () => {
                await kaiwenApi.createSystemPrompt({ Title: newP.Title.trim(), Content: newP.Content, IsGlobal: newP.IsGlobal })
                setNewP({ Title: '', Content: '', IsGlobal: false })
              })
            }
            data-testid="add-prompt"
          >
            ＋ 新增 Prompt
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-[11px] text-[var(--kw-muted)]">尚無 System Prompt，於上方新增。</div>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => {
            const d = drafts[p.SystemPrompt_Id] ?? { Title: p.SystemPrompt_Title, Content: p.SystemPrompt_Content, IsGlobal: p.SystemPrompt_IsGlobal }
            return (
              <li key={p.SystemPrompt_Id} className="space-y-1.5 rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] p-2">
                <input className={inputCls} value={d.Title} onChange={(e) => patch(p.SystemPrompt_Id, 'Title', e.target.value)} />
                <textarea
                  className={`${inputCls} h-20 resize-none`}
                  value={d.Content}
                  onChange={(e) => patch(p.SystemPrompt_Id, 'Content', e.target.value)}
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-[11px] text-[var(--kw-text)]">
                    <input type="checkbox" checked={d.IsGlobal} onChange={(e) => patch(p.SystemPrompt_Id, 'IsGlobal', e.target.checked)} />
                    全域
                    {p.SystemPrompt_IsGlobal && (
                      <span className="ml-1 rounded bg-[var(--kw-primary-soft-bg)] px-1 text-[9px] text-[var(--kw-primary-soft-fg)]">全域</span>
                    )}
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      className="rounded bg-[var(--kw-primary)] px-2 py-0.5 text-xs font-medium text-[var(--kw-primary-fg)] hover:bg-[var(--kw-primary-hover)] disabled:opacity-40"
                      disabled={busy || !isDirty(p) || !d.Title.trim()}
                      onClick={() => run(() => kaiwenApi.updateSystemPrompt(p.SystemPrompt_Id, { Title: d.Title.trim(), Content: d.Content, IsGlobal: d.IsGlobal }))}
                    >
                      {isDirty(p) ? '儲存 *' : '已儲存'}
                    </button>
                    <button
                      className="rounded border border-[var(--kw-danger)] px-2 py-0.5 text-xs text-[var(--kw-danger)] hover:bg-[var(--kw-danger-soft-bg)]"
                      onClick={() => {
                        if (window.confirm(`刪除 System Prompt「${p.SystemPrompt_Title}」？`)) run(() => kaiwenApi.deleteSystemPrompt(p.SystemPrompt_Id))
                      }}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
