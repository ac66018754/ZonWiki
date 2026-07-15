import { toLocalInputValue, fromLocalInputValue } from "@/app/tasks/taskUtils";

/**
 * 時間追蹤共用工具：期間（日/週/月/年）計算與時間顯示格式化。
 *
 * 時間鐵則：後端一律存 UTC；歸日與期間邊界都以「使用者時區的牆上時間」為準——
 * 邊界＝使用者時區的 00:00 換算成 UTC（[from, to) 半開區間），
 * 歸日用 toLocalInputValue（不可用 `.split("T")[0]`，那是 UTC 日期、會歸錯天）。
 * 全部為純函式，方便單元測試。
 */

/** 歷史檢視模式。 */
export type ViewMode = "day" | "week" | "month" | "year";

/** 檢視模式的顯示標籤（分段控制用）。 */
export const VIEW_LABELS: { mode: ViewMode; label: string }[] = [
  { mode: "day", label: "日" },
  { mode: "week", label: "週" },
  { mode: "month", label: "月" },
  { mode: "year", label: "年" },
];

/** 牆上日期（無時區概念的年月日），所有期間運算都在此型別上做純日曆數學。 */
export interface WallDate {
  y: number;
  m: number; // 1-based
  d: number;
}

/** 把 "YYYY-MM-DD" 解析為牆上日期。 */
export function parseWallDate(dateStr: string): WallDate {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

/** 牆上日期 → "YYYY-MM-DD"。 */
export function wallDateToString(w: WallDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** 牆上日期加減天數（用 Date.UTC 做純日曆運算，與時區無關）。 */
export function addDays(w: WallDate, days: number): WallDate {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 牆上日期加減月數（日夾到目標月份的天數內，避免 1/31 +1 月溢位）。 */
export function addMonths(w: WallDate, months: number): WallDate {
  const total = w.y * 12 + (w.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(w.d, daysInMonth) };
}

/** 牆上日期的星期（0=日 … 6=六；純日曆運算）。 */
export function weekdayOf(w: WallDate): number {
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
}

/** 目前時刻在指定時區的牆上日期。 */
export function todayWallDate(tz: string): WallDate {
  return parseWallDate(toLocalInputValue(new Date().toISOString(), tz).slice(0, 10));
}

/** 星期的中文單字（0=日 … 6=六）。 */
export const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

/** 檢視期間：查詢範圍（UTC ISO，[from, to)）＋顯示標題。 */
export interface Period {
  fromIso: string;
  toIso: string;
  label: string;
}

/**
 * 依檢視模式與錨點牆上日期計算期間（邊界＝使用者時區的 00:00 換算成 UTC）。
 * @param mode 檢視模式（日/週/月/年）。
 * @param anchor 錨點牆上日期（使用者時區）。
 * @param tz 使用者 IANA 時區。
 */
export function computePeriod(mode: ViewMode, anchor: WallDate, tz: string): Period {
  const pad = (n: number) => String(n).padStart(2, "0");
  let startWall: WallDate;
  let endWall: WallDate; // 不含
  let label: string;

  if (mode === "day") {
    startWall = anchor;
    endWall = addDays(anchor, 1);
    label = `${anchor.y}/${pad(anchor.m)}/${pad(anchor.d)}（週${WEEKDAY_NAMES[weekdayOf(anchor)]}）`;
  } else if (mode === "week") {
    // 週一為一週之始。
    const offset = (weekdayOf(anchor) + 6) % 7;
    startWall = addDays(anchor, -offset);
    endWall = addDays(startWall, 7);
    const endShown = addDays(startWall, 6);
    label = `${startWall.y}/${pad(startWall.m)}/${pad(startWall.d)} – ${pad(endShown.m)}/${pad(endShown.d)}`;
  } else if (mode === "month") {
    startWall = { y: anchor.y, m: anchor.m, d: 1 };
    endWall = addMonths(startWall, 1);
    label = `${anchor.y} 年 ${anchor.m} 月`;
  } else {
    startWall = { y: anchor.y, m: 1, d: 1 };
    endWall = { y: anchor.y + 1, m: 1, d: 1 };
    label = `${anchor.y} 年`;
  }

  // 牆上 00:00 → UTC ISO（含 DST offset 校正；Asia/Taipei 無 DST，精確）。
  const fromIso = fromLocalInputValue(`${wallDateToString(startWall)}T00:00`, tz)!;
  const toIso = fromLocalInputValue(`${wallDateToString(endWall)}T00:00`, tz)!;
  return { fromIso, toIso, label };
}

/** 秒數 → 人類可讀時長（「32 秒」「45 分」「1 小時 23 分」）。 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} 秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} 分`;
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`;
}

/** UTC ISO → 使用者時區的「HH:mm」。 */
export function formatClock(iso: string, tz: string): string {
  return toLocalInputValue(iso, tz).slice(11, 16);
}

/** UTC ISO → 使用者時區的「MM/DD HH:mm」。 */
export function formatDateClock(iso: string, tz: string): string {
  const local = toLocalInputValue(iso, tz);
  return `${local.slice(5, 10).replace("-", "/")} ${local.slice(11, 16)}`;
}
