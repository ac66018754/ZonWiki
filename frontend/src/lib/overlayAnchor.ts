/**
 * 浮層畫記的「內容錨點」工具：讓手繪畫記／便利貼／文字框「跟著它所在的文字走」。
 *
 * 【為什麼需要】浮層座標是相對內文容器的絕對像素，只在「畫記當下的 toggle 展開狀態」的版面裡正確。
 * 多層 :::toggle 下，收合/展開任何一段都會讓後面的內容整段位移，絕對座標便對不上原本的文字
 * （2026-07-08 使用者實測：在「只展開 §2」時畫的畫記，按「全部展開」後視覺上跑到 §1 的內容上）。
 *
 * 【做法】建立畫記當下，把「它壓在哪段文字上」持久化成文字錨點（文字片段＋容器內位移＋前後文窗，
 * 沿用畫重點的 {@link reAnchor} 容錯重定位），並記錄該文字範圍當時相對容器的位置 (ex, ey)。
 * 之後任何版面變動（收合/展開/重載/內容編輯）都：
 *   1. 以文字重新定位 Range（不依賴 DOM 元素身分，跨重繪穩定；也不需要在視窗內）；
 *   2. Range 不可見（位於收合的 details 內 → getClientRects 為空）→ 畫記隱藏；
 *   3. Range 可見且位置與 (ex, ey) 不同 → 把畫記座標平移同樣的差量（rebase），並更新 (ex, ey)。
 * 如此畫記永遠貼著它的文字，且判定是純函式（同版面 → 同結果）。
 */

import { reAnchor } from '@/lib/textAnchor';

/** 錨點文字片段的最大長度（足以辨識、避免存整段長文）。 */
const ANCHOR_TEXT_MAX = 64;
/** 前後文窗長度（與 textAnchor 的 CONTEXT_WINDOW 一致）。 */
const CONTEXT_WINDOW = 24;

/** 持久化的內容錨點（存於 overlay item 的 dataJson 或 shape 的 anchor 欄）。 */
export interface OverlayAnchor {
  /** 錨定的文字片段（容器純文字中的連續片段，截前 64 字）。 */
  text: string;
  /** 該片段在容器 textContent 中的起始位移（重定位起點提示）。 */
  start: number;
  /** 前文窗（消歧義用）。 */
  prefix: string;
  /** 後文窗（消歧義用）。 */
  suffix: string;
  /** 上次 rebase 時，錨定文字範圍相對容器的位置（px）。 */
  ex: number;
  /** 同上（y）。 */
  ey: number;
}

/** 寬鬆驗證：dataJson 裡撈出來的東西是否為可用的錨點。 */
export function isOverlayAnchor(v: unknown): v is OverlayAnchor {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.text === 'string' && a.text.length > 0 &&
    typeof a.start === 'number' &&
    typeof a.prefix === 'string' &&
    typeof a.suffix === 'string' &&
    typeof a.ex === 'number' &&
    typeof a.ey === 'number'
  );
}

/** 錨點重定位結果。 */
export interface AnchorLocation {
  /** 錨定文字目前是否可見（false＝位於收合的 details 內或被隱藏 → 畫記應隱藏）。 */
  visible: boolean;
  /** 可見時：文字範圍目前相對容器的位置（px）。不可見時為 0（勿使用）。 */
  x: number;
  /** 同上（y）。 */
  y: number;
}

/** 把容器內「純文字位移區間」轉成 DOM Range；找不到（位移超界）回 null。 */
function rangeFromOffsets(container: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (;;) {
    const n = walker.nextNode() as Text | null;
    if (!n) break;
    const len = n.data.length;
    if (startNode === null && pos + len > start) {
      startNode = n;
      startOffset = start - pos;
    }
    if (pos + len >= end) {
      endNode = n;
      endOffset = end - pos;
      break;
    }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    return null;
  }
  return range;
}

/**
 * 依「螢幕座標點」建立內容錨點：找點下方（容器內、非 summary 的）內容元素，
 * 取其文字片段＋容器內位移＋前後文窗，並以「重定位同一片段」的方式取得基準位置 (ex, ey)
 * ——基準位置與日後 rebase 用同一套定位流程，保證差量計算不含系統性偏差。
 * @param container 內文容器（.markdown-prose）。
 * @param clientX 螢幕座標 X（畫記代表點）。
 * @param clientY 螢幕座標 Y。
 * @returns 錨點；點下無可錨定文字（視窗外/空白區/無文字元素）回 null（呼叫端 fallback 絕對座標）。
 */
export function computeAnchorAt(container: HTMLElement, clientX: number, clientY: number): OverlayAnchor | null {
  if (clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) return null;
  let target: Element | null = null;
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el === container || !container.contains(el)) continue; // 跳過浮層自身與外部元素
    if (el.tagName === 'SUMMARY') continue; // 摘要列收合時仍可見，不當內容錨點
    target = el;
    break;
  }
  if (!target) return null;
  const elText = (target.textContent ?? '').replace(/\s+$/g, '');
  if (!elText.trim()) return null;

  // 元素文字在容器純文字中的起始位移：Range(容器開頭 → 元素前) 的字數。
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(target, 0);
  // setEnd(target, 0) 對元素節點＝其第一個子節點之前；用 toString 取得前置文字長度。
  const start = pre.toString().length;

  const containerText = container.textContent ?? '';
  const text = elText.slice(0, ANCHOR_TEXT_MAX);
  const prefix = containerText.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const suffix = containerText.slice(start + text.length, start + text.length + CONTEXT_WINDOW);

  const anchor: OverlayAnchor = { text, start, prefix, suffix, ex: 0, ey: 0 };
  // 基準位置用「重定位流程」取得（與 rebase 同路徑）。
  const loc = locateAnchor(container, anchor);
  if (!loc || !loc.visible) return null;
  anchor.ex = loc.x;
  anchor.ey = loc.y;
  return anchor;
}

/**
 * 重定位錨點：以文字（含前後文窗容錯）找到目前的 Range，回報可見性與目前位置。
 * @param container 內文容器。
 * @param anchor 持久化錨點。
 * @param cachedText 已算好的 container.textContent（同一輪對多個畫記重定位時傳入，
 * 避免每個畫記都重新序列化整棵 DOM 樹；未傳則自行計算）。
 * @returns null＝文字已不存在（內容被編輯刪除）→ 呼叫端 fallback 絕對座標、不隱藏。
 */
export function locateAnchor(
  container: HTMLElement,
  anchor: OverlayAnchor,
  cachedText?: string
): AnchorLocation | null {
  const containerText = cachedText ?? container.textContent ?? '';
  const r = reAnchor(containerText, anchor.text, anchor.start, anchor.prefix, anchor.suffix);
  if (!r.found) return null;
  const range = rangeFromOffsets(container, r.start, r.end);
  if (!range) return null;
  // 「是否位於收合的 <details> 內」必須用 DOM 祖先鏈判定——不可用 getClientRects()：
  // 新版 Chrome 對收合 details 的內容採 hidden=until-found 語意（供頁內搜尋），
  // 內容不繪製但幾何查詢仍回傳「彷彿展開」的非空矩形（2026-07-08 實測）。
  const startEl: Element | null =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  for (let p: Element | null = startEl; p && p !== container; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement && !p.open) return { visible: false, x: 0, y: 0 };
  }
  const rects = range.getClientRects();
  if (rects.length === 0) return { visible: false, x: 0, y: 0 }; // 其他隱藏情況（display:none 等）
  const rect = range.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  return { visible: true, x: rect.left - cRect.left, y: rect.top - cRect.top };
}
