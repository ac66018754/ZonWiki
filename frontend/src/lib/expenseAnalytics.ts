/**
 * 記帳分析頁——契約正規化與純函式（零 import，可獨立單元測試；比照 `lib/ttsPlayer.ts` 的做法）。
 *
 * 本檔集中三件事，皆為「無副作用純函式」，方便以 scratchpad node 腳本鎖死向量（前端無 jest/vitest）：
 *   1. 型別：對齊後端工作包 A（WP-A）契約 §0 的實際 JSON 欄名（camelCase）。
 *   2. `normalizeAnalytics`：把後端 DTO 容錯映射成前端內部模型——**主鍵用後端 §0 權威欄名，
 *      再列 fallback 別名**，避免任一端欄名微調就整段靜默壞掉（審查 HIGH 修正）。
 *   3. 圖表衍生數學：delta 計算、分類折疊、分位數分桶、日曆格建構、下鑽區間等。
 *
 * 契約權威來源＝WP-A `plan-analytics-backend.md §0`：後端實際送出的欄名為
 *   `month / monthTotal / monthCount / prevMonthTotal / deltaPct /
 *    monthlyTrend[{month,total}] / categoryBreakdown[{categoryId,name,icon,total,count}] /
 *    dailyTotals[{date,total}] / merchantTopN[{merchant,total,count}]`。
 * 契約收斂（審查 MEDIUM count 修正）：實作後的後端 `MonthlyTrendPointDto`／`DailyTotalDto`
 * **各帶 count**（走「後端補 count」那一擇），故前端型別也如實宣告 count 並映射，兩端為單一契約、
 * 無「宣告卻永遠 undefined」的欄位；熱圖以 count 顯示「N 筆」。
 * `deltaPct` 由後端計算，但前端自行以 `computeDelta(monthTotal, prevMonthTotal)` 為 delta 單一擁有者
 * （需要「方向＋金額差」三載體顯示，且與 TrendMonths 設定解耦），故前端不消費 `deltaPct`（審查 LOW 修正）。
 */

// ============================================================================
// 型別（對齊後端 WP-A §0 契約）
// ============================================================================

/**
 * 月趨勢單點（後端 `monthlyTrend[]`；缺月補零）。
 */
export interface TrendPoint {
  /** 月份 `YYYY-MM`。 */
  month: string;
  /** 該月總額。 */
  total: number;
  /** 該月筆數（缺月為 0）。 */
  count: number;
}

/**
 * 分類佔比切片（後端 `categoryBreakdown[]`）。
 */
export interface CategorySlice {
  /** 分類 Id；`null`＝未分類桶。 */
  categoryId: string | null;
  /** 分類名稱；`null`＝未分類（顯示「未分類」）。 */
  name: string | null;
  /** 分類圖示（emoji）；可空。 */
  icon: string | null;
  /** 該分類該月總額。 */
  total: number;
  /** 該分類該月筆數。 */
  count: number;
  /**
   * 是否為前端折疊產生的「其他」彙總片（非單一真實分類）。
   * 折疊片與未分類片皆無法用清單端點的 `categoryId` 精準下鑽，故 UI 以此關閉其下鑽。
   */
  isAggregate?: boolean;
}

/**
 * 每日總額（後端 `dailyTotals[]`）。
 */
export interface DailyPoint {
  /** 日期 `YYYY-MM-DD`（UTC 日界）。 */
  date: string;
  /** 當日總額。 */
  total: number;
  /** 當日筆數。 */
  count: number;
}

/**
 * 商家 Top N 切片（後端 `merchantTopN[]`）。
 */
export interface MerchantSlice {
  /** 商家名稱（正規化後）。 */
  merchant: string;
  /** 該商家該月總額。 */
  total: number;
  /** 該商家該月筆數。 */
  count: number;
}

/**
 * 記帳分析彙總——一次回傳所有圖表所需資料（前端只發 1 個請求）。
 */
