import { describe, expect, test } from 'vitest';
import { buildCategoryOptions, categoryPathOf, type CategoryLike } from './categoryOptions';

/**
 * 分類下拉選項共用工具的測試（測試計畫 包3 S1–S5）。
 * 背景：先前四處重複實作 categoryPath 且皆無防環；下拉順序吃後端全域
 * OrderBy(SortOrder)+collation，體感隨機——統一改為「完整路徑字串 codepoint 升冪」。
 */

/** 建立測試用分類（只填必要欄位）。 */
function cat(id: string, name: string, parentId: string | null = null): CategoryLike {
  return { id, name, parentId };
}

describe('categoryPathOf', () => {
  test('根分類：路徑＝自身名稱', () => {
    const cats = [cat('a', '工作')];
    expect(categoryPathOf('a', cats)).toBe('工作');
  });

  test('三層鏈：路徑＝「祖 / 父 / 子」', () => {
    const cats = [cat('a', '祖'), cat('b', '父', 'a'), cat('c', '子', 'b')];
    expect(categoryPathOf('c', cats)).toBe('祖 / 父 / 子');
  });

  test('parentId 指向不存在的分類：視為根（不拋錯）', () => {
    const cats = [cat('x', '孤兒', 'ghost')];
    expect(categoryPathOf('x', cats)).toBe('孤兒');
  });

  test('環（A→B→A）：不無限迴圈，環成員退化為自身名稱', () => {
    const cats: CategoryLike[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    expect(categoryPathOf('a', cats)).toBe('A');
    expect(categoryPathOf('b', cats)).toBe('B');
  });

  test('查無此 id：回空字串', () => {
    expect(categoryPathOf('nope', [cat('a', 'X')])).toBe('');
  });
});

describe('buildCategoryOptions', () => {
  test('S1：亂序輸入依完整路徑字串 codepoint 升冪排序', () => {
    const cats = [cat('c', '筆記'), cat('a', 'DB'), cat('b', '01-基礎')];
    const names = buildCategoryOptions(cats).map((o) => o.name);
    // codepoint 序：數字 < 大寫英文 < 中文
    expect(names).toEqual(['01-基礎', 'DB', '筆記']);
  });

  test('S2：子分類名稱帶「父 / 」前綴，且因前綴排序自然聚在父之後', () => {
    const cats = [cat('z', '乙'), cat('p', '甲'), cat('c1', '子項', 'p')];
    const names = buildCategoryOptions(cats).map((o) => o.name);
    expect(names).toEqual(['乙', '甲', '甲 / 子項']);
  });

  test('S3：三層鏈輸出完整路徑', () => {
    const cats = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b')];
    const names = buildCategoryOptions(cats).map((o) => o.name);
    expect(names).toEqual(['A', 'A / B', 'A / B / C']);
  });

  test('S4：孤兒 parentId 視為根、不拋錯', () => {
    const cats = [cat('x', '孤兒', 'ghost'), cat('a', 'A')];
    const names = buildCategoryOptions(cats).map((o) => o.name);
    expect(names).toEqual(['A', '孤兒']);
  });

  test('S5：環成員以自身名輸出、不無限迴圈', () => {
    const cats: CategoryLike[] = [
      { id: 'a', name: '環A', parentId: 'b' },
      { id: 'b', name: '環B', parentId: 'a' },
      { id: 'n', name: '正常' },
    ];
    const options = buildCategoryOptions(cats);
    expect(options.map((o) => o.name)).toEqual(['正常', '環A', '環B']);
  });

  test('保留 id 對應（選項 id＝分類 id）', () => {
    const cats = [cat('p', '父'), cat('c', '子', 'p')];
    const byName = new Map(buildCategoryOptions(cats).map((o) => [o.name, o.id]));
    expect(byName.get('父')).toBe('p');
    expect(byName.get('父 / 子')).toBe('c');
  });
});
