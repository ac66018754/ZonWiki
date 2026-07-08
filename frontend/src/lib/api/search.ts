/**
 * API 領域模組 — 全域搜尋（Search）。
 */

import { fetchJson } from "./client";

/**
 * 搜尋結果 (統合)
 */
export interface SearchResult {
  /** 類型 (note|task|canvas|node|tag|category|capture|quicklink) */
  type:
    | "note"
    | "task"
    | "canvas"
    | "node"
    | "tag"
    | "category"
    | "capture"
    | "quicklink";
  /** 結果 ID */
  id: string;
  /** 標題 */
  title: string;
  /** 摘要 (可選) */
  snippet?: string;
  /** 關聯 URL */
  url: string;
}

/**
 * 全域搜尋
 */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const r = await fetchJson<SearchResult[]>(
    `/api/search?q=${encodeURIComponent(query)}`
  );
  return r.data ?? [];
}

/**
 * 執行全站搜尋
 * 搜尋筆記、任務、畫布、節點，回傳統合結果
 *
 * @param q 搜尋關鍵字
 * @param limit 結果數量限制 (預設 50)
 * @returns 搜尋結果清單
 */
export async function searchAll(
  q: string,
  limit: number = 50
): Promise<SearchResult[]> {
  if (!q.trim()) return [];

  const params = new URLSearchParams();
  params.append("q", q);
  if (limit !== 50) params.append("limit", String(limit));

  const r = await fetchJson<SearchResult[]>(
    `/api/search?${params.toString()}`
  );
  return r.data ?? [];
}
