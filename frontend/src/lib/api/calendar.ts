/**
 * API 領域模組 — 行事曆（Calendar）。
 */

import { fetchJson } from "./client";
import type { NoteSummary } from "./notes";
import type { TaskCard } from "./tasks";

/**
 * 行事曆視圖資料
 */
export interface CalendarViewData {
  /** 時間範圍內的任務卡片 */
  tasks: TaskCard[];
  /** 時間範圍內的日記筆記 */
  journalNotes: NoteSummary[];
  /** 起始日期 (UTC) */
  from: string;
  /** 結束日期 (UTC) */
  to: string;
}

/**
 * 取得特定時間範圍內的行事曆資料
 * @param from 開始日期 (UTC)
 * @param to 結束日期 (UTC)
 */
export async function getCalendarView(
  from: Date,
  to: Date
): Promise<CalendarViewData | null> {
  const r = await fetchJson<CalendarViewData>(
    `/api/calendar?from=${encodeURIComponent(
      from.toISOString()
    )}&to=${encodeURIComponent(to.toISOString())}`
  );
  return r.data ?? null;
}
