import { describe, expect, test } from 'vitest';
import { dayKeyInTimeZone, groupEntriesByDay } from './historyGrouping';

/**
 * 歷史時間軸按天分組的測試（測試計畫 包1 G1/G3＋H4 修訂）。
 * 時區一律注入參數（不依賴測試機系統時區——CI/本機不同會抖，復審 M4）。
 */
describe('dayKeyInTimeZone', () => {
  test('G3：UTC 23:00 在 +08:00（Asia/Taipei）屬翌日', () => {
    expect(dayKeyInTimeZone('2026-08-12T23:00:00Z', 'Asia/Taipei')).toBe('2026-08-13');
    expect(dayKeyInTimeZone('2026-08-12T23:00:00Z', 'UTC')).toBe('2026-08-12');
  });

  test('無法解析的時間 → "unknown"（不拋錯）', () => {
    expect(dayKeyInTimeZone('not-a-date', 'Asia/Taipei')).toBe('unknown');
  });
});

describe('groupEntriesByDay', () => {
  test('G1：三天各兩筆（倒序輸入）→ 三組、各含兩筆、最新天在前', () => {
    const entries = [
      { at: '2026-08-13T10:00:00Z', id: 'a' },
      { at: '2026-08-13T01:00:00Z', id: 'b' },
      { at: '2026-08-12T09:00:00Z', id: 'c' },
      { at: '2026-08-12T08:00:00Z', id: 'd' },
      { at: '2026-08-11T09:00:00Z', id: 'e' },
      { at: '2026-08-11T08:00:00Z', id: 'f' },
    ];
    const groups = groupEntriesByDay(entries, 'Asia/Taipei');
    expect(groups.map((g) => g.day)).toEqual(['2026-08-13', '2026-08-12', '2026-08-11']);
    expect(groups.map((g) => g.entries.length)).toEqual([2, 2, 2]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('G3b：合併後 createdDateTime 在昨天、at（updatedDateTime）在今天 → 歸今天', () => {
    // 呼叫端以 updatedDateTime 當 at——本測試鎖住「分組吃 at 而非其它欄位」。
    const entries = [{ at: '2026-08-13T00:30:00+08:00', createdDateTime: '2026-08-12T23:55:00+08:00' }];
    const groups = groupEntriesByDay(entries, 'Asia/Taipei');
    expect(groups[0].day).toBe('2026-08-13');
  });

  test('G4：空清單 → 空分組', () => {
    expect(groupEntriesByDay([], 'Asia/Taipei')).toEqual([]);
  });
});
