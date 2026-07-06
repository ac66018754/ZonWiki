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

/**
 * 「最近造訪分類」的 sessionStorage 鍵。
 *
 * 獨立於返回堆疊：堆疊會在「回到較早頁」或「非筆記情境進入」時被截斷，
 * 掃堆疊找不到「來時的分類」（設計書 §7.2 洞 1：走到堆疊起點時堆疊只剩自己）。
 * 故另存一筆「最後一次造訪的分類 categoryId」，供返回步驟 3a 判斷「從哪個分類脈絡來就回哪」。
 */
const RECENT_CAT_KEY = "zonwiki:note-recent-category";

/**
 * 「本次預期的返回目標」的 sessionStorage 鍵（一次性標記）。
 *
 * 為什麼需要它（修 audit HIGH #1：重訪截斷吃掉分類脈絡）：
 * recordNoteNav 遇到「url 已在堆疊中」時無法單憑堆疊分辨這是「按返回回到較早頁」還是
 * 「前進點入一篇曾造訪過的筆記」。舊版一律截斷，導致「分類頁 C → 點曾造訪的筆記 N → 返回」
 * 時 C 被截掉、錯回 /notes。改由返回鈕在導頁前呼叫 {@link markBackNavigation} 立一次性標記，
 * recordNoteNav 讀到標記才截斷（返回語意），否則視為前進（move-to-top，保留來時脈絡頁）。
 */
const BACK_TARGET_KEY = "zonwiki:note-nav-back-target";

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
 * 讀取並清除「本次預期的返回目標」一次性標記（讀後即清）。
 * @returns 正規化後的返回目標路徑；未設定則回 null。
 */
function takeBackTarget(): string | null {
  try {
    const target = sessionStorage.getItem(BACK_TARGET_KEY);
    if (target !== null) sessionStorage.removeItem(BACK_TARGET_KEY);
    return target;
  } catch {
    return null;
  }
}

/**
 * 抵達某個「筆記情境頁」時呼叫，維護返回堆疊。
 *
 * 「url 已在堆疊中」時的分歧（修 audit HIGH #1）：
 * - 若 url ===「本次預期返回目標」（由返回鈕透過 {@link markBackNavigation} 立的一次性標記，讀後即清）
 *   → 視為「按返回回到較早頁」→ 截斷到它為止（丟棄其後分支，沿用原返回語意）。
 * - 否則 → 視為「前進到一篇曾造訪過的頁」（例如分類頁點入曾看過的筆記）→ 把舊出現位置移除、
 *   改推到尾端（move-to-top），保留來時的分類脈絡頁，避免舊版一律截斷把脈絡吃掉。
 * 「url 不在堆疊」→ 一律推入尾端（前進）。
 * @param url 目前頁的路徑（含查詢字串），例如 /notes/xxx 或 /notes?categoryId=yyy。
 */
export function recordNoteNav(url: string): void {
  if (!url) return;
  const stack = readStack();
  const idx = stack.indexOf(url);
  // 一次性標記無論走哪條路都要消費掉，避免殘留污染後續導覽。
  const backTarget = takeBackTarget();
  if (idx >= 0) {
    if (backTarget !== null && backTarget === url) {
      // 返回：截斷到已存在的位置（回到較早頁）。
      stack.length = idx + 1;
    } else {
      // 前進到已在堆疊中的頁：move-to-top（移除舊位置後推到尾端），保留來時脈絡。
      stack.splice(idx, 1);
      stack.push(url);
      if (stack.length > MAX_ENTRIES) stack.shift();
    }
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

/**
 * 把任意筆記 URL 正規化成「瀏覽器 location.pathname + location.search」的同形字串。
 *
 * 為什麼必須正規化（設計書 §7.2 洞 2，第二輪對抗式評審）：
 * 返回堆疊的比對是「字串完全相等」。筆記詳情頁抵達時記錄的是
 * `window.location.pathname + window.location.search`——瀏覽器對含非 ASCII 的 slug
 * 一律 **percent-encode**（例如中文 slug `/notes/中文` 會變成 `/notes/%E4%B8%AD%E6%96%87`）。
 * 但搜尋 API 回傳的 `result.url` 是後端未編碼形式（SearchEndpoints.cs:121＝`/notes/{Slug}`）。
 * 若把未編碼字串直接寫進堆疊，詳情頁 recordNoteNav 用「編碼形」比對會找不到→再 push 一筆→
 * 按返回跳回切換前的舊筆記（ZonWiki 大量使用中文 slug，屬常見情境）。
 *
 * 以 URL 解析器重建路徑即可得到與瀏覽器一致的編碼形；解析失敗（極端輸入）時原樣退回。
 * @param url 任意筆記路徑（可為未編碼、已編碼、含查詢字串或絕對網址）。
 * @returns 與瀏覽器 location.pathname+search 同形的字串。
 */
function normalizeNotePath(url: string): string {
  try {
    // 相對路徑需要一個 base 才能被 URL 解析；瀏覽器端用真實 origin，SSR/測試退回佔位 origin。
    const base =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "https://zonwiki.local";
    const parsed = new URL(url, base);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/**
 * 從「非筆記情境」（全域搜尋 / 首頁 / 外部連結）進入某筆記時呼叫：
 * 把返回堆疊重設為「只含此筆記」，使返回不會跳回無關的舊筆記，而是直接走分類階層
 * （設計書 §7.2 洞 2、§7.3 步驟 3a/3b/3c）。
 *
 * 存入前會正規化成瀏覽器 location 同形的編碼字串（見 {@link normalizeNotePath}），
 * 確保與筆記詳情頁 recordNoteNav 記錄的字串完全相等、能被「回到較早頁」比對命中而不再 push。
 * @param url 目標筆記的 URL（可為後端未編碼形式）。
 */
export function markNoteContextSwitch(url: string): void {
  if (!url) return;
  writeStack([normalizeNotePath(url)]);
}

/**
 * 由「返回鈕」在 router.push(target) 前呼叫：立一次性標記，宣告本次導頁是「返回」而非前進。
 *
 * 抵達 target 時，recordNoteNav 讀到此標記（讀後即清）便截斷堆疊到 target（回到較早頁語意），
 * 而不會把 target 當成新的前進頁做 move-to-top（設計書 §7.3；修 audit HIGH #1）。
 * 存入前正規化成瀏覽器 location 同形的編碼字串（見 {@link normalizeNotePath}），
 * 確保與 recordNoteNav 抵達時記錄的字串完全相等（中文 slug 亦然）。
 * @param target 返回目標的 URL（可為後端未編碼形式或含查詢字串）。
 */
export function markBackNavigation(target: string): void {
  if (!target) return;
  try {
    sessionStorage.setItem(BACK_TARGET_KEY, normalizeNotePath(target));
  } catch {
    /* ignore（無痕/配額等） */
  }
}

/**
 * 抵達某分類頁時記錄「最近造訪分類」的 categoryId（供返回步驟 3a）。
 * 獨立於返回堆疊，不受堆疊截斷影響。
 * @param categoryId 目前所在分類頁的分類 ID。
 */
export function recordRecentCategory(categoryId: string): void {
  if (!categoryId) return;
  try {
    sessionStorage.setItem(RECENT_CAT_KEY, categoryId);
  } catch {
    /* ignore（無痕/配額等） */
  }
}

/**
 * 取得「最近造訪分類」的 categoryId。
 * @returns 最近造訪的分類 ID；未曾記錄則回 null。
 */
export function getRecentCategoryId(): string | null {
  try {
    return sessionStorage.getItem(RECENT_CAT_KEY);
  } catch {
    return null;
  }
}
