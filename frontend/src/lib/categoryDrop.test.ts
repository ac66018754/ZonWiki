import { describe, expect, test } from 'vitest';
import { computeSwitchCategoryIds } from './categoryDrop';

/**
 * 拖曳筆記到分類的「切換」集合運算測試（測試計畫 包4 D1）。
 * 「增加」不經此函式（沿用冪等原子的 addNoteToCategory 端點——復審 M2）。
 */
describe('computeSwitchCategoryIds', () => {
  test('有來源：移出來源、加入目標，保留其餘', () => {
    expect(computeSwitchCategoryIds(['a', 'b', 'c'], 'b', 't')).toEqual(['a', 'c', 't']);
  });

  test('目標已存在：不重複加入', () => {
    expect(computeSwitchCategoryIds(['a', 't'], 'a', 't')).toEqual(['t']);
  });

  test('無來源（清單頁卡片拖入）：取代全部分類', () => {
    expect(computeSwitchCategoryIds(['a', 'b'], null, 't')).toEqual(['t']);
  });

  test('來源不在現有集合（資料過期）：仍加入目標、不拋錯', () => {
    expect(computeSwitchCategoryIds(['a'], 'ghost', 't')).toEqual(['a', 't']);
  });

  test('current 含重複 id（防禦）：輸出去重', () => {
    expect(computeSwitchCategoryIds(['a', 'a', 'b'], 'b', 't')).toEqual(['a', 't']);
  });
});
