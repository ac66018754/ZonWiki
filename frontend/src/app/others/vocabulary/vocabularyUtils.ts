/**
 * 單字庫頁共用純函式（狀態標籤、到期相對時間、四鍵間隔預覽）。
 *
 * 刻意抽成無副作用純函式，便於閱讀、推演與日後補單元測試。
 */

import type { ReviewRating, VocabularyWord } from "@/lib/api";

/** 清單每頁筆數（同記帳頁慣例）。 */
export const PAGE_SIZE = 20;

/** 搜尋輸入 debounce 毫秒數（避免每鍵重抓）。 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * 狀態篩選下拉選項。
 * ⚠️對齊：value 需與後端 `?state=` 篩選 / 序列化一致（"new"/"learning"/"review"/"relearning"）。
 */
export const VOCAB_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "new", label: "新字" },
  { value: "learning", label: "學習中" },
  { value: "review", label: "複習中" },
  { value: "relearning", label: "重新學習" },
];

/**
 * 狀態字串 → 中文標籤（大小寫不敏感；未知值優雅降級回原字串）。
 * @param state 後端回傳的狀態字串。
 * @returns 中文標籤。
 */
export function stateLabel(state: string): string {
  const normalized = (state ?? "").toLowerCase();
  const found = VOCAB_STATE_OPTIONS.find(
    (option) => option.value !== "" && option.value === normalized,
  );
  return found ? found.label : state || "—";
}

/**
 * 狀態徽章的語意色 token（四主題安全；顏色非唯一載體，另有文字標籤）。
 * 未知狀態退次要文字色。
 * @param state 狀態字串。
 * @returns 前景 / 背景 CSS 變數。
 */
export function stateBadgeColors(state: string): { fg: string; bg: string } {
  switch ((state ?? "").toLowerCase()) {
    case "new":
      return { fg: "var(--action-secondary-fg)", bg: "var(--action-secondary-bg)" };
    case "learning":
      return { fg: "var(--status-warning-fg)", bg: "var(--status-warning-bg)" };
    case "review":
      return { fg: "var(--status-success-fg)", bg: "var(--status-success-bg)" };
    case "relearning":
      return { fg: "var(--status-danger-fg)", bg: "var(--status-danger-bg)" };
    default:
      return { fg: "var(--text-secondary)", bg: "var(--bg-surface-secondary)" };
  }
}

/**
 * 由「間隔天數」渲染人話（SM-2 起步為整數天；容忍 <1 天的分鐘/小時級間隔）。
 * @param days 間隔天數。
 * @returns 例如「1 天後」「3 小時後」。
 */
function formatIntervalDays(days: number): string {
  if (days >= 1) {
    return `${Math.round(days)} 天後`;
  }
  const hours = days * 24;
  if (hours >= 1) {
    return `${Math.round(hours)} 小時後`;
  }
  const minutes = Math.max(1, Math.round(days * 24 * 60));
  return `${minutes} 分鐘後`;
}

/**
 * 由「下次到期 UTC」渲染相對時間（不需時區——純時間差；到期日界以本地 now 為基準）。
 * @param dueIso 下次到期（UTC ISO）。
 * @returns 例如「已到期」「2 天後」「5 小時後」；無法解析回空字串。
 */
export function formatDueRelative(dueIso: string): string {
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) return "";
  const diffMs = due - Date.now();
  if (diffMs <= 0) return "已到期";
  return formatIntervalDays(diffMs / 86_400_000);
}

/**
 * 四鍵評分的定性間隔詞（降級用）。
 *
 * 僅在後端未提供權威 schedulePreview 時使用；刻意用定性詞而非寫死天數，
 * 避免顯示與後端 SM-2 實際排程牴觸的錯誤天數（審查 HIGH #(c)：Again 實為 1 天而非「<10 分」、
 * 早期 Good/Hard 為固定 1/6 階梯而非 ×2.5/×1.2）。方向與後端一致：Again 最短、Easy 最長。
 */
const QUALITATIVE_PREVIEW: Record<ReviewRating, string> = {
  again: "重來",
  hard: "較短",
  good: "正常",
  easy: "較長",
};

/**
 * 四鍵按鈕上的「下次間隔預覽」。
 *
 * 排程一律後端計算（DB-as-truth，設計 §3.1）：
 *  - 首選（權威）：卡片攜帶的 `schedulePreview[rating]`（後端於 /due 卡附上，與實際 Review 走同一段
 *    間隔計算）→ 直接渲染確切間隔（intervalDays 優先，否則由 due 推算）。
 *  - 降級：`schedulePreview` 缺省時退定性詞（QUALITATIVE_PREVIEW），不顯示可能錯誤的天數。
 * 容忍後端把每鍵預覽序列化為物件 `{intervalDays,due}` 或裸 ISO 字串兩種形狀。
 * @param card 單字卡。
 * @param rating 評分鍵。
 * @returns 顯示字串。
 */
export function formatSchedulePreview(card: VocabularyWord, rating: ReviewRating): string {
  const raw = card.schedulePreview?.[rating] as unknown;
  if (typeof raw === "string" && raw) {
    // 後端把每鍵預覽序列化為裸 due ISO 字串。
    const relative = formatDueRelative(raw);
    if (relative) return relative === "已到期" ? "馬上" : relative;
  } else if (raw && typeof raw === "object") {
    const entry = raw as { intervalDays?: number | null; due?: string | null };
    if (typeof entry.intervalDays === "number" && Number.isFinite(entry.intervalDays)) {
      return formatIntervalDays(entry.intervalDays);
    }
    if (entry.due) {
      const relative = formatDueRelative(entry.due);
      if (relative) return relative === "已到期" ? "馬上" : relative;
    }
  }
  // 降級：定性詞（不欺騙使用者以錯誤天數）。
  return QUALITATIVE_PREVIEW[rating];
}

/**
 * 四鍵評分的顯示中繼資料（送出值、中英標籤、語意色 token）。
 * 色非唯一載體：每鍵均有中英文字標籤（色盲友善）。
 */
export interface RatingMeta {
  /** 送出值。 */
  rating: ReviewRating;
  /** 中文標籤。 */
  labelZh: string;
  /** 英文標籤。 */
  labelEn: string;
  /** 前景色 token。 */
  fg: string;
  /** 背景色 token。 */
  bg: string;
}

/**
 * 四鍵評分中繼資料（依 Again→Hard→Good→Easy 排序）。
 */
export const RATING_META: RatingMeta[] = [
  { rating: "again", labelZh: "重來", labelEn: "Again", fg: "var(--status-danger-fg)", bg: "var(--status-danger-bg)" },
  { rating: "hard", labelZh: "困難", labelEn: "Hard", fg: "var(--status-warning-fg)", bg: "var(--status-warning-bg)" },
  { rating: "good", labelZh: "良好", labelEn: "Good", fg: "var(--action-secondary-fg)", bg: "var(--action-secondary-bg)" },
  { rating: "easy", labelZh: "簡單", labelEn: "Easy", fg: "var(--status-success-fg)", bg: "var(--status-success-bg)" },
];
