/**
 * 拖曳筆記到分類的「切換分類」集合運算（2026-08-13 使用者裁示：拖曳要跳
 * 「切換 / 增加」提示）。
 *
 * 分工（對抗復審 M2）：
 * - 「增加」不經本模組——沿用既有的 `addNoteToCategory`（冪等原子單加端點，
 *   無讀-改-寫競態）；
 * - 「切換」才需要整組取代：由本函式算出新集合，交給
 *   `PUT /api/notes/{id}/categories`（整組取代端點）。
 */

/**
 * 計算「切換分類」後的分類 id 集合。
 *
 * @param currentIds 筆記目前的分類 id（建議 drop 當下重抓詳情取得，勿用過期快取）。
 * @param sourceCategoryId 拖曳來源分類 id；null＝來源不明（筆記清單頁卡片拖入）
 *        → 語意為「取代全部分類」。
 * @param targetCategoryId 拖曳目標分類 id。
 * @returns 新的分類 id 集合（去重、目標必在其中；有來源時僅移出來源、保留其餘）。
 */
export function computeSwitchCategoryIds(
  currentIds: readonly string[],
  sourceCategoryId: string | null,
  targetCategoryId: string,
): string[] {
  if (!sourceCategoryId) {
    // 來源不明：切換＝取代全部分類（提示文案已明示此語意）。
    return [targetCategoryId];
  }

  const result: string[] = [];
  for (const id of currentIds) {
    if (id === sourceCategoryId || id === targetCategoryId) continue; // 目標最後統一加，避免重複
    if (!result.includes(id)) result.push(id);
  }
  result.push(targetCategoryId);
  return result;
}
