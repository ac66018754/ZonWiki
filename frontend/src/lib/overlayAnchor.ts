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
 * 在目標元素內，把錨定位置細化到「點所在（或最近）的那一行文字」的行首字元位移。
 *
 * 【為什麼需要】元素級錨定（錨在段落開頭）只能補償「整段被推移」：容器寬度改變時，
 * 段落左上角幾乎不動（rebase 差量≈0），但段內文字全部重新折行——畫在第 N 行的浮層/筆畫
 * 便對不上原本的字。細化到「行」之後，錨定的是那一行開頭的字，折行時 reAnchor 會找到
 * 那些字的新位置，rebase 差量＝那些字的位移，浮層就跨寬度跟著字走。
 *
 * 【做法】不用 caretRangeFromPoint——它以「最上層元素」做 hit-test，點被浮層/繪圖 SVG
 * 蓋住時打不到內容；改在（elementsFromPoint 過濾鏈已選出的）內容元素內，用 Range 幾何：
 *   1. 走訪元素內全部文字節點，蒐集每個節點的逐行矩形（getClientRects＝每個 line box 一個）；
 *   2. 取「垂直距離點最近」的行矩形；
 *   3. 在該文字節點內二分搜尋「第一個落在該行」的字元位移（同一文字節點內，
 *      字元位移 → 行 top 單調不減，二分成立）。
 *
 * @param container 內文容器。
 * @param target 內容元素（elementsFromPoint 過濾後的結果）。
 * @param clientY 螢幕座標 Y（畫記代表點）。
 * @returns 「target 子樹內、落在該行的第一個字元」在容器純文字中的位移
 * （target 為行內元素時即其自身文字的行內起點，非整個視覺行的行首——對 rebase
 * 差量計算無影響，只要是穩定的文字位置即可）；元素內無可用文字行時回 null（退回元素級）。
 */
function refineStartOffsetToLine(
  container: HTMLElement,
  target: Element,
  clientY: number
): number | null {
  // 1) 蒐集候選：每個文字節點的每個 line box。
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let bestNode: Text | null = null;
  let bestRect: DOMRect | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (;;) {
    const n = walker.nextNode() as Text | null;
    if (!n) break;
    if (!n.data.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const rect of Array.from(r.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      // 垂直距離：點在行內＝0；否則取到行緣的距離。
      const dist = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = n;
        bestRect = rect;
      }
    }
  }
  if (!bestNode || !bestRect) return null;

  // 2) 二分搜尋該文字節點內「第一個落在該行」的字元位移。
  const caretTop = (offset: number): number => {
    const r = document.createRange();
    r.setStart(bestNode!, offset);
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    // 摺疊 Range 於少數瀏覽器情境回零矩形 → 以「行首之前」處理（不影響單調性）。
    return rect.height > 0 || rect.top !== 0 ? rect.top : Number.NEGATIVE_INFINITY;
  };
  let lo = 0;
  let hi = bestNode.data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // 該位移的插入點仍在目標行上緣之前 → 行首在更後面。
    if (caretTop(mid) < bestRect.top - 1) lo = mid + 1;
    else hi = mid;
  }
  // 防呆①：整個節點的插入點矩形都退化（caretTop 恆 -∞）時，二分會收斂到節點尾端
  // ——那不是行首而是「跳過整行」，視為細化失敗、退回元素級。
  if (lo >= bestNode.data.length || caretTop(lo) === Number.NEGATIVE_INFINITY) return null;
  // 防呆②：不可切在 emoji 等 astral 字元的代理對（surrogate pair）中間——
  // 孤立代理經 JSON/UTF-8 序列化會變 U+FFFD，存下的錨定文字與 DOM 永久不一致。
  const prev = bestNode.data.charCodeAt(lo - 1);
  const curr = bestNode.data.charCodeAt(lo);
  if (lo > 0 && prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff) {
    lo -= 1; // 對齊回該字元的起點
  }

  // 3) 節點內位移 → 容器純文字位移。
  const pre = document.createRange();
  pre.selectNodeContents(container);
  try {
    pre.setEnd(bestNode, lo);
  } catch {
    return null;
  }
  return pre.toString().length;
}

/**
 * 依「螢幕座標點」建立內容錨點：找點下方（容器內、非 summary 的）內容元素，
 * 並細化到「點所在的那一行文字」（見 {@link refineStartOffsetToLine}——跨容器寬度
 * 折行重排時，行級錨點才能讓浮層跟著它壓住的字走；細化失敗退回元素級），
 * 取文字片段＋容器內位移＋前後文窗，並以「重定位同一片段」的方式取得基準位置 (ex, ey)
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

  const containerText = container.textContent ?? '';

  // 元素文字在容器純文字中的起始位移：Range(容器開頭 → 元素前) 的字數。
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(target, 0);
  // setEnd(target, 0) 對元素節點＝其第一個子節點之前；用 toString 取得前置文字長度。
  const elementStart = pre.toString().length;

  // 行級細化：錨定「點所在那一行（於目標元素子樹內）的第一個字元」（跨寬度折行的關鍵）；
  // 失敗退回元素級。
  const refinedStart = refineStartOffsetToLine(container, target, clientY);
  let start = refinedStart ?? elementStart;
  // 文字視窗封頂在「目標元素自身的文字範圍」內——若無界地從容器純文字往後切，
  // 短段落/標題會把下一個元素的字吃進錨定文字；之後只要下游內容被編輯，
  // reAnchor 的精確比對就永遠找不到，錨點靜默失效（對抗復審 HIGH）。
  const targetEnd = elementStart + (target.textContent ?? '').length;
  let text = containerText
    .slice(start, Math.min(start + ANCHOR_TEXT_MAX, targetEnd))
    .replace(/\s+$/g, '');
  if (!text.trim()) {
    // 細化位移落在（行尾/段末的）空白上 → 退回元素級錨定。
    start = elementStart;
    text = elText.slice(0, ANCHOR_TEXT_MAX);
  }
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
