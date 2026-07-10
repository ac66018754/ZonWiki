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
  /** （僅筆記）所屬分類的完整路徑清單，如「學習 / 併發」；無分類為空陣列、非筆記為 undefined。 */
  categories?: string[];
  /** （僅筆記）標籤名稱清單；無標籤為空陣列、非筆記為 undefined。 */
  tags?: string[];
  /** 結果實體的更新時間（UTC ISO；供依更新時間排序）。 */
  updatedAt?: string;
  /** （僅浮層）所屬筆記的標題，用來標示「這段文字在哪篇筆記裡」。 */
  parentTitle?: string;
}

/**
 * 進階搜尋參數（供獨立搜尋頁 /search 使用）。
 * 這些參數皆對應後端 /api/search 的查詢字串；categoryId／tags 出現時後端只回「筆記」型別。
 */
export interface AdvancedSearchParams {
  /** 搜尋關鍵字（可空——搭配 categoryId／tags 即為「瀏覽模式」，回該範圍全部筆記）。 */
  q?: string;
  /** 型別篩選（後端合法值 CSV 之一：note-title / note-content / task / node / canvas / tag / category / capture / overlay-text / overlay-sticky）。 */
  types?: string[];
  /** 分類篩選（含所有子孫分類；只回筆記）。 */
  categoryId?: string;
  /** 標籤篩選（任一標籤命中即算；只回筆記）。 */
  tagIds?: string[];
  /** 排序：relevance（預設）｜updated（依更新時間新→舊）。 */
  sort?: "relevance" | "updated";
  /** 結果數量上限（後端夾在 1–500）。 */
  limit?: number;
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

/**
 * 進階搜尋：支援關鍵字、型別、分類（含子孫）、標籤、排序與數量上限。
 * 供獨立搜尋頁 /search 使用；空關鍵字＋分類/標籤＝瀏覽該範圍全部筆記（依更新時間排序）。
 *
 * @param params 進階搜尋參數。
 * @returns 搜尋結果清單。
 */
export async function searchAdvanced(
  params: AdvancedSearchParams
): Promise<SearchResult[]> {
  const { q, types, categoryId, tagIds, sort, limit } = params;
  const hasQuery = !!q && q.trim().length > 0;
  const hasScope = !!categoryId || (tagIds != null && tagIds.length > 0);
  // 無關鍵字且無範圍篩選＝後端會回空；此處直接短路避免多餘請求。
  if (!hasQuery && !hasScope) return [];

  const search = new URLSearchParams();
  if (hasQuery) search.append("q", q!.trim());
  if (types && types.length > 0) search.append("types", types.join(","));
  if (categoryId) search.append("categoryId", categoryId);
  if (tagIds && tagIds.length > 0) search.append("tags", tagIds.join(","));
  if (sort) search.append("sort", sort);
  if (limit != null) search.append("limit", String(limit));

  const r = await fetchJson<SearchResult[]>(`/api/search?${search.toString()}`);
  return r.data ?? [];
}
