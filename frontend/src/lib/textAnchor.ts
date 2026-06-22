/**
 * 文字錨點工具（與後端 NoteMark 錨點一致）。
 * 讓筆記內文「框選 / 重點 / 關聯」的定位與重新定位邏輯一致，容忍內容編輯造成的位移。
 * （移植自開問啦 canvas 的 anchor.ts，供筆記重用。）
 */

const CONTEXT_WINDOW = 24;
const CONTEXT_MATCH_WEIGHT = 1_000_000;

/** 錨點搜尋結果。 */
export interface AnchorResult {
  found: boolean;
  start: number;
  end: number;
}

/**
 * 在（可能已編輯的）內容中重新定位錨點文字。
 * 1. 舊位移仍精確命中 → 沿用；2. 否則掃所有出現位置、依前後文窗吻合與離舊位移遠近評分挑最佳；3. 找不到 → found=false。
 * @param content 目前完整純文字。
 * @param anchorText 要尋找的錨點文字。
 * @param oldStart 舊儲存的開始位置。
 * @param prefix 前文窗。
 * @param suffix 後文窗。
 */
export function reAnchor(
  content: string,
  anchorText: string,
  oldStart: number,
  prefix = "",
  suffix = ""
): AnchorResult {
  if (!content || !anchorText) return { found: false, start: 0, end: 0 };

  if (
    oldStart >= 0 &&
    oldStart + anchorText.length <= content.length &&
    content.substr(oldStart, anchorText.length) === anchorText
  ) {
    return { found: true, start: oldStart, end: oldStart + anchorText.length };
  }

  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  let from = 0;
  for (;;) {
    const idx = content.indexOf(anchorText, from);
    if (idx < 0) break;
    const score = scoreOccurrence(content, anchorText, idx, oldStart, prefix, suffix);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
    from = idx + 1;
  }

  if (bestIndex < 0) return { found: false, start: 0, end: 0 };
  return { found: true, start: bestIndex, end: bestIndex + anchorText.length };
}

/** 對單個出現位置評分（前後文窗吻合優先、離舊位移近者次之）。 */
function scoreOccurrence(
  content: string,
  anchorText: string,
  idx: number,
  oldStart: number,
  prefix: string,
  suffix: string
): number {
  let contextMatches = 0;
  if (prefix.length > 0) {
    const available = Math.min(prefix.length, idx);
    const before = content.substr(idx - available, available);
    if (before.endsWith(prefix) || prefix.endsWith(before)) contextMatches++;
  }
  if (suffix.length > 0) {
    const afterStart = idx + anchorText.length;
    const available = Math.min(suffix.length, Math.max(0, content.length - afterStart));
    const after = content.substr(afterStart, available);
    if (after.startsWith(suffix) || suffix.startsWith(after)) contextMatches++;
  }
  return contextMatches * CONTEXT_MATCH_WEIGHT - Math.abs(idx - oldStart);
}

/** 文字選取資訊。 */
export interface SelectionInfo {
  text: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

/**
 * 擷取使用者在某元素內的文字選取（計算在「呈現純文字」中的位移與前後文窗）。
 * @param element 要掃描的 DOM 元素。
 * @returns 選取資訊，或選取無效時 null。
 */
export function captureSelection(element: HTMLElement): SelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;

  const text = range.toString();
  if (!text.trim()) return null;

  const pre = range.cloneRange();
  pre.selectNodeContents(element);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + text.length;

  const full = element.textContent ?? "";
  const prefix = full.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const suffix = full.slice(end, end + CONTEXT_WINDOW);

  return { text, start, end, prefix, suffix };
}
