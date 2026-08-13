/**
 * 分類下拉選項的共用工具（2026-08-13 使用者裁示「下拉按字串由小到大排」）。
 *
 * 背景：先前四處（筆記編輯頁 / edit-popout / 新增筆記彈窗 / 批次工具列）各自重複實作
 * `categoryPath` 遞迴組路徑、皆無防環，且選項順序直接吃後端全域
 * `OrderBy(SortOrder).ThenBy(Name)`——SortOrder 每層各自 0,1,2… 跨層撞號＋大多為 0，
 * 攤到扁平下拉的體感接近隨機。本模組統一：
 * - 路徑組字（含防環）：`categoryPathOf`；
 * - 下拉選項（完整路徑＋codepoint 升冪排序）：`buildCategoryOptions`。
 *
 * 排序刻意用「codepoint 字串比較」而非 localeCompare 注音/筆畫序（使用者明示
 * 「按照字串大小由小到大排」；決策記錄見 docs/DECISIONS.md 2026-08-13）。
 * 附帶效果：子分類的路徑帶「父 / 」前綴，字串排序天然把子分類聚在父分類之後。
 *
 * 側欄分類樹與搜尋頁「不」使用本模組：側欄是使用者手動排序（SortOrder）的樹狀 UI，
 * 套字串排序會破壞手動排序功能。
 */

/** 組路徑所需的最小分類形狀（與 NoteCategory 相容）。 */
export interface CategoryLike {
  /** 分類 id。 */
  id: string;
  /** 父分類 id（null/undefined＝根分類）。 */
  parentId?: string | null;
  /** 分類名稱。 */
  name: string;
}

/** 下拉選項（與 SearchableMultiSelect 的 MultiSelectOption 相容）。 */
export interface CategoryOption {
  /** 分類 id。 */
  id: string;
  /** 顯示名稱＝完整階層路徑（「祖 / 父 / 子」）。 */
  name: string;
}

/**
 * 取得某分類的完整階層路徑（含自身名稱），例如「工作 / 專案A / 會議」。
 *
 * 防環：沿 parentId 上溯時若回到已走訪的節點（資料異常成環），
 * 退化為只回自身名稱——絕不無限遞迴（先前四處私有實作皆無此防護）。
 *
 * @param id 目標分類 id。
 * @param categories 全部分類（用於反查父鏈）。
 * @returns 完整路徑；查無此 id 時回空字串。
 */
export function categoryPathOf(id: string, categories: readonly CategoryLike[]): string {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const target = byId.get(id);
  if (!target) return '';

  const names: string[] = [];
  const visited = new Set<string>();
  let current: CategoryLike | undefined = target;
  while (current) {
    if (visited.has(current.id)) {
      // 環（A→B→A…）：資料異常，退化為自身名稱。
      return target.name;
    }
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    // parentId 指向不存在的分類＝視為根（names 已含到此為止的鏈）。
  }
  return names.join(' / ');
}

/**
 * 建立分類下拉的選項清單：顯示名稱＝完整路徑，依路徑字串 codepoint 升冪排序。
 *
 * @param categories 全部分類。
 * @returns 排序後的選項清單（id 對應原分類 id）。
 */
export function buildCategoryOptions(categories: readonly CategoryLike[]): CategoryOption[] {
  return categories
    .map((category) => ({ id: category.id, name: categoryPathOf(category.id, categories) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
