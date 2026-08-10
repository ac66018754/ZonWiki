/**
 * VS 風格「滑鼠側鍵錨點導航」純邏輯模組（mouse navigation anchors）。
 *
 * 靈感：Visual Studio 的 View.NavigateBackward / NavigateForward——編輯器會在
 * 「游標大幅移動」時自動留下 go-back marker，滑鼠上一頁/下一頁鍵在這些標記間穿梭，
 * 而不是走瀏覽器歷史。本模組把同一套心智模型帶進 ZonWiki：
 * - 錨點（anchor）＝「路由（pathname+search）＋當下捲動位置」。
 * - 左鍵點擊、路由變更都會下錨；同頁同位置附近的重複點擊原地更新、不灌爆堆疊。
 * - 側鍵上一頁/下一頁在錨點堆疊中移動；離開目前錨點前會把「即時位置」寫回
 *   目前錨點（live 同步），所以「下一頁」永遠能回到你按「上一頁」當下的位置。
 *
 * 設計要點（2026-08-10 TDD 審查後定案）：
 * - goBack/goForward 的 live 同步「永遠原地覆寫」，絕不重用 recordAnchor 的
 *   push 判斷——否則深捲超過去重門檻後按上一頁，會被誤判成新錨點而
 *   「回到同頁頂端＋砍掉前進歷史」（審查抓到的核心洞）。
 * - 不可移動（回傳 null）時保證零副作用，呼叫端可安心放行瀏覽器原生歷史。
 * - 全部函式不可變（immutable）：回傳新 state，不就地修改輸入。
 *
 * 存於 sessionStorage（比照 noteNav.ts）：同一分頁的瀏覽過程有效，關分頁即清除。
 */

/** 一個導航錨點：在哪個路由、捲到哪裡。 */
export interface MouseNavAnchor {
  /** 路由（pathname + search，不含網域），例如 "/notes/xxx" 或 "/tasks?view=board"。 */
  route: string;
  /** 當下捲動容器的 scrollTop（px）。 */
  scrollTop: number;
}

/** 錨點堆疊狀態：一條時間線＋目前所在位置。 */
export interface MouseNavState {
  /** 錨點清單（舊 → 新）。 */
  entries: MouseNavAnchor[];
  /** 目前所在錨點的索引；-1 ＝ 空堆疊。 */
  index: number;
}

/** sessionStorage 的儲存鍵。 */
export const MOUSE_NAV_STORAGE_KEY = "zonwiki:mouse-nav-stack";

/** 堆疊上限：超過即丟最舊（與 noteNav 同量級）。 */
export const MOUSE_NAV_MAX_ENTRIES = 50;

/**
 * 同 route 下錨的去重門檻（px）：新舊捲動位置差在此範圍內視為「同一個位置」，
 * 原地更新而不新增錨點——類比 VS「游標移動 11 行以上才留 go-back marker」。
 */
export const SCROLL_DEDUPE_PX = 120;

/** 滑鼠「上一頁」側鍵的 event.button 值（Chromium 實測）。 */
export const MOUSE_BACK_BUTTON = 3;

/** 滑鼠「下一頁」側鍵的 event.button 值（Chromium 實測）。 */
export const MOUSE_FORWARD_BUTTON = 4;

/**
 * 建立空堆疊。
 * @returns 沒有任何錨點的初始狀態。
 */
export function emptyState(): MouseNavState {
  return { entries: [], index: -1 };
}

/**
 * 判斷事件是否為滑鼠「上一頁」側鍵。
 * @param event 帶 button 欄位的滑鼠事件（或相容物件）。
 * @returns 是否為上一頁側鍵（button === 3）。
 */
export function isBackButton(event: { button: number }): boolean {
  return event.button === MOUSE_BACK_BUTTON;
}

/**
 * 判斷事件是否為滑鼠「下一頁」側鍵。
 * @param event 帶 button 欄位的滑鼠事件（或相容物件）。
 * @returns 是否為下一頁側鍵（button === 4）。
 */
export function isForwardButton(event: { button: number }): boolean {
  return event.button === MOUSE_FORWARD_BUTTON;
}

/**
 * 是否還有「上一個錨點」可退。
 * @param state 目前堆疊。
 * @returns index 之前還有錨點即為真。
 */
export function canGoBack(state: MouseNavState): boolean {
  return state.index > 0;
}

/**
 * 是否還有「下一個錨點」可進。
 * @param state 目前堆疊。
 * @returns index 之後還有錨點即為真。
 */
export function canGoForward(state: MouseNavState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1;
}

/**
 * 下錨（左鍵點擊／路由變更時呼叫）。
 *
 * - 與目前錨點同 route 且捲動差 ≤ 去重門檻 → 原地更新目前錨點的 scrollTop（不新增）。
 * - 否則 → 截斷 index 之後的前進分支、推入新錨點（瀏覽器歷史語意），
 *   超過上限時丟最舊。
 *
 * @param state 目前堆疊（不會被修改）。
 * @param anchor 要記錄的錨點。
 * @returns 新的堆疊狀態。
 */
