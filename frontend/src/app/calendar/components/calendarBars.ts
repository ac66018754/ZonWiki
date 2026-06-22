/**
 * 行事曆「跨日橫條」共用佈局工具（Google Calendar 風格的 multi-day event bars）。
 *
 * 設計：
 * - 每個任務以 [起日, 迄日] 區間呈現（起＝排程或截止；迄＝截止或排程），跨日者畫成一條橫跨多格的橫條。
 * - 給「一列連續日期」（例如月視圖的一週、週視圖的七天），把每個任務裁切到該列範圍，
 *   再用貪婪法指派 lane（同一列中互相重疊的橫條往下堆疊），讓多條橫條不重疊。
 * - 時間鐵則：DB 存 UTC，一律用使用者時區把任務歸到「哪一天」。
 */
import type { TaskCard } from "@/lib/api";
import { dateKeyInTz } from "../../tasks/taskUtils";

/** 由本地年月日組出 YYYY-MM-DD（月曆格子由本地年月日建構，故直接取成分）。 */
export function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 解析 YYYY-MM-DD 成本地午夜的 Date。 */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 兩個日期鍵相差幾天（b - a）。 */
export function diffDays(aKey: string, bKey: string): number {
  const a = parseKey(aKey).getTime();
  const b = parseKey(bKey).getTime();
  return Math.round((b - a) / 86400000);
}

/** 任務的日期區間（依使用者時區歸日）；無任何時間則回 null。 */
export function taskRangeKeys(
  task: TaskCard,
  tz: string
): { startKey: string; endKey: string } | null {
  const startIso = task.plannedDateTime || task.dueDateTime;
  const endIso = task.dueDateTime || task.plannedDateTime;
  if (!startIso || !endIso) return null;
  let startKey = dateKeyInTz(startIso, tz);
  let endKey = dateKeyInTz(endIso, tz);
  // 萬一排程晚於截止，交換以保證 start <= end。
  if (startKey > endKey) {
    [startKey, endKey] = [endKey, startKey];
  }
  return { startKey, endKey };
}

/** 是否為跨日任務（起迄不同天）。 */
export function isMultiDay(task: TaskCard, tz: string): boolean {
  const r = taskRangeKeys(task, tz);
  return !!r && r.startKey !== r.endKey;
}

/**
 * 單一橫條（已裁切到某一列日期範圍）。
 * - startCol：在該列的起始欄索引（0-based）
 * - span：橫跨幾欄
 * - lane：第幾層（往下堆疊）
 * - continuesLeft/Right：是否延續到本列之外（畫成無左/右圓角，表示「未完」）
 */
export interface DayBarSegment {
  task: TaskCard;
  startCol: number;
  span: number;
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

/**
 * 把一組任務在「一列連續日期」上排出橫條 + lane。
 * @param rowDays 該列的連續日期（例如月視圖一週 7 天、週視圖 7 天）；不可含 null。
 * @param tasks   候選任務。
 * @param tz      使用者時區。
 * @returns segments（含 lane）與 laneCount（總層數，用於預留高度）。
 */
export function buildRowBars(
  rowDays: Date[],
  tasks: TaskCard[],
  tz: string
): { segments: DayBarSegment[]; laneCount: number } {
  if (rowDays.length === 0) return { segments: [], laneCount: 0 };
  const rowStartKey = localKey(rowDays[0]);
  const rowEndKey = localKey(rowDays[rowDays.length - 1]);

  // 先算出每個任務裁切到本列後的 [startCol, endCol]（含），並記錄是否延續到列外。
  type Raw = {
    task: TaskCard;
    startCol: number;
    endCol: number;
    continuesLeft: boolean;
    continuesRight: boolean;
    rangeStartKey: string;
  };
  const raws: Raw[] = [];
  for (const task of tasks) {
    const r = taskRangeKeys(task, tz);
    if (!r) continue;
    // 與本列無交集則略過。
    if (r.endKey < rowStartKey || r.startKey > rowEndKey) continue;
    const clippedStartKey = r.startKey < rowStartKey ? rowStartKey : r.startKey;
    const clippedEndKey = r.endKey > rowEndKey ? rowEndKey : r.endKey;
    const startCol = diffDays(rowStartKey, clippedStartKey);
    const endCol = diffDays(rowStartKey, clippedEndKey);
    raws.push({
      task,
      startCol,
      endCol,
      continuesLeft: r.startKey < rowStartKey,
      continuesRight: r.endKey > rowEndKey,
      rangeStartKey: r.startKey,
    });
  }

  // 排序：起始欄小者優先；同起始則「整體較早開始 / 較長」者優先，視覺較穩定。
  raws.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      a.rangeStartKey.localeCompare(b.rangeStartKey) ||
      b.endCol - b.startCol - (a.endCol - a.startCol)
  );

  // 貪婪指派 lane：每個 lane 記錄「已用到的最後一欄」，新橫條放進第一個不重疊的 lane。
  const laneLastEndCol: number[] = [];
  const segments: DayBarSegment[] = [];
  for (const raw of raws) {
    let lane = laneLastEndCol.findIndex((lastEnd) => lastEnd < raw.startCol);
    if (lane === -1) {
      lane = laneLastEndCol.length;
      laneLastEndCol.push(raw.endCol);
    } else {
      laneLastEndCol[lane] = raw.endCol;
    }
    segments.push({
      task: raw.task,
      startCol: raw.startCol,
      span: raw.endCol - raw.startCol + 1,
      lane,
      continuesLeft: raw.continuesLeft,
      continuesRight: raw.continuesRight,
    });
  }

  return { segments, laneCount: laneLastEndCol.length };
}

/**
 * 依任務給一組橫條配色（不同任務不同色，類似 Google Calendar；已完成則灰階）。
 * 以任務 Id 雜湊出色相 (hue)，在各主題下都是穩定的彩色 chip。
 */
export function barColors(task: TaskCard): { bg: string; fg: string; border: string } {
  if (task.status === "done") {
    return {
      bg: "var(--bg-surface-secondary, #e5e7eb)",
      fg: "var(--text-tertiary, #6b7280)",
      border: "var(--border-default, #d1d5db)",
    };
  }
  let hash = 0;
  const id = task.id || task.title || "";
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    bg: `hsl(${hue} 70% 88%)`,
    fg: `hsl(${hue} 70% 28%)`,
    border: `hsl(${hue} 60% 70%)`,
  };
}

/** 任務是否「涵蓋」某一天（該天落在 [起,迄] 內）。 */
export function taskCoversDay(task: TaskCard, dayKey: string, tz: string): boolean {
  const r = taskRangeKeys(task, tz);
  return !!r && r.startKey <= dayKey && dayKey <= r.endKey;
}
