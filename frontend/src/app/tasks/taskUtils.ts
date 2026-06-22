/**
 * 任務（日程規劃）模組共用工具：日期時區轉換、逾期/今天判斷、狀態/優先度中繼資料。
 *
 * 時間鐵則：DB 一律存 UTC，前端依使用者裝置時區顯示。
 * <input type="datetime-local"> 的值是「無時區的牆上時間」字串（YYYY-MM-DDTHH:mm），
 * 因此進出都要在「使用者時區的牆上時間」與「UTC ISO」之間正確換算。
 *
 * 邊界備註：
 * - isToday() / isOverdue() 依賴「當下」（Date.now()），在午夜前後屬正常的時間相依行為。
 * - fromLocalInputValue() 以 offset 校正法換算，在無 DST 的時區（如 Asia/Taipei）精確；
 *   有 DST 的時區在換日邊界理論上可能有 ±1 小時誤差（本專案使用者為 Asia/Taipei，不受影響）。
 * - wallParts() 在某些環境的 UTC 午夜邊界會回傳 hour="24"，已正規化為 "00"。
 */

/**
 * 預設時區（IANA）。實際使用時應傳入使用者的時區。
 */
export const FALLBACK_TZ = "Asia/Taipei";

/**
 * 把 UTC ISO 字串，轉成某時區下「datetime-local 輸入框」要用的牆上時間字串（YYYY-MM-DDTHH:mm）。
 * @param iso UTC ISO 字串（可空）。
 * @param tz IANA 時區。
 * @returns datetime-local 用字串；iso 為空時回傳空字串。
 */
export function toLocalInputValue(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = wallParts(date, tz);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * 把「datetime-local 輸入框」的牆上時間字串（解讀為某時區的當地時間），轉回 UTC ISO 字串。
 * @param local datetime-local 字串（YYYY-MM-DDTHH:mm，可空）。
 * @param tz IANA 時區。
 * @returns UTC ISO 字串；local 為空時回傳 null。
 */
export function fromLocalInputValue(local: string, tz: string): string | null {
  if (!local) return null;
  const [datePart, timePart] = local.split("T");
  if (!datePart || !timePart) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);

  // 先把這組牆上時間「當成 UTC」算出一個瞬間，再用該時區實際 offset 校正。
  const asUtcMs = Date.UTC(y, m - 1, d, hh, mm);
  const parts = wallParts(new Date(asUtcMs), tz);
  const renderedMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  const offset = renderedMs - asUtcMs; // 該時區領先 UTC 的毫秒數
  return new Date(asUtcMs - offset).toISOString();
}

/**
 * 取得某瞬間在指定時區的「牆上時間」各部位（補零字串）。
 */
function wallParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // 部分環境午夜會給 "24"，正規化為 "00"。
  if (map.hour === "24") map.hour = "00";
  return map as { year: string; month: string; day: string; hour: string; minute: string };
}

/**
 * 顯示用的日期時間格式（依時區）。
 * @param iso UTC ISO 字串。
 * @param tz IANA 時區。
 * @param withTime 是否顯示時間（預設 true）。
 */
export function formatDisplay(
  iso: string | null | undefined,
  tz: string,
  withTime = true
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-Hant", {
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: tz,
  }).format(date);
}

/**
 * 取得某 UTC ISO 在指定時區的「日期鍵」（YYYY-MM-DD）。
 * 用於行事曆把任務歸到正確的日期格（依使用者時區，而非瀏覽器時區）。
 */
export function dateKeyInTz(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = wallParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * 判斷某 ISO 日期（在指定時區）是否落在「今天」。
 */
export function isToday(iso: string | null | undefined, tz: string): boolean {
  if (!iso) return false;
  const a = wallParts(new Date(iso), tz);
  const b = wallParts(new Date(), tz);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * 判斷截止時間是否已逾期（早於現在）。注意：呼叫端需自行排除「已完成」的任務。
 */
export function isOverdue(dueIso: string | null | undefined): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

/**
 * 狀態中繼資料（看板欄位 / 標籤共用）。
 */
export const STATUS_META: Record<
  string,
  { label: string; icon: string; fg: string; bg: string }
> = {
  todo: { label: "待辦", icon: "📋", fg: "var(--status-warning-fg)", bg: "var(--status-warning-bg)" },
  doing: { label: "進行中", icon: "🚀", fg: "var(--action-secondary-fg)", bg: "var(--action-secondary-bg)" },
  done: { label: "完成", icon: "✅", fg: "var(--status-success-fg)", bg: "var(--status-success-bg)" },
};

/**
 * 看板欄位順序。
 */
export const STATUS_ORDER = ["todo", "doing", "done"] as const;

/**
 * 優先度中繼資料（0=無、1=低、2=中、3=高）。
 */
export const PRIORITY_META: { label: string; dot: string; fg: string }[] = [
  { label: "無", dot: "⚪", fg: "var(--text-tertiary)" },
  { label: "低", dot: "🟡", fg: "var(--action-secondary-fg)" },
  { label: "中", dot: "🟠", fg: "var(--status-warning-fg)" },
  { label: "高", dot: "🔴", fg: "var(--status-danger-fg)" },
];