export function recordAnchor(state: MouseNavState, anchor: MouseNavAnchor): MouseNavState {
  if (!anchor.route) return state; // 防禦：空 route 不記錄

  const current = state.index >= 0 ? state.entries[state.index] : null;
  const isSamePlace =
    current !== null &&
    current.route === anchor.route &&
    Math.abs(current.scrollTop - anchor.scrollTop) <= SCROLL_DEDUPE_PX;

  if (isSamePlace) {
    // 同一個位置附近的重複下錨：原地更新捲動位置即可，不灌爆堆疊。
    const entries = state.entries.slice();
    entries[state.index] = { ...current, scrollTop: anchor.scrollTop };
    return { entries, index: state.index };
  }

  // 新位置：砍掉前進分支、推入新錨點（與瀏覽器歷史「回退後再前進即開新分支」一致）。
  let entries = [...state.entries.slice(0, state.index + 1), { ...anchor }];
  if (entries.length > MOUSE_NAV_MAX_ENTRIES) {
    entries = entries.slice(entries.length - MOUSE_NAV_MAX_ENTRIES);
  }
  return { entries, index: entries.length - 1 };
}

/**
 * 把「按下側鍵當下的即時捲動位置」原地寫回目前錨點。
 * 前提：呼叫端已確認 live.route 與目前錨點同 route。
 * 永遠原地覆寫、永遠不 push——這是與 recordAnchor 的關鍵語意差異。
 *
 * @param state 目前堆疊。
 * @param live 即時位置。
 * @returns 同步後的新堆疊（index 不變）。
 */
function syncLivePosition(state: MouseNavState, live: MouseNavAnchor): MouseNavState {
  const entries = state.entries.slice();
  entries[state.index] = { ...entries[state.index], scrollTop: live.scrollTop };
  return { entries, index: state.index };
}

/** goBack / goForward 的成功結果：新狀態＋要前往的目標錨點。 */
export interface MouseNavMove {
  /** 移動後的堆疊狀態。 */
  state: MouseNavState;
  /** 要還原的目標錨點。 */
  target: MouseNavAnchor;
}

/**
 * 往「上一個錨點」退一步。
 *
 * @param state 目前堆疊（不會被修改）。
 * @param live 按下側鍵當下的即時位置（route 取自 window.location）。
 * @returns 移動結果；不可退時回 null（保證零副作用）。
 *   若 live.route 與目前錨點脫鉤（理論上路由變更都會被記錄，僅防禦），
 *   回「目前錨點」作為目標、state 不變——把使用者帶回最後一個已知錨點。
 */
export function goBack(state: MouseNavState, live: MouseNavAnchor): MouseNavMove | null {
  if (!canGoBack(state)) return null;
  const current = state.entries[state.index];
  if (current.route !== live.route) {
    return { state, target: current };
  }
  const synced = syncLivePosition(state, live);
  const index = state.index - 1;
  return { state: { entries: synced.entries, index }, target: synced.entries[index] };
}

/**
 * 往「下一個錨點」進一步。
 *
 * @param state 目前堆疊（不會被修改）。
 * @param live 按下側鍵當下的即時位置。
 * @returns 移動結果；不可進、或 live.route 與目前錨點脫鉤時回 null（零副作用）。
 */
export function goForward(state: MouseNavState, live: MouseNavAnchor): MouseNavMove | null {
  if (!canGoForward(state)) return null;
  const current = state.entries[state.index];
  if (current.route !== live.route) return null;
  const synced = syncLivePosition(state, live);
  const index = state.index + 1;
  return { state: { entries: synced.entries, index }, target: synced.entries[index] };
}

/**
 * 從 sessionStorage 載入堆疊；壞資料（JSON 壞、型別錯、index 越界）一律回空堆疊。
 * @returns 載入的堆疊狀態（失敗即空）。
 */
export function loadState(): MouseNavState {
  try {
    const raw = sessionStorage.getItem(MOUSE_NAV_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidState(parsed)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

/**
 * 把堆疊寫回 sessionStorage（失敗靜默忽略：無痕模式／配額滿）。
 * @param state 要儲存的堆疊狀態。
 */
export function saveState(state: MouseNavState): void {
  try {
    sessionStorage.setItem(MOUSE_NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * 驗證外來資料是否為合法的 MouseNavState（形狀＋index 範圍）。
 * @param value 從 sessionStorage 解析出的未知值。
 * @returns 是否合法。
 */
function isValidState(value: unknown): value is MouseNavState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { entries?: unknown; index?: unknown };
  if (!Array.isArray(candidate.entries)) return false;
  if (typeof candidate.index !== "number" || !Number.isInteger(candidate.index)) return false;
  if (candidate.index < -1 || candidate.index > candidate.entries.length - 1) return false;
  for (const entry of candidate.entries) {
    if (typeof entry !== "object" || entry === null) return false;
    const anchorCandidate = entry as { route?: unknown; scrollTop?: unknown };
    if (typeof anchorCandidate.route !== "string" || anchorCandidate.route.length === 0) return false;
    if (typeof anchorCandidate.scrollTop !== "number" || !Number.isFinite(anchorCandidate.scrollTop)) {
      return false;
    }
  }
  return true;
}
