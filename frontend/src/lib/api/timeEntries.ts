import { fetchJson } from "./client";

// ============================================================================
// 型別 — 時間追蹤（Time Tracking）
// ============================================================================

/**
 * 時間追蹤項目（後端 TimeEntryDto 的鏡像）。
 * 時間欄位皆為 UTC ISO 字串；endedDateTime 為 null = 計時中。
 */
export interface TimeEntry {
  id: string;
  title: string;
  category: string | null;
  /** 備註（無備註為 null）。 */
  note: string | null;
  startedDateTime: string;
  endedDateTime: string | null;
  /** 時長（秒）＝結束－開始；計時中為 null（由後端即時計算）。 */
  durationSeconds: number | null;
}

// ============================================================================
// API 方法 — 時間追蹤
// ============================================================================

/**
 * 列出「開始時間」落在 [from, to) 區間內的項目（含已結束與進行中），依開始時間逆序。
 * @param fromIso 區間起（UTC ISO，含）。
 * @param toIso 區間迄（UTC ISO，不含）。
 */
export async function listTimeEntries(fromIso: string, toIso: string): Promise<TimeEntry[]> {
  const r = await fetchJson<TimeEntry[]>(
    `/api/time-entries?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
  );
  return r.data ?? [];
}

/**
 * 列出所有「進行中」的項目（依開始時間逆序）。
 */
export async function listRunningTimeEntries(): Promise<TimeEntry[]> {
  const r = await fetchJson<TimeEntry[]>("/api/time-entries/running");
  return r.data ?? [];
}

/**
 * 列出本人用過的所有分類（distinct、非空；供輸入框 autocomplete）。
 */
export async function listTimeEntryCategories(): Promise<string[]> {
  const r = await fetchJson<string[]>("/api/time-entries/categories");
  return r.data ?? [];
}

/**
 * 建立新項目（＝開始計時）。startedDateTime 不傳＝伺服器當下。
 */
export async function startTimeEntry(payload: {
  title: string;
  category?: string;
  note?: string;
  startedDateTime?: string;
}): Promise<TimeEntry | null> {
  const r = await fetchJson<TimeEntry>("/api/time-entries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 結束指定項目的計時。endedDateTime 不傳＝伺服器當下。
 */
export async function stopTimeEntry(id: string, endedDateTime?: string): Promise<TimeEntry | null> {
  const r = await fetchJson<TimeEntry>(
    `/api/time-entries/${encodeURIComponent(id)}/stop`,
    {
      method: "POST",
      body: JSON.stringify(endedDateTime ? { endedDateTime } : {}),
    }
  );
  return r.data ?? null;
}

/**
 * 編輯項目（欄位皆選擇性；category 傳空字串＝清為未分類，不傳＝不更新）。
 */
export async function updateTimeEntry(
  id: string,
  payload: {
    title?: string;
    category?: string;
    note?: string;
    startedDateTime?: string;
    endedDateTime?: string;
  }
): Promise<TimeEntry | null> {
  const r = await fetchJson<TimeEntry>(`/api/time-entries/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除項目（軟刪除；可於統一垃圾桶還原）。
 */
export async function deleteTimeEntry(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/time-entries/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

// ============================================================================
// 型別 — 今日／本週彙總（後端 TimeEntrySummaryDto 的鏡像；/time 儀表板頁使用）
// ============================================================================

/** 彙總範圍：day＝今日、week＝本週（歸日／週依「帳號時區」由後端計算）。 */
export type TimeEntrySummaryScope = "day" | "week";

/**
 * 彙總中的單一項目。
 * seconds 為後端「查詢當下」的快照；進行中項目的即時跳動由前端以取得時間差補算。
 */
export interface TimeEntrySummaryItem {
  id: string;
  title: string;
  /** 分類（未分類為 null）。 */
  category: string | null;
  /** 此項目時長（秒；進行中＝查詢當下已經過時間）。 */
  seconds: number;
  /** 是否進行中。 */
  running: boolean;
}

/** 依分類的時長彙總（未分類由後端以「未分類」標籤呈現）。 */
export interface TimeEntrySummaryCategory {
  category: string;
  seconds: number;
  /** 該分類進行中的項目數。 */
  runningCount: number;
}

/** 今日／本週彙總（總時長、進行中數、項目明細、依分類小計）。 */
export interface TimeEntrySummary {
  scope: string;
  /** 區間起（UTC ISO，含）。 */
  from: string;
  /** 區間迄（UTC ISO，不含）。 */
  to: string;
  totalSeconds: number;
  runningCount: number;
  items: TimeEntrySummaryItem[];
  byCategory: TimeEntrySummaryCategory[];
}

/**
 * 取得今日／本週彙總（進行中項目以查詢當下已經過時間即時併入）。
 */
export async function getTimeEntrySummary(
  scope: TimeEntrySummaryScope
): Promise<TimeEntrySummary | null> {
  const r = await fetchJson<TimeEntrySummary>(
    `/api/time-entries/summary?scope=${scope}`
  );
  return r.data ?? null;
}
