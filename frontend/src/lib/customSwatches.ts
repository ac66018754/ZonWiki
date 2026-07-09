/**
 * 「自訂色盤」共享存放區（畫筆／文字字色／文字底色各自一組，最多 10 色）。
 *
 * 需求（使用者）：畫筆、形狀、文字的顏色不要沿用固定預設，而是使用者可自行「儲存 10 個常用色」。
 * 設計：
 * - 以 localStorage 持久化（沿用本專案既有的 UI 偏好都存 localStorage 的慣例：主題、側欄寬、
 *   工具箱收合等）。屬「個人裝置偏好」，不進 DB。
 * - 提供跨元件即時同步：工具列的「內嵌快選」與展開色盤裡的同一組色盤是不同的 React 實體，
 *   單靠各自 useState 不會連動；故以「模組層訂閱＋記憶體快取」讓所有消費端同步重繪。
 * - 快取回傳「同一個陣列參照」直到真的變動，讓 useSyncExternalStore / useState 不會無限重繪。
 */

/** 色盤命名空間：pen＝畫筆/形狀、text-font＝文字字色、text-bg＝文字底色。 */
export type SwatchKey = 'pen' | 'text-font' | 'text-bg';

/** 每組色盤最多可存的顏色數。 */
export const MAX_SWATCHES = 10;

/** 各組色盤的「首次使用」預設值（可被使用者覆寫／移除，覆寫後即以 localStorage 為準）。 */
const DEFAULT_SWATCHES: Record<SwatchKey, string[]> = {
  // 畫筆／形狀：鮮明的前景色。
  pen: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827'],
  // 文字字色：同樣是前景色（獨立一組，改了不影響畫筆）。
  'text-font': ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827'],
  // 文字底色：柔和的背景色。
  'text-bg': ['#fef08a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fecaca'],
};

/** 組出 localStorage 的鍵名。 */
function storageKeyFor(key: SwatchKey): string {
  return `zonwiki:swatches:${key}`;
}

/** 記憶體快取：同一參照維持不變，直到 write 才換新陣列（供 React 穩定比較）。 */
const cache = new Map<SwatchKey, string[]>();
/** 各鍵的訂閱者集合（值變動時通知重繪）。 */
const listeners = new Map<SwatchKey, Set<() => void>>();

/** 從 localStorage 讀取並過濾成合法色陣列（壞資料回退預設）。 */
function readFromStorage(key: SwatchKey): string[] {
  if (typeof window === 'undefined') return DEFAULT_SWATCHES[key];
  try {
    const raw = window.localStorage.getItem(storageKeyFor(key));
    if (!raw) return DEFAULT_SWATCHES[key];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const colors = parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_SWATCHES);
      return colors;
    }
  } catch {
    /* 壞資料：回退預設 */
  }
  return DEFAULT_SWATCHES[key];
}

/**
 * 取得某組色盤目前的顏色（帶記憶體快取，回傳穩定參照）。
 * @param key 色盤命名空間。
 * @returns 顏色陣列（0~10 個 hex 字串）。
 */
export function getSwatches(key: SwatchKey): string[] {
  if (!cache.has(key)) cache.set(key, readFromStorage(key));
  return cache.get(key)!;
}

/**
 * 取得某組色盤的「首次預設值」（不讀 localStorage，穩定參照）。
 * 供 useSyncExternalStore 的 getServerSnapshot 用：SSR 端輸出的是預設值，client 端做
 * hydration 比對時也應回傳同一份預設（而非讀 localStorage），避免 hydration mismatch。
 * @param key 色盤命名空間。
 */
export function getDefaultSwatches(key: SwatchKey): string[] {
  return DEFAULT_SWATCHES[key];
}

/**
 * 覆寫某組色盤並持久化、通知所有訂閱者重繪。
 * @param key 色盤命名空間。
 * @param colors 新的顏色陣列（自動裁到最多 10 個）。
 */
export function setSwatches(key: SwatchKey, colors: string[]): void {
  const next = colors.slice(0, MAX_SWATCHES);
  cache.set(key, next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKeyFor(key), JSON.stringify(next));
    } catch {
      /* localStorage 滿／不可用：忽略，至少本回合記憶體是最新的 */
    }
  }
  listeners.get(key)?.forEach((fn) => fn());
}

/**
 * 把一個顏色加入色盤（去重、上限 10）。已存在或已滿則不動作。
 * @param key 色盤命名空間。
 * @param hex 要加入的顏色。
 */
export function addSwatch(key: SwatchKey, hex: string): void {
  const cur = getSwatches(key);
  if (cur.includes(hex) || cur.length >= MAX_SWATCHES) return;
  setSwatches(key, [...cur, hex]);
}

/**
 * 移除色盤中指定索引的顏色。
 * @param key 色盤命名空間。
 * @param index 要移除的索引。
 */
export function removeSwatchAt(key: SwatchKey, index: number): void {
  const cur = getSwatches(key);
  if (index < 0 || index >= cur.length) return;
  setSwatches(key, cur.filter((_, i) => i !== index));
}

/**
 * 訂閱某組色盤的變動。
 * @param key 色盤命名空間。
 * @param fn 變動時呼叫的回呼。
 * @returns 取消訂閱函式。
 */
export function subscribeSwatches(key: SwatchKey, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}
