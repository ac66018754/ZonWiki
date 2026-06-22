/**
 * 標註應用工具 — 在渲染後的 Markdown 容器上覆蓋重點與可點擊連結
 * 與 anchor.ts 配合，容忍內容編輯導致的位置變化
 */

import { reAnchor } from './anchor'
import { resolveColor } from '@/lib/highlightColor'

/**
 * 高亮標註
 */
export interface AnnoHighlight {
  /** 高亮 ID */
  id: string
  /** 錨點文字 */
  anchorText: string
  /** 舊位移（供重新定位用） */
  start: number
  /** 前文窗 */
  prefix: string
  /** 後文窗 */
  suffix: string
  /** 顏色鍵值 */
  color: string
}

/**
 * 行內連結標註
 */
export interface AnnoLink {
  /** 連結 ID */
  id: string
  /** 錨點文字 */
  anchorText: string
  /** 舊位移 */
  start: number
  /** 前文窗 */
  prefix: string
  /** 後文窗 */
  suffix: string
  /** 是否已失效（目標節點被刪除） */
  detached: boolean
}

/**
 * 在 DOM 容器內收集所有文字節點
 * @param root - 根元素
 * @returns 文字節點陣列
 */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const n = walker.nextNode()
    if (!n) break
    out.push(n as Text)
  }
  return out
}

/**
 * 還原先前包裹的標註
 * 把所有 [data-anno] span 換回其文字內容並合併相鄰文字節點
 * @param container - 容器元素
 */
function unwrap(container: HTMLElement): void {
  container.querySelectorAll('[data-anno]').forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    // 把包裹元素的子節點移出
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el)
    }
    parent.removeChild(el)
  })
  // 合併相鄰文字節點
  container.normalize()
}

/**
 * 將容器內 [start,end) 字元範圍的文字片段包裹在 wrapper 元素中
 * @param container - 容器
 * @param start - 開始位移
 * @param end - 結束位移
 * @param makeWrapper - 產生包裹元素的工廠函式
 */
function wrapRange(
  container: HTMLElement,
  start: number,
  end: number,
  makeWrapper: () => HTMLElement
): void {
  if (end <= start) return

  const texts = collectTextNodes(container)
  let pos = 0

  for (const t of texts) {
    const len = t.data.length
    const nodeStart = pos
    const nodeEnd = pos + len
    pos = nodeEnd

    // 找出此文字節點與目標範圍 [start, end) 的重疊
    const a = Math.max(start, nodeStart)
    const b = Math.min(end, nodeEnd)
    if (a >= b) continue

    // 分割文字節點：
    // 1. 如果目標在文字節點中間開始，分割出前段
    // 2. 如果目標在文字節點中間結束，分割出後段
    // 3. 將中間段包裹

    let target = t
    const localStart = a - nodeStart
    const localEnd = b - nodeStart

    if (localStart > 0) {
      target = target.splitText(localStart)
    }

    if (localEnd - localStart < target.data.length) {
      target.splitText(localEnd - localStart)
    }

    const wrapper = makeWrapper()
    target.parentNode?.replaceChild(wrapper, target)
    wrapper.appendChild(target)
  }
}

/**
 * 對已渲染容器套用標註
 *
 * 流程：
 * 1. 還原舊標註（清除先前的包裹元素）
 * 2. 用 reAnchor() 重新定位錨點（容忍編輯造成的位移）
 * 3. 包裹高亮（mark 元素，可點擊移除）
 * 4. 包裹行內連結（span 元素，可點擊跳轉）
 *
 * @param container - 容器元素（通常是 .qa-content）
 * @param highlights - 高亮陣列
 * @param links - 行內連結陣列
 */
export function applyAnnotations(
  container: HTMLElement,
  highlights: AnnoHighlight[],
  links: AnnoLink[]
): void {
  // 還原先前的包裹
  unwrap(container)

  const text = container.textContent ?? ''

  // 應用高亮標註
  for (const h of highlights) {
    const r = reAnchor(text, h.anchorText, h.start, h.prefix, h.suffix)
    if (!r.found) continue

    wrapRange(container, r.start, r.end, () => {
      const m = document.createElement('mark')
      m.dataset.anno = '1'
      m.dataset.highlightId = h.id
      m.style.background = resolveColor(h.color)
      m.style.borderRadius = '3px'
      m.style.cursor = 'pointer'
      m.title = '點擊移除重點'
      return m
    })
  }

  // 應用行內連結標註
  for (const l of links) {
    const r = reAnchor(text, l.anchorText, l.start, l.prefix, l.suffix)
    if (!r.found) continue

    wrapRange(container, r.start, r.end, () => {
      const span = document.createElement('span')
      span.dataset.anno = '1'
      span.dataset.linkId = l.id
      span.className = l.detached ? 'kw-inline-link kw-inline-link-detached' : 'kw-inline-link'
      span.title = l.detached ? '錨點已失效' : '點擊跳到回答節點'
      return span
    })
  }
}
