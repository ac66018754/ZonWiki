/**
 * API 領域模組 — 全域搜尋（Search）。
 */

import { fetchJson } from "./client";

/**
 * 搜尋結果 (統合)
 */
export interface SearchResult {
  /** 類型 (note|task|canvas|node|tag|category|capture|quicklink|overlay-text|overlay-sticky) */
  type:
    | "note"
    | "task"
    | "canvas"
    | "node"
    | "tag"
    | "category"
    | "capture"
    | "quicklink"
    | "overlay-text"
    | "overlay-sticky";
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
 * 搜尋筆記、任務、畫布、節點、標籤、分類、快速捕捉與筆記浮層（T 文字/便利貼），回傳統合結果。
 *
 * @param q 搜尋關鍵字
 * @param limit 結果數量限制 (預設 50)
 * @param types 選擇性：要搜尋的型別清單（後端合法值：note-title / note-content / task /
 *   node / canvas / tag / category / capture / overlay-text / overlay-sticky）。
 *   空/未帶＝搜尋全部型別。
 * @returns 搜尋結果清單
 */
export async function searchAll(
  q: string,
  limit: number = 50,
  types?: string[]
): Promise<SearchResult[]> {
  if (!q.trim()) return [];

  const params = new URLSearchParams();
  params.append("q", q);
  if (limit !== 50) params.append("limit", String(limit));
  if (types && types.length > 0) params.append("types", types.join(","));

  const r = await fetchJson<SearchResult[]>(
    `/api/search?${params.toString()}`
  );
  return r.data ?? [];
}