export interface ExpenseAnalytics {
  /** 分析月份 `YYYY-MM`（UTC 月界；回顯入參正規化後值）。 */
  month: string;
  /** 該月有效消費總額（軟刪除已排除）。空月＝0。 */
  monthTotal: number;
  /** 該月有效消費筆數。空月＝0。 */
  monthCount: number;
  /** 上一個月（該月 -1）總額。無資料＝0。 */
  prevMonthTotal: number;
  /** 近 N 月趨勢，時序升冪（最舊→選定月），含補零月份。 */
  monthlyTrend: TrendPoint[];
  /** 選定月分類佔比，按 total 降冪。 */
  categoryBreakdown: CategorySlice[];
  /** 選定月每日總額，按 date 升冪；只含有資料的日（前端自建整月格子、缺日補 0）。 */
  dailyTotals: DailyPoint[];
  /** 選定月商家 Top N，按 total 降冪。 */
  merchantTopN: MerchantSlice[];
}

// ============================================================================
// 正規化輔助
// ============================================================================

/**
 * 把未知值安全轉為有限數字，失敗回 0。
 * @param value 任意值（可能是 number／numeric string／null／undefined）。
 * @returns 有限數字或 0。
 */
function toFiniteNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * 依序回傳第一個「非 undefined 且非 null」的鍵值（容錯別名用）。
 * @param source 原始物件。
 * @param keys 依優先序排列的候選鍵名（主鍵在前、fallback 別名在後）。
 * @returns 第一個有值的欄位；全無則 undefined。
 */
function pickField(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/**
 * 安全取字串，非字串回 null。
 * @param value 任意值。
 * @returns 字串或 null。
 */
function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * 把未知值視為物件（供逐欄取值）；非物件回空物件。
 * @param value 任意值。
 * @returns Record 視圖。
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 把單一趨勢點正規化（主鍵 month/total，容錯 amount）。
 * @param raw 原始項。
 * @returns TrendPoint。
 */
function normalizeTrendPoint(raw: unknown): TrendPoint {
  const record = asRecord(raw);
  return {
    month: toStringOrNull(record.month) ?? "",
    total: toFiniteNumber(pickField(record, "total", "amount")),
    count: toFiniteNumber(record.count),
  };
}

/**
 * 把單一分類切片正規化（主鍵 name，容錯 categoryName）。
 * @param raw 原始項。
 * @returns CategorySlice。
 */
function normalizeCategorySlice(raw: unknown): CategorySlice {
  const record = asRecord(raw);
  return {
    categoryId: toStringOrNull(record.categoryId),
    name: toStringOrNull(pickField(record, "name", "categoryName")),
    icon: toStringOrNull(record.icon),
    total: toFiniteNumber(pickField(record, "total", "amount")),
    count: toFiniteNumber(record.count),
  };
}

/**
 * 把單一每日點正規化（主鍵 date，容錯 day）。
 * @param raw 原始項。
 * @returns DailyPoint。
 */
function normalizeDailyPoint(raw: unknown): DailyPoint {
  const record = asRecord(raw);
  return {
    date: toStringOrNull(pickField(record, "date", "day")) ?? "",
    total: toFiniteNumber(pickField(record, "total", "amount")),
    count: toFiniteNumber(record.count),
  };
}

/**
 * 把單一商家切片正規化（主鍵 merchant，容錯 name）。
 * @param raw 原始項。
 * @returns MerchantSlice。
 */
function normalizeMerchantSlice(raw: unknown): MerchantSlice {
  const record = asRecord(raw);
  return {
    merchant: toStringOrNull(pickField(record, "merchant", "name")) ?? "",
    total: toFiniteNumber(pickField(record, "total", "amount")),
    count: toFiniteNumber(record.count),
  };
}

/**
 * 把未知值當陣列（非陣列回空陣列）。
 * @param value 任意值。
 * @returns 陣列。
 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 把後端分析 DTO 容錯正規化成前端內部模型。
 *
 * **主鍵一律用後端 §0 權威欄名，其後才列 fallback 別名**（審查 HIGH 修正：先前別名表全部猜錯）：
 *   - `monthTotal`（← currentTotal ← total）
 *   - `monthCount`（← currentCount ← count）
 *   - `prevMonthTotal`（← previousTotal ← lastMonthTotal）
 *   - `monthlyTrend`（← trend）／`categoryBreakdown`（← categories）
 *   - `dailyTotals`（← daily）／`merchantTopN`（← merchants ← topMerchants）
 *
 * @param raw 後端回傳的 DTO（ApiResponse.data）；非物件一律回 null。
 * @returns 正規化後的分析模型，或 null（非物件／空）。
 */
export function normalizeAnalytics(raw: unknown): ExpenseAnalytics | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  return {
    month: toStringOrNull(record.month) ?? "",
    monthTotal: toFiniteNumber(pickField(record, "monthTotal", "currentTotal", "total")),
    monthCount: toFiniteNumber(pickField(record, "monthCount", "currentCount", "count")),
    prevMonthTotal: toFiniteNumber(
      pickField(record, "prevMonthTotal", "previousTotal", "lastMonthTotal"),
    ),
    monthlyTrend: asArray(pickField(record, "monthlyTrend", "trend")).map(normalizeTrendPoint),
    categoryBreakdown: asArray(pickField(record, "categoryBreakdown", "categories")).map(
      normalizeCategorySlice,
    ),
    dailyTotals: asArray(pickField(record, "dailyTotals", "daily")).map(normalizeDailyPoint),
    merchantTopN: asArray(pickField(record, "merchantTopN", "merchants", "topMerchants")).map(
      normalizeMerchantSlice,
    ),
  };
}

