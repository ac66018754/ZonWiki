import { useMemo, useState, type ReactNode } from 'react'
import type { NodeDto } from '../kaiwen-types'

interface NodeNavigatorProps {
  /**
   * 畫布中所有節點的 map（key: Node_Id, value: NodeDto）
   */
  nodes: Record<string, NodeDto>

  /**
   * 目前已選取的節點 ID（為 null 時無選取）
   */
  selectedId: string | null

  /**
   * 使用者點擊節點時的 callback（傳入該節點的 Node_Id）
   */
  onFocus: (nodeId: string) => void
}

/**
 * 取節點內容第一排可讀文字（去除 Markdown 標記與圖片語法），給左側清單顯示。
 * 若內容全為空白或僅有 Markdown 標記，則傳回「(空白節點)」。
 */
function firstLine(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return '(空白節點)'
  if (/^!\[.*\]\(.*\)$/.test(line)) return '🖼 圖片'
  const clean = line.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').trim()
  return clean.length > 0 ? clean : '(空白節點)'
}

interface TreeItem {
  /**
   * 節點 ID
   */
  id: string

  /**
   * 節點顯示標籤（取自內容第一排）
   */
  label: string

  /**
   * 子節點列表
   */
  children: TreeItem[]
}

/**
 * 依 Node_ParentId 組成節點樹。
 * 父節點不在目前畫布者（或指向自己）視為根；同層依建立時間排序；以 visited 防環。
 *
 * 重要：保證「每個節點都會出現」——若資料出現環（A↔B）、自我參照或全部互相指向（無根），
 * 從 __root__ 走訪會走不到那些節點，導致「清單數量 > 0 但列表空白」。故走訪完根樹後，
 * 把任何仍未走訪到的節點當作額外的根補上（再展開其子樹），確保列表數＝實際節點數。
 */
function buildTree(nodes: Record<string, NodeDto>): TreeItem[] {
  const all = Object.values(nodes)
  const ids = new Set(all.map((n) => n.Node_Id))
  const byParent = new Map<string, NodeDto[]>()

  for (const n of all) {
    // 父節點不在此畫布內、或指向自己 → 視為根節點
    const pid =
      n.Node_ParentId && n.Node_ParentId !== n.Node_Id && ids.has(n.Node_ParentId)
        ? n.Node_ParentId
        : '__root__'
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid)!.push(n)
  }

  const byCreated = (a: NodeDto, b: NodeDto) =>
    (a.Node_CreatedDateTime ?? '').localeCompare(b.Node_CreatedDateTime ?? '')

  const visited = new Set<string>()
  const build = (pid: string): TreeItem[] =>
    (byParent.get(pid) ?? [])
      .slice()
      .sort(byCreated)
      .filter((n) => !visited.has(n.Node_Id))
      .map((n) => {
        visited.add(n.Node_Id)
        return {
          id: n.Node_Id,
          label: firstLine(n.Node_Content),
          children: build(n.Node_Id),
        }
      })

  const roots = build('__root__')

  // 補上因環 / 孤兒而未被走訪到的節點（避免「有數量卻空白」）。
  const orphanRoots: TreeItem[] = []
  for (const n of all.slice().sort(byCreated)) {
    if (visited.has(n.Node_Id)) continue
    visited.add(n.Node_Id)
    orphanRoots.push({
      id: n.Node_Id,
      label: firstLine(n.Node_Content),
      children: build(n.Node_Id),
    })
  }

  return [...roots, ...orphanRoots]
}

/**
 * 節點清單（左側欄內的一個區塊，由 LeftSidebar 提供標題列與收合）：
 * 以樹狀縮排呈現節點父子分支關係，可搜尋、逐層收合，點擊即在畫布上置中並選取該節點。
 *
 * 搜尋模式下改顯示平面結果（不含層次），逐一收起搜尋則回復樹狀。
 */
