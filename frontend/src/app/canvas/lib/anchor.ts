/**
 * 文字錨點工具 — 與後端文字錨點服務對齐的純函式
 * 讓前端框選 / 重點定位與後端重新定位邏輯一致
 */

const CONTEXT_WINDOW = 24
const CONTEXT_MATCH_WEIGHT = 1_000_000

/**
 * 錨點搜尋結果
 */
export interface AnchorResult {
  /** 是否找到 */
  found: boolean
  /** 文字開始位置（0-based） */
  start: number
  /** 文字結束位置（0-based，不含） */
  end: number
}

/**
 * 在（可能已編輯的）內容中重新定位錨點文字
 *
 * 演算法：
 * 1. 若舊位移仍精確命中 → 沿用（最高優先）
 * 2. 否則找出所有出現位置，依前後文窗吻合與離舊位移遠近評分，挑最佳
 * 3. 找不到 → found=false
 *
 * @param content - 目前完整文字內容
 * @param anchorText - 要尋找的錨點文字
 * @param oldStart - 舊儲存的開始位置
 * @param prefix - 前文窗（上下文提示，用於容忍編輯偏移）
 * @param suffix - 後文窗（上下文提示）
 * @returns 搜尋結果
 */
export function reAnchor(
  content: string,
  anchorText: string,
  oldStart: number,
  prefix = '',
  suffix = ''
): AnchorResult {
  if (!content || !anchorText) {
    return { found: false, start: 0, end: 0 }
  }

  // 首先嘗試原位置（精確匹配最優先）
  if (
    oldStart >= 0 &&
    oldStart + anchorText.length <= content.length &&
    content.substr(oldStart, anchorText.length) === anchorText
  ) {
    return { found: true, start: oldStart, end: oldStart + anchorText.length }
  }

  // 掃描所有出現位置並評分
  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY
  let from = 0

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const idx = content.indexOf(anchorText, from)
    if (idx < 0) break

    const score = scoreOccurrence(content, anchorText, idx, oldStart, prefix, suffix)
    if (score > bestScore) {
      bestScore = score
      bestIndex = idx
    }

    from = idx + 1
  }

  if (bestIndex < 0) {
    return { found: false, start: 0, end: 0 }
  }

  return { found: true, start: bestIndex, end: bestIndex + anchorText.length }
}

/**
 * 對單個出現位置評分
 * 考慮：
 * - 前後文窗吻合（有則加權重）
 * - 離舊位移的距離（近者加分）
 *
 * @param content - 完整文字
 * @param anchorText - 錨點文字
 * @param idx - 當前出現位置
 * @param oldStart - 舊開始位置
 * @param prefix - 前文窗
 * @param suffix - 後文窗
 * @returns 評分（越高越好）
 */
function scoreOccurrence(
  content: string,
  anchorText: string,
  idx: number,
  oldStart: number,
  prefix: string,
  suffix: string
): number {
  let contextMatches = 0

  // 前文窗吻合檢查
  if (prefix.length > 0) {
    const available = Math.min(prefix.length, idx)
    const before = content.substr(idx - available, available)
    if (before.endsWith(prefix) || prefix.endsWith(before)) {
      contextMatches++
    }
  }

  // 後文窗吻合檢查
  if (suffix.length > 0) {
    const afterStart = idx + anchorText.length
    const available = Math.min(suffix.length, Math.max(0, content.length - afterStart))
    const after = content.substr(afterStart, available)
    if (after.startsWith(suffix) || suffix.startsWith(after)) {
      contextMatches++
    }
  }

  // 計算總評分：上下文匹配優先，距離其次
  return contextMatches * CONTEXT_MATCH_WEIGHT - Math.abs(idx - oldStart)
}

/**
 * 文字選取資訊
 */
export interface SelectionInfo {
  /** 選取的文字 */
  text: string
  /** 選取開始位置（0-based） */
  start: number
  /** 選取結束位置（0-based，不含） */
  end: number
  /** 前文窗（供錨點重定位用） */
  prefix: string
  /** 後文窗（供錨點重定位用） */
  suffix: string
}

/**
 * 擷取使用者在某元素內的文字選取
 *
 * 計算選取文字在該元素「呈現純文字」中的字元位移與前後文窗。
 * 這些資訊可供 reAnchor() 用來容忍內容編輯後的位置變化。
 *
 * @param element - 要掃描的 DOM 元素
 * @returns 選取資訊，或若選取無效則 null
 */
export function captureSelection(element: HTMLElement): SelectionInfo | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)

  // 檢查選取是否完全在該元素內
  if (!element.contains(range.commonAncestorContainer)) {
    return null
  }

  const text = range.toString()
  if (!text.trim()) {
    return null
  }

  // 計算選取在「元素純文字」中的位移
  const pre = range.cloneRange()
  pre.selectNodeContents(element)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const end = start + text.length

  // 取得前後文窗
  const full = element.textContent ?? ''
  const prefix = full.slice(Math.max(0, start - CONTEXT_WINDOW), start)
  const suffix = full.slice(end, end + CONTEXT_WINDOW)

  return { text, start, end, prefix, suffix }
}