// ============================================================================
// 空狀態判定
// ============================================================================

/**
 * 是否「完全無任何可呈現資料」（本月零消費 **且** 無跨月歷史）。
 *
 * 審查 MEDIUM 修正：只有真的整體為空時才顯示整頁空狀態；若本月 total=0 但趨勢有非零歷史，
 * 仍要渲染趨勢圖與 StatTile（各子圖自帶 mini 空狀態）——零消費月最該看到的正是「趨勢下滑」與「較上月比」。
 *
 * @param analytics 分析模型。
 * @returns 是否完全為空。
 */
export function isCompletelyEmpty(analytics: ExpenseAnalytics): boolean {
  return (
    analytics.monthTotal === 0 &&
    analytics.monthCount === 0 &&
    analytics.monthlyTrend.every((point) => point.total === 0) &&
    analytics.categoryBreakdown.length === 0 &&
    analytics.dailyTotals.length === 0 &&
    analytics.merchantTopN.length === 0
  );
}

// ============================================================================
// 與上月比（delta）
// ============================================================================

/**
 * 漲跌方向。
 */
export type DeltaDirection = "up" | "down" | "flat";

/**
 * 與上月比的結果。
 */
export interface AnalyticsDelta {
  /** 金額差（本月 - 上月）。 */
  amount: number;
  /** 比例（上月>0 才有值；上月為 0 回 null，避免除以零）。 */
  ratio: number | null;
  /** 方向（供顏色＋箭頭雙載體）。 */
  direction: DeltaDirection;
}

/**
 * 計算與上月比（delta 的前端單一擁有者——需要「方向＋金額差」供三載體顯示）。
 * @param current 本月總額。
 * @param previous 上月總額。
 * @returns 金額差／比例／方向。
 */
export function computeDelta(current: number, previous: number): AnalyticsDelta {
  const amount = current - previous;
  const ratio = previous > 0 ? amount / previous : null;
  let direction: DeltaDirection;
  if (amount > 0) {
    direction = "up";
  } else if (amount < 0) {
    direction = "down";
  } else {
    direction = "flat";
  }
  return { amount, ratio, direction };
}

/**
 * 產生與上月比的敘述字串（含 flat／上月無資料分支；色盲友善：文字本身即載體）。
 * @param delta computeDelta 的結果。
 * @param formatMoney 金額格式化函式（由呼叫端注入，維持本檔零 import）。
 * @returns 例如「較上月增加 20%（+$1,234）」。
 */
export function formatDeltaText(
  delta: AnalyticsDelta,
  formatMoney: (amount: number) => string,
): string {
  if (delta.direction === "flat") {
    return delta.ratio === null ? "上月無資料" : "與上月持平";
  }
  const verb = delta.direction === "up" ? "增加" : "減少";
  const sign = delta.direction === "up" ? "+" : "-";
  const moneyPart = `${sign}${formatMoney(Math.abs(delta.amount))}`;
  if (delta.ratio === null) {
    return `較上月${verb}（${moneyPart}）`;
  }
  const percent = Math.round(Math.abs(delta.ratio) * 100);
  return `較上月${verb} ${percent}%（${moneyPart}）`;
}

