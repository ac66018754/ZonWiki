/**
 * 筆記情境的「返回」導覽堆疊（note navigation stack）。
 *
 * 為什麼不用瀏覽器 router.back()：那會回到「上一個瀏覽的任意頁」，包含 zonwiki 首頁/搜尋等
 * 非筆記情境，使用者在筆記間穿梭時按返回常常跳出筆記區。此堆疊「只記錄筆記情境頁」
 * （筆記詳情頁 /notes/<slug>、筆記清單/分類頁 /notes?categoryId=…），讓返回只在筆記情境內移動。
 *
 * 存於 sessionStorage：同一個分頁的瀏覽過程有效，關掉分頁即清除（不跨 session 汙染）。
 */

const STACK_KEY = "zonwiki:note-nav-stack";
const MAX_ENTRIES = 50;

/** 讀取目前堆疊（失敗回空陣列）。 */
function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(STACK_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

/** 寫回堆疊（失敗忽略）。 */
function writeStack(stack: string[]): void {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
  } catch {
    /* ignore（無痕/配額等） */
  }
}

/**
 * 抵達某個「筆記情境頁」時呼叫，維護返回堆疊。
 * - 若該 url 已在堆疊中（代表按返回回到較早的頁）→ 截斷到它為止（丟棄其後的分支）。
 * - 否則視為前進 → 推入堆疊尾端。
 * @param url 目前頁的路徑（含查詢字串），例如 /notes/xxx 或 /notes?categoryId=yyy。
 */
export function recordNoteNav(url: string): void {
  if (!url) return;
  const stack = readStack();
  const idx = stack.indexOf(url);
  if (idx >= 0) {
    stack.length = idx + 1; // 截斷到已存在的位置（回到較早頁）
  } else {
    stack.push(url);
    if (stack.length > MAX_ENTRIES) stack.shift();
  }
  writeStack(stack);
}

/**
 * 取得「目前頁的上一個筆記情境頁」作為返回目標。
 * @param currentUrl 目前頁路徑（含查詢字串）。
 * @returns 上一個筆記情境頁的路徑；若目前頁是堆疊起點（沒有上一個）則回 null。
 */
export function getNoteBackTarget(currentUrl: string): string | null {
  const stack = readStack();
  const idx = stack.indexOf(currentUrl);
  return idx > 0 ? stack[idx - 1] : null;
}
