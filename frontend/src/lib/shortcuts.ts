import { getUserSettings, updateUserSettings } from "./api";

/**
 * 可自訂鍵盤快捷鍵系統（共用模型）。
 *
 * - 動作分兩個範圍（scope）：
 *   - global：任何頁面皆可觸發（導覽、聚焦搜尋）。
 *   - tasks：僅在 Todo（日程規劃）頁觸發（行事曆檢視切換、顯示模式、新增任務）。
 * - 每個動作有「預設鍵」，使用者可重新綁定；只把「與預設不同」的覆寫存進後端
 *   （User.ShortcutsJson），跨裝置同步。前端載入時與預設合併成最終生效鍵位。
 */

/** 快捷鍵作用範圍。 */
export type ShortcutScope = "global" | "tasks" | "notes";

/**
 * 單一快捷鍵動作的定義。
 */
export interface ShortcutAction {
  /** 穩定的動作識別碼（存覆寫時的鍵）。 */
  id: string;
  /** 作用範圍。 */
  scope: ShortcutScope;
  /** 顯示用中文說明。 */
  label: string;
  /** 預設按鍵（單一字元，小寫）。 */
  defaultKey: string;
}

/**
 * 內建快捷鍵動作清單（含預設鍵）。
 * 預設鍵在「同一頁會同時生效的範圍」內互異即可——tasks 與 notes 是不同頁、不會同時生效，
 * 故可共用同一鍵（例如日程規劃與筆記都用 A 來「新增」）。衝突判定見 findConflicts（依範圍判斷）。
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  // ── 全域（任何頁面皆可用）──
  { id: "openHome", scope: "global", label: "返回首頁", defaultKey: "h" },
  { id: "openTasks", scope: "global", label: "前往 Todo（日程規劃）", defaultKey: "t" },
  { id: "openCanvas", scope: "global", label: "前往開問啦（畫布）", defaultKey: "q" },
  { id: "openNotes", scope: "global", label: "前往筆記", defaultKey: "n" },
  { id: "focusSearch", scope: "global", label: "聚焦全域搜尋框", defaultKey: "f" },
  { id: "cycleTheme", scope: "global", label: "切換顯示主題（暖紙→明亮→暗色→夜間）", defaultKey: "v" },
  // ── Todo 頁專用 ──
  { id: "calYear", scope: "tasks", label: "行事曆－年檢視", defaultKey: "y" },
  { id: "calMonth", scope: "tasks", label: "行事曆－月檢視", defaultKey: "m" },
  { id: "calWeek", scope: "tasks", label: "行事曆－週檢視", defaultKey: "w" },
  { id: "calDay", scope: "tasks", label: "行事曆－日檢視", defaultKey: "d" },
  { id: "newTodo", scope: "tasks", label: "彈出「新增任務」表單", defaultKey: "a" },
  // ── 筆記頁專用 ──
  { id: "newNote", scope: "notes", label: "彈出「新增筆記」表單", defaultKey: "a" },
];

/** scope → 顯示用中文標題（快捷鍵設定頁分區用）。 */
export const SHORTCUT_SCOPE_LABEL: Record<ShortcutScope, string> = {
  global: "全域（任何頁面）",
  tasks: "Todo 頁（日程規劃）",
  notes: "筆記頁",
};

/**
 * 各「頁面情境」會同時生效的範圍集合。global 在每個情境都生效；tasks 只在 Todo 頁、
 * notes 只在筆記頁。用於判斷兩個動作是否「可能同時生效而相撞」。
 */
const PAGE_CONTEXTS: readonly ShortcutScope[][] = [
  ["global", "tasks"],
  ["global", "notes"],
];

/** 兩個範圍是否「會在同一頁同時生效」（存在某情境同時包含兩者）。 */
function scopesCoexist(a: ShortcutScope, b: ShortcutScope): boolean {
  return PAGE_CONTEXTS.some((ctx) => ctx.includes(a) && ctx.includes(b));
}

/** 事件：快捷鍵覆寫已更新 → 通知執行器與側欄重新載入並套用。 */
export const SHORTCUTS_UPDATED_EVENT = "zonwiki:shortcuts-updated";

/** 事件：執行器把「頁面層」動作（如 Todo 頁檢視切換）派發給該頁處理。 */
export const SHORTCUT_ACTION_EVENT = "zonwiki:shortcut";

/** 快捷鍵覆寫對應表：動作 ID → 按鍵（小寫單一字元）。 */
export type ShortcutOverrides = Record<string, string>;

