/**
 * 歷史時間軸「按天分組」的純函式（2026-08-13 使用者裁示：歷史 UI 分組摺疊）。
 *
 * 分組基準與顯示時間同一時區（NoteEditHistory 的 userTimeZone）——
 * 分組用裝置時區、顯示用 userTimeZone 會出現「組頭日期與組內時間對不上」（對抗復審 M4）。
 */

/** 帶時間戳的時間軸項目（NoteEditHistory 的 TimelineEntry 最小形狀）。 */
export interface TimedEntry {
  /** 排序/分組用時間（UTC ISO 字串）。 */
  at: string;
}

/** 一天的分組。 */
export interface DayGroup<T extends TimedEntry> {
  /** 該天的日期鍵（指定時區的 YYYY-MM-DD）。 */
  day: string;
  /** 該天的項目（維持傳入順序——呼叫端已依時間倒序排好）。 */
  entries: T[];
}

/**
 * 把「指定時區」下的日期鍵（YYYY-MM-DD）從 UTC ISO 時間字串算出來。
 *
 * @param isoUtc UTC ISO 時間字串。
 * @param timeZone IANA 時區（例如 "Asia/Taipei"）。
 * @returns YYYY-MM-DD；無法解析時回 "unknown"（分組成一坨而非拋錯）。
 */
export function dayKeyInTimeZone(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return 'unknown';
  // en-CA 的日期格式正好是 YYYY-MM-DD，免手工拼接時區轉換。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * 把（已依時間倒序的）時間軸項目按「指定時區的日期」分組，維持組內順序；
 * 分組順序＝項目出現順序（倒序輸入 → 最新的天在最前）。
 *
 * @param entries 已排序的時間軸項目。
 * @param timeZone IANA 時區。
 * @returns 依天分組的清單。
 */
export function groupEntriesByDay<T extends TimedEntry>(
  entries: readonly T[],
  timeZone: string,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  let current: DayGroup<T> | null = null;
  for (const entry of entries) {
    const day = dayKeyInTimeZone(entry.at, timeZone);
    if (current === null || current.day !== day) {
      current = { day, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }
  return groups;
}
