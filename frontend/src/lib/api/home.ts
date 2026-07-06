/**
 * API 領域模組 — 首頁（Home）、常用連結（QuickLink）與快速捕捉（Capture）。
 */

import { fetchJson } from "./client";
import type { NoteSummary } from "./notes";
import type { TaskCard } from "./tasks";

// ============================================================================
// 資料型別 — 常用連結、捕捉、首頁聚合
// ============================================================================

/**
 * 常用連結卡
 */
export interface QuickLink {
  /** 連結 ID */
  id: string;
  /** 標題 */
  title: string;
  /** URL */
  url: string;
  /** 圖示鍵 (可選) */
  iconKey?: string;
  /** 分類 (自由文字；常用連結自有、非與筆記共用；可空＝未分類) */
  category?: string | null;
  /** 標籤 (與筆記/任務共用標籤庫) */
  tags?: { id: string; name: string }[];
}

/**
 * 快速捕捉項目 (Inbox)
 */
export interface CaptureItem {
  /** 捕捉 ID */
  id: string;
  /** 來源 (web|voice|text) */
  source: "web" | "voice" | "text";
  /** 原始內容 (文字或轉錄) */
  rawContent: string;
  /** 錄音檔案路徑 (若為語音) */
  audioPath?: string | null;
  /** 狀態 (inbox|filed) */
  status: "inbox" | "filed";
  /** 歸檔目標類型 (note|taskcard，未歸檔時為空) */
  filedTargetType?: string | null;
  /** 歸檔目標 ID (未歸檔時為空) */
  filedTargetId?: string | null;
  /** 建立時間 (UTC) */
  createdDateTime: string;
}

/**
 * 當週簡化日曆資料（首頁用）
 */
export interface WeeklyCalendarSummary {
  /** 該週開始日期 (UTC) */
  startDate: string;
  /** 該週結束日期 (UTC) */
  endDate: string;
  /** 該週的任務卡片清單 */
  tasks: TaskCard[];
  /** 該週的日記清單 */
  journalNotes: NoteSummary[];
}

/**
 * 首頁聚合資料（一次回傳首頁所需的所有資料）
 */
export interface HomePageAggregate {
  /** 當週日曆精簡資料 */
  weeklyCalendar: WeeklyCalendarSummary;
  /** 今日待辦清單（狀態 = todo / doing） */
  todayTodos: TaskCard[];
  /** 釘選到首頁「我的任務」區塊的任務（依 homeSortOrder 排序） */
  pinnedTasks?: TaskCard[];
  /** 常用連結卡清單 */
  quickLinks: QuickLink[];
  /** 最近 5 個捕捉項目 */
  recentCaptures: CaptureItem[];
}

// ============================================================================
// API 方法 — Quick Link & Capture
// ============================================================================

/**
 * 列出常用連結
 */
export async function listQuickLinks(): Promise<QuickLink[]> {
  const r = await fetchJson<QuickLink[]>("/api/quick-links");
  return r.data ?? [];
}

/**
 * 建立常用連結
 */
export async function createQuickLink(payload: {
  title: string;
  url: string;
  iconKey?: string;
  category?: string;
}): Promise<QuickLink | null> {
  const r = await fetchJson<QuickLink>("/api/quick-links", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新常用連結（欄位皆選擇性；category 傳空字串＝清為未分類，傳 null/不傳＝不更新）
 */
export async function updateQuickLink(
  id: string,
  payload: { title?: string; url?: string; iconKey?: string; category?: string }
): Promise<QuickLink | null> {
  const r = await fetchJson<QuickLink>(`/api/quick-links/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 設定常用連結的標籤（整批取代；與筆記/任務共用標籤庫）
 */
export async function assignQuickLinkTags(id: string, tagIds: string[]): Promise<boolean> {
  const r = await fetchJson(`/api/quick-links/${encodeURIComponent(id)}/tags`, {
    method: "PUT",
    body: JSON.stringify(tagIds),
  });
  return r.success;
}

/**
 * 刪除常用連結
 */
export async function deleteQuickLink(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/quick-links/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 列出快速捕捉 (Inbox)
 */
export async function listCaptures(): Promise<CaptureItem[]> {
  const r = await fetchJson<CaptureItem[]>("/api/captures");
  return r.data ?? [];
}

/**
 * 新增快速捕捉
 */
export async function createCapture(payload: {
  source: "web" | "voice" | "text";
  rawContent: string;
  audioPath?: string;
}): Promise<CaptureItem | null> {
  const r = await fetchJson<CaptureItem>("/api/captures", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除快速捕捉（軟刪除，會進垃圾桶）
 */
export async function deleteCapture(id: string): Promise<boolean> {
  await fetchJson(`/api/captures/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true; // 204 無 body：未丟例外即視為成功
}

/**
 * 捕捉衍生出的筆記 / 任務
 */
export interface CaptureLink {
  /** 關聯 ID */
  id: string;
  /** 目標型別 (note|taskcard) */
  targetType: "note" | "taskcard";
  /** 目標 ID */
  targetId: string;
  /** 目標標題 */
  title: string;
  /** 筆記 slug（任務為 null） */
  slug?: string | null;
  /** 目標是否已被刪除 */
  isDeleted: boolean;
}

/**
 * 列出某捕捉衍生的筆記 / 任務
 */
export async function listCaptureLinks(captureId: string): Promise<CaptureLink[]> {
  const r = await fetchJson<CaptureLink[]>(
    `/api/captures/${encodeURIComponent(captureId)}/links`
  );
  return r.data ?? [];
}

/**
 * 為捕捉新增一筆衍生關聯（筆記/任務先以既有端點建立後回填）
 */
export async function addCaptureLink(
  captureId: string,
  targetType: "note" | "taskcard",
  targetId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/captures/${encodeURIComponent(captureId)}/links`,
    { method: "POST", body: JSON.stringify({ targetType, targetId }) }
  );
  return r.success;
}

// ============================================================================
// API 方法 — Home (首頁)
// ============================================================================

/**
 * 取得首頁聚合資料（當週日曆 + 今日待辦 + 常用連結 + 最近捕捉）
 */
export async function getHomePage(): Promise<HomePageAggregate | null> {
  const r = await fetchJson<HomePageAggregate>("/api/home");
  return r.data ?? null;
}