export function NodeNavigator({ nodes, selectedId, onFocus }: NodeNavigatorProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(nodes), [nodes])

  /**
   * 搜尋時的平面結果（不含層次）
   */
  const flatMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return Object.values(nodes)
      .map((n) => ({ id: n.Node_Id, label: firstLine(n.Node_Content) }))
      .filter((it) => it.label.toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
  }, [nodes, query])

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  /**
   * 蒐集所有有子節點的節點 ID（遞歸走訪樹）
   */
  const collectCollapsibleIds = (items: TreeItem[]): string[] => {
    const result: string[] = []
    const walk = (item: TreeItem) => {
      if (item.children.length > 0) {
        result.push(item.id)
        item.children.forEach(walk)
      }
    }
    items.forEach(walk)
    return result
  }

  const expandAll = () => setCollapsed(new Set())

  const collapseAll = () => {
    const collapsibleIds = collectCollapsibleIds(tree)
    setCollapsed(new Set(collapsibleIds))
  }

  const itemButtonClass = (id: string) =>
    `min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-xs ${
      id === selectedId
        ? 'bg-[var(--kw-primary-soft-bg)] text-[var(--kw-primary-soft-fg)]'
        : 'text-[var(--kw-text)] hover:bg-[var(--kw-surface)]'
    }`

  const renderRows = (items: TreeItem[], depth: number): ReactNode[] =>
    items.flatMap((it) => {
      const hasChildren = it.children.length > 0
      const isCollapsed = collapsed.has(it.id)
      const row = (
        <div key={it.id} className="flex items-center" style={{ paddingLeft: depth * 12 }}>
          {hasChildren ? (
            <button
              className="w-4 shrink-0 text-[10px] text-[var(--kw-muted)] hover:text-[var(--kw-text)]"
              onClick={() => toggleCollapse(it.id)}
              title={isCollapsed ? '展開' : '收合'}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="inline-block w-4 shrink-0 text-center text-[var(--kw-faint)]">·</span>
          )}
          <button
            className={itemButtonClass(it.id)}
            onClick={() => onFocus(it.id)}
            title={`定位到：${it.label}`}
          >
            {it.label}
          </button>
        </div>
      )
      return hasChildren && !isCollapsed ? [row, ...renderRows(it.children, depth + 1)] : [row]
    })

  return (
    <div className="flex h-full flex-col" data-testid="node-navigator">
      {/* 標頭列：全部展開／收合控制 */}
      {!query.trim() && tree.length > 0 && (
        <div className="shrink-0 flex items-center justify-end gap-2 border-b border-[var(--kw-border)] px-2 py-1.5">
          <button
            className="text-[11px] text-[var(--kw-muted)] cursor-pointer hover:text-[var(--kw-text)] transition-colors"
            onClick={expandAll}
            title="展開所有有子節點的節點"
          >
            全部展開
          </button>
          <span className="text-[var(--kw-border)]">·</span>
          <button
            className="text-[11px] text-[var(--kw-muted)] cursor-pointer hover:text-[var(--kw-text)] transition-colors"
            onClick={collapseAll}
            title="收合所有有子節點的節點"
          >
            全部收合
          </button>
        </div>
      )}

      {/* 搜尋輸入欄 */}
      <div className="shrink-0 px-2 py-1.5">
        <input
          className="w-full rounded border border-[var(--kw-border)] bg-[var(--kw-surface)] px-2 py-1 text-xs text-[var(--kw-text)] outline-none focus:border-[var(--kw-ring)]"
          placeholder="搜尋節點…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="nav-search"
        />
      </div>

      {/* 節點清單內容區 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {query.trim() ? (
          // 搜尋時改顯示平面結果（不含層次）。
          <ul>
            {flatMatches.map((it) => (
              <li key={it.id} className="flex items-center">
                <span className="inline-block w-4 shrink-0" />
                <button
                  className={itemButtonClass(it.id)}
                  onClick={() => onFocus(it.id)}
                  title={`定位到：${it.label}`}
                >
                  {it.label}
                </button>
              </li>
            ))}
            {flatMatches.length === 0 && (
              <li className="px-2 py-3 text-center text-[11px] text-[var(--kw-muted)]">
                沒有符合的節點
              </li>
            )}
          </ul>
        ) : tree.length > 0 ? (
          renderRows(tree, 0)
        ) : (
          <div className="px-2 py-3 text-center text-[11px] text-[var(--kw-muted)]">
            沒有節點
          </div>
        )}
      </div>
    </div>
  )
}