// ============================================================================
// 分類折疊（>N 折成「其他」）
// ============================================================================

/** 折疊後「其他」彙總片的圖示。 */
export const OTHER_CATEGORY_ICON = "📦";

/**
 * 分類切片折疊：≤maxSlots 原樣；>maxSlots → 前 (maxSlots-1) ＋ 其餘聚合成「其他」。
 * 順序沿用輸入（後端已按 total 降冪）；「其他」片標記 isAggregate 供 UI 關閉其下鑽。
 * @param categories 分類切片（已降冪）。
 * @param maxSlots 顯示槽數上限（含「其他」；預設 8）。
 * @returns 折疊後的切片陣列（≤maxSlots）。
 */
export function foldCategories(
  categories: CategorySlice[],
  maxSlots: number = 8,
): CategorySlice[] {
  if (categories.length <= maxSlots) {
    return categories.slice();
  }
  const head = categories.slice(0, maxSlots - 1);
  const rest = categories.slice(maxSlots - 1);
  const other: CategorySlice = {
    categoryId: null,
    name: "其他",
    icon: OTHER_CATEGORY_ICON,
    total: rest.reduce((sum, slice) => sum + slice.total, 0),
    count: rest.reduce((sum, slice) => sum + slice.count, 0),
    isAggregate: true,
  };
  return [...head, other];
}

// ============================================================================
// 日曆熱圖：分位數分桶
// ============================================================================

/**
 * 計算某分位點（線性內插）。
 * @param sortedAscending 已升冪排序的值。
 * @param probability 分位（0..1）。
 * @returns 分位值（空陣列回 0）。
 */
function quantileAt(sortedAscending: number[], probability: number): number {
  if (sortedAscending.length === 0) {
    return 0;
  }
  if (sortedAscending.length === 1) {
    return sortedAscending[0];
  }
  const position = probability * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sortedAscending[lowerIndex];
  }
  const fraction = position - lowerIndex;
  return (
    sortedAscending[lowerIndex] +
    (sortedAscending[upperIndex] - sortedAscending[lowerIndex]) * fraction
  );
}

/**
 * 由「正值」樣本算出 (buckets-1) 個分位切點（供熱圖深淺分桶；分位數對離群值穩健）。
 * @param values 各日總額（含 0；本函式只取 >0 者參與分位）。
 * @param buckets 非零桶數（預設 5）。
 * @returns 升冪的切點陣列，長度 = buckets-1。
 */
export function quantileThresholds(values: number[], buckets: number = 5): number[] {
  const positives = values.filter((value) => value > 0).sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let level = 1; level < buckets; level++) {
    thresholds.push(quantileAt(positives, level / buckets));
  }
  return thresholds;
}

/**
 * 依切點決定某日總額落在哪一桶：0＝無消費；1..buckets＝由淺到深。
 * @param total 當日總額。
 * @param thresholds quantileThresholds 產生的升冪切點。
 * @returns 桶索引（0..thresholds.length+1）。
 */
export function bucketFor(total: number, thresholds: number[]): number {
  if (total <= 0) {
    return 0;
  }
  let bucket = 1;
  for (const threshold of thresholds) {
    if (total > threshold) {
      bucket++;
    }
  }
  return bucket;
}

// ============================================================================
// 日曆格建構（一律 UTC，與 stats/熱圖分桶一致）
// ============================================================================

/**
 * 日曆單格。padding 格 date 為 null。
 */
export interface DayCell {
  /** 日期 `YYYY-MM-DD`（UTC）；padding 格為 null。 */
  date: string | null;
  /** 當日總額（padding 格為 0）。 */
  total: number;
  /** 當日筆數（padding 格為 0）。 */
  count: number;
  /** 星期（0=週日…6=週六，UTC）。 */
  weekday: number;
  /** 是否屬當月（false＝前導/後綴 padding）。 */
  inMonth: boolean;
}

/**
 * 日曆網格（每列 7 格，週日起）。
 */
export interface CalendarGrid {
  /** 週列陣列，每列 7 格。 */
  weeks: DayCell[][];
}

/**
 * 兩位補零。
 * @param value 數字。
 * @returns 兩位字串。
 */
