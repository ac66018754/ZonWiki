/**
 * 任務「重複規則」的 iCal RRULE 組裝與解析（#17）。
 *
 * 前端只提供常見選項（不重複／每天／每週選星期／每月選日／自訂 RRULE），
 * 對應到標準 RRULE 字串存進 TaskCard.recurrenceRule；後端背景服務再依此把到期發生
 * 具現化成一張張可打勾的實體任務卡。與後端 RecurrenceRuleExpander 支援的子集一致。
 */

/** 重複模式。 */
export type RecurrenceMode = "none" | "daily" | "weekly" | "monthly" | "custom";

/** 星期代碼（RRULE BYDAY 用），週日至週六。 */
export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** 星期代碼→繁中短標籤（顯示用；週一為首以符合本系統行事曆習慣）。 */
export const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "一",
  TU: "二",
  WE: "三",
  TH: "四",
  FR: "五",
  SA: "六",
  SU: "日",
};

/** 星期選擇器的顯示順序（週一起）。 */
export const WEEKDAY_ORDER: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** 前端重複規則的結構化狀態。 */
export interface RecurrenceState {
  /** 重複模式。 */
  mode: RecurrenceMode;
  /** 每週模式選中的星期（BYDAY）。 */
  weekdays: WeekdayCode[];
  /** 每月模式選中的日（1-31，BYMONTHDAY）。 */
  monthDay: number;
  /** 自訂模式的原始 RRULE 字串。 */
  custom: string;
}

/** 預設空狀態（不重複）。 */
export function emptyRecurrence(): RecurrenceState {
  return { mode: "none", weekdays: [], monthDay: 1, custom: "" };
}

/**
 * 把結構化狀態組成 RRULE 字串；不重複或不完整（每週未選星期）時回傳 null。
 * @param state 結構化重複狀態。
 * @returns RRULE 字串或 null。
 */
export function buildRrule(state: RecurrenceState): string | null {
  switch (state.mode) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly": {
      if (state.weekdays.length === 0) return null; // 未選星期＝視同不重複。
      // 依標準順序輸出（SU..SA），與後端解析無關但利於可讀與去重。
      const ordered = WEEKDAY_CODES.filter((c) => state.weekdays.includes(c));
      return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
    }
    case "monthly": {
      const day = clampMonthDay(state.monthDay);
      return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
    }
    case "custom": {
      const trimmed = state.custom.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    case "none":
    default:
      return null;
  }
}

/**
 * 把既有 RRULE 字串解析回結構化狀態（供編輯器載入時還原 UI）。
 * 無法對應到「每天／每週／每月」的規則一律歸為「自訂」，原字串保留於 custom。
 * @param rule 既有 RRULE（可為 null）。
 * @returns 結構化重複狀態。
 */
export function parseRrule(rule: string | null | undefined): RecurrenceState {
  const base = emptyRecurrence();
  if (!rule || rule.trim().length === 0) return base;

  const body = rule.trim().replace(/^RRULE:/i, "");
  const parts = new Map<string, string>();
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v !== undefined) parts.set(k.trim().toUpperCase(), v.trim());
  }

  const freq = parts.get("FREQ");
  const hasInterval = parts.has("INTERVAL") && parts.get("INTERVAL") !== "1";
  const hasCountOrUntil = parts.has("COUNT") || parts.has("UNTIL");

  // 每天：FREQ=DAILY 且無其它進階關鍵字。
  if (freq === "DAILY" && !hasInterval && !hasCountOrUntil && parts.size === 1) {
    return { ...base, mode: "daily" };
  }

  // 每週：FREQ=WEEKLY + BYDAY（僅星期，無 interval/count/until）。
  if (freq === "WEEKLY" && parts.has("BYDAY") && !hasInterval && !hasCountOrUntil && parts.size === 2) {
    const weekdays = (parts.get("BYDAY") ?? "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((c): c is WeekdayCode => (WEEKDAY_CODES as readonly string[]).includes(c));
    if (weekdays.length > 0) {
      return { ...base, mode: "weekly", weekdays };
    }
  }

  // 每月：FREQ=MONTHLY + 單一 BYMONTHDAY（無 interval/count/until）。
  if (freq === "MONTHLY" && parts.has("BYMONTHDAY") && !hasInterval && !hasCountOrUntil && parts.size === 2) {
    const days = (parts.get("BYMONTHDAY") ?? "")
      .split(",")
      .map((t) => parseInt(t.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);
    if (days.length === 1) {
      return { ...base, mode: "monthly", monthDay: days[0] };
    }
  }

  // 其它一律視為自訂（保留原字串）。
  return { ...base, mode: "custom", custom: body };
}

/** 把日限制在 1-31。 */
export function clampMonthDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(31, Math.max(1, Math.round(day)));
}

/**
 * 給人看的重複規則摘要（供卡片/清單顯示；不是精確還原，只求可讀）。
 * @param rule RRULE 字串（可為 null）。
 * @returns 繁中摘要，或 null（不重複）。
 */
export function describeRecurrence(rule: string | null | undefined): string | null {
  const state = parseRrule(rule);
  switch (state.mode) {
    case "daily":
      return "每天";
    case "weekly":
      return `每週 ${state.weekdays
        .slice()
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))
        .map((c) => WEEKDAY_LABELS[c])
        .join("、")}`;
    case "monthly":
      return `每月 ${state.monthDay} 日`;
    case "custom":
      return "自訂重複";
    case "none":
    default:
      return null;
  }
}