/**
 * 解析覆寫 JSON 字串（容錯：壞掉或非物件就回空）。
 * 僅保留「已知動作 ID ＋ 單一字元鍵」的項目，避免污染。
 * @param json 覆寫 JSON（可為 null/undefined）。
 * @returns 乾淨的覆寫對應表。
 */
export function parseOverrides(json: string | null | undefined): ShortcutOverrides {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return {};
    const out: ShortcutOverrides = {};
    for (const action of SHORTCUT_ACTIONS) {
      const value = raw[action.id];
      if (typeof value === "string" && value.length === 1) {
        out[action.id] = value.toLowerCase();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 取某動作目前「生效」的按鍵（有覆寫用覆寫，否則用預設）。
 * @param action 動作定義。
 * @param overrides 覆寫對應表。
 * @returns 生效的按鍵（小寫）。
 */
export function effectiveKey(action: ShortcutAction, overrides: ShortcutOverrides): string {
  return overrides[action.id] ?? action.defaultKey;
}

/**
 * 將覆寫序列化成「只含與預設不同」的最小 JSON。
 * 無任何覆寫時回空字串（後端視為清除＝還原全部預設）。
 * @param overrides 覆寫對應表。
 * @returns 最小化的 JSON 字串或空字串。
 */
export function serializeOverrides(overrides: ShortcutOverrides): string {
  const minimal: ShortcutOverrides = {};
  for (const action of SHORTCUT_ACTIONS) {
    const key = overrides[action.id];
    if (key && key.toLowerCase() !== action.defaultKey) {
      minimal[action.id] = key.toLowerCase();
    }
  }
  return Object.keys(minimal).length === 0 ? "" : JSON.stringify(minimal);
}

/**
 * 偵測按鍵衝突（依範圍判斷）：只有「會在同一頁同時生效」的兩個動作共用同鍵才算衝突。
 * 例如 newTodo(tasks) 與 newNote(notes) 都用 A，但分屬不同頁、不會同時生效 → 不算衝突；
 * global 與任一頁面範圍共存，故 global 的鍵與任何 tasks/notes 鍵相同仍算衝突。
 * @param overrides 覆寫對應表。
 * @returns 動作 ID → 與它衝突的其他動作 ID 陣列（無衝突者不入表）。
 */
export function findConflicts(overrides: ShortcutOverrides): Record<string, string[]> {
  const conflicts: Record<string, string[]> = {};
  for (const a of SHORTCUT_ACTIONS) {
    const keyA = effectiveKey(a, overrides);
    const others = SHORTCUT_ACTIONS.filter(
      (b) =>
        b.id !== a.id &&
        effectiveKey(b, overrides) === keyA &&
        scopesCoexist(a.scope, b.scope),
    ).map((b) => b.id);
    if (others.length > 0) conflicts[a.id] = others;
  }
  return conflicts;
}

// ────────────────────────────────────────────────────────────────────────────
// 載入 / 儲存（模組層快取，避免每頁重抓；更新後廣播事件即時套用）
// ────────────────────────────────────────────────────────────────────────────

/** 模組層快取的覆寫（首次載入後保存）。 */
let cachedOverrides: ShortcutOverrides | null = null;
/** 進行中的載入 Promise（避免併發重複請求）。 */
let inflight: Promise<ShortcutOverrides> | null = null;

/**
 * 載入使用者的快捷鍵覆寫（有快取則直接回；force 可強制重抓）。
 * @param force 是否略過快取強制重新抓取。
 * @returns 覆寫對應表。
 */
export async function loadShortcutOverrides(force = false): Promise<ShortcutOverrides> {
  if (!force && cachedOverrides) return cachedOverrides;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const settings = await getUserSettings();
      cachedOverrides = parseOverrides(settings?.shortcutsJson);
    } catch {
      cachedOverrides = {};
    }
    return cachedOverrides;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 儲存覆寫到後端，更新快取並廣播更新事件（讓執行器與側欄即時套用）。
 * @param overrides 要儲存的覆寫對應表。
 * @returns 是否成功。
 */
export async function saveShortcutOverrides(overrides: ShortcutOverrides): Promise<boolean> {
  const json = serializeOverrides(overrides);
  const result = await updateUserSettings({ shortcutsJson: json });
  if (result === null) return false;
  cachedOverrides = parseOverrides(json || null);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SHORTCUTS_UPDATED_EVENT));
  }
  return true;
}

/**
 * 按鍵的顯示文字（單一字元轉大寫顯示，較像「鍵帽」）。
 * @param key 按鍵字元。
 * @returns 顯示字串。
 */
export function keyCapLabel(key: string): string {
  return key ? key.toUpperCase() : "—";
}