function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 由月份與每日資料建構日曆網格（**一律 UTC**）。
 *
 * 用 UTC 分日以確保「熱圖每日合計加總＝stat tile 月總額」（後端亦以 UTC 分桶）；
 * 不可用裝置時區重新分桶，否則會與月總額對不上。
 *
 * @param month 月份 `YYYY-MM`。
 * @param daily 每日總額（date 為 UTC 日字串）。
 * @returns 週列網格（前導/後綴補 padding 至完整週）。
 */
export function buildCalendarGrid(month: string, daily: DailyPoint[]): CalendarGrid {
  const parts = month.split("-");
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1; // 0-based
  const dailyMap = new Map<string, DailyPoint>();
  for (const point of daily) {
    dailyMap.set(point.date, point);
  }

  const cells: DayCell[] = [];
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();

  // 前導 padding（該月第 1 天之前的空格）。
  for (let index = 0; index < firstWeekday; index++) {
    cells.push({ date: null, total: 0, count: 0, weekday: index, inMonth: false });
  }

  // 當月各日（day 0 of 次月＝本月最後一天）。
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(Date.UTC(year, monthIndex, day));
    const dateString = `${year}-${padTwo(monthIndex + 1)}-${padTwo(day)}`;
    const point = dailyMap.get(dateString);
    cells.push({
      date: dateString,
      total: point?.total ?? 0,
      count: point?.count ?? 0,
      weekday: dayDate.getUTCDay(),
      inMonth: true,
    });
  }

  // 後綴 padding（補滿最後一週）。
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, total: 0, count: 0, weekday: cells.length % 7, inMonth: false });
  }

  const weeks: DayCell[][] = [];
  for (let start = 0; start < cells.length; start += 7) {
    weeks.push(cells.slice(start, start + 7));
  }
  return { weeks };
}

// ============================================================================
// 趨勢月份短標
// ============================================================================

/**
 * 月份短標：`"2026-07"` → `"7月"`（近 N 月窗內唯一，可辨）。
 * @param month 月份 `YYYY-MM`。
 * @returns 短標字串（無法解析回原字串）。
 */
export function formatMonthShort(month: string): string {
  const parts = month.split("-");
  if (parts.length < 2) {
    return month;
  }
  const monthNumber = Number(parts[1]);
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return month;
  }
  return `${monthNumber}月`;
}

// ============================================================================
// 下鑽區間（UTC；逼近後端半開區間 [start, nextStart)）
// ============================================================================

/**
 * UTC 下鑽區間（ISO 字串）。
 */
export interface UtcRange {
  /** 起（含）ISO。 */
  from: string;
  /** 迄（含）ISO——次月/次日月首前「最後一個可表示毫秒」，逼近後端半開右界。 */
  to: string;
}

/**
 * 某月下鑽區間：`from`＝月首 00:00:00.000Z、`to`＝月末 23:59:59.999Z（次月月首 -1ms）。
 *
 * 清單端點 `to` 為 `<=`（閉區間，見 ExpenseEndpoints.cs:127），故不可直接傳次月月首（會多收午夜那筆）；
 * 傳「次月月首 -1ms」逼近分析頁的半開右界，兩者僅存微秒級容差（個人記帳可接受，見報告取捨）。
 *
 * @param month 月份 `YYYY-MM`。
 * @returns UTC 區間。
 */
export function drilldownRangeForMonth(month: string): UtcRange {
  const parts = month.split("-");
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  const startMillis = Date.UTC(year, monthIndex, 1);
  const nextStartMillis = Date.UTC(year, monthIndex + 1, 1);
  return {
    from: new Date(startMillis).toISOString(),
    to: new Date(nextStartMillis - 1).toISOString(),
  };
}

/**
 * 某日下鑽區間：`from`＝當日 00:00:00.000Z、`to`＝當日 23:59:59.999Z（次日 -1ms）。
 * @param date 日期 `YYYY-MM-DD`（UTC）。
 * @returns UTC 區間。
 */
export function drilldownRangeForDay(date: string): UtcRange {
  const parts = date.split("-");
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const startMillis = Date.UTC(year, monthIndex, day);
  const nextStartMillis = Date.UTC(year, monthIndex, day + 1);
  return {
    from: new Date(startMillis).toISOString(),
    to: new Date(nextStartMillis - 1).toISOString(),
  };
}
