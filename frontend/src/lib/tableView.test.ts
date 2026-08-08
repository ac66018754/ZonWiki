// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import {
  TABLE_VIEW_STORAGE_KEY,
  buildHeaderSignature,
  clearTableView,
  compareCellValues,
  readTableView,
  rowPassesFilters,
  writeTableView,
  type TableViewState,
} from './tableView';

/**
 * 表格檢視（排序／篩選／狀態持久化）的單元測試。
 *
 * 對應設計文件 §3.2（排序比較器）、§3.3（篩選 AND）、§3.5（localStorage 狀態）
 * 與 v2 修訂第 14 條（檢視狀態鍵照欄寬先例：`${noteId}:${tableIndex}`＋表頭簽章雙保險）。
 */

describe('compareCellValues：數字感知 → MM/DD 日期 → zh-Hant locale', () => {
  test('前導數字比大小：「3.4km」<「11km」（字串比較會顛倒，鎖數值語意）', () => {
    expect(compareCellValues('3.4km', '11km')).toBeLessThan(0);
    expect(compareCellValues('11km', '3.4km')).toBeGreaterThan(0);
  });

  test('前導數字：「45k」<「120k」', () => {
    expect(compareCellValues('45k', '120k')).toBeLessThan(0);
  });

  test('純數字：「9」<「10」', () => {
    expect(compareCellValues('9', '10')).toBeLessThan(0);
  });

  test('負數也認得：「-5」<「3」', () => {
    expect(compareCellValues('-5', '3')).toBeLessThan(0);
  });

  test('前後空白先 trim 再比：「 10 」>「9」', () => {
    expect(compareCellValues(' 10 ', '9')).toBeGreaterThan(0);
  });

  test('MM/DD 日期：先比月再比日（「12/5」<「12/25」，字串比較會顛倒）', () => {
    expect(compareCellValues('3/04', '12/25')).toBeLessThan(0);
    expect(compareCellValues('12/5', '12/25')).toBeLessThan(0);
    expect(compareCellValues('12/25', '12/5')).toBeGreaterThan(0);
  });

  test('混合型別穩定：數字組永遠在文字組前', () => {
    expect(compareCellValues('3km', 'abc')).toBeLessThan(0);
    expect(compareCellValues('abc', '3km')).toBeGreaterThan(0);
  });

  test('型別排位固定：數字 < 日期 < 文字', () => {
    expect(compareCellValues('7', '3/04')).toBeLessThan(0); // 數字在日期前
    expect(compareCellValues('12/25', 'abc')).toBeLessThan(0); // 日期在文字前
  });

  test('相同值回 0', () => {
    expect(compareCellValues('a', 'a')).toBe(0);
    expect(compareCellValues('5', '5')).toBe(0);
  });

  test('文字組使用 zh-Hant locale 比較（正負號與 localeCompare 一致）', () => {
    const expected = Math.sign('測試'.localeCompare('例子', 'zh-Hant'));
    expect(Math.sign(compareCellValues('測試', '例子'))).toBe(expected);
  });

  test('整批排序結果：數字（數值序）→ 日期 → 文字（locale 序）', () => {
    const sorted = ['b', '2', 'a', '10', '1/02'].sort(compareCellValues);
    expect(sorted).toEqual(['2', '10', '1/02', 'a', 'b']);
  });

  test('混合中文與數字：數字永遠排前面', () => {
    const sorted = ['文字', '3', '另文字', '1'].sort(compareCellValues);
    expect(sorted.slice(0, 2)).toEqual(['1', '3']);
  });

  test('超長數字（parseFloat 溢位成 Infinity）不回 NaN——比較器契約不可破（復審 MEDIUM 回歸鎖）', () => {
    const overflowA = `1${'0'.repeat(400)}km`;
    const overflowB = `2${'0'.repeat(400)}km`;
    // Infinity - Infinity = NaN 會違反 Array.sort 比較器契約 → 溢位值降級為文字組。
    expect(Number.isNaN(compareCellValues(overflowA, overflowB))).toBe(false);
    expect(compareCellValues(overflowA, overflowB)).toBeLessThan(0); // 文字組 locale 序仍有確定性
  });

  test('「Infinity」字面與「+.」怪字串不當數字（前導數字樣式不匹配 → 文字組）', () => {
    expect(compareCellValues('3', 'Infinity')).toBeLessThan(0); // 數字組在文字組前
    expect(compareCellValues('3', '+.')).toBeLessThan(0);
  });
});

describe('rowPassesFilters：AND 語意', () => {
  test('無任何篩選 → 一律通過', () => {
    expect(rowPassesFilters(['a', 'b'], {})).toBe(true);
  });

  test('單欄命中允許值 → 通過；不在允許值 → 不通過', () => {
    expect(rowPassesFilters(['未看', 'x'], { 0: ['未看', '考慮中'] })).toBe(true);
    expect(rowPassesFilters(['已婉拒', 'x'], { 0: ['未看', '考慮中'] })).toBe(false);
  });

  test('多欄 AND：任一欄不符即整列不通過', () => {
    expect(rowPassesFilters(['未看', 'A'], { 0: ['未看'], 1: ['A'] })).toBe(true);
    expect(rowPassesFilters(['未看', 'B'], { 0: ['未看'], 1: ['A'] })).toBe(false);
  });

  test('列缺該欄（索引越界）→ 以空字串參與比對', () => {
    expect(rowPassesFilters(['a'], { 2: [''] })).toBe(true);
    expect(rowPassesFilters(['a'], { 2: ['x'] })).toBe(false);
  });

  test('允許值為空集合 → 該欄全部濾掉（字面語意）', () => {
    expect(rowPassesFilters(['a'], { 0: [] })).toBe(false);
  });
});

describe('buildHeaderSignature：表頭簽章', () => {
  test('同表頭同欄數 → 簽章相同', () => {
    expect(buildHeaderSignature(['狀態', '職缺'])).toBe(buildHeaderSignature(['狀態', '職缺']));
  });

  test('表頭改字 → 簽章不同', () => {
    expect(buildHeaderSignature(['狀態', '職缺'])).not.toBe(buildHeaderSignature(['狀態改', '職缺']));
  });

  test('欄數不同 → 簽章不同', () => {
    expect(buildHeaderSignature(['狀態'])).not.toBe(buildHeaderSignature(['狀態', '']));
  });

  test('串聯歧義防護：["ab","c"] 與 ["a","bc"] 簽章不同', () => {
    expect(buildHeaderSignature(['ab', 'c'])).not.toBe(buildHeaderSignature(['a', 'bc']));
  });
});

describe('檢視狀態 localStorage 讀寫', () => {
  const noteId = 'note-123';
  const signature = buildHeaderSignature(['狀態', '職缺', '已讀']);

  /** 造一份合法的檢視狀態（排序＋篩選皆有值）。 */
  const makeState = (): TableViewState => ({
    sort: { col: 1, dir: 'desc' },
    filters: { 0: ['未看', '考慮中'] },
  });

  beforeEach(() => {
    localStorage.clear();
  });

  test('儲存鍵為 zonwiki:tableView:v1、內層鍵為 `${noteId}:${tableIndex}`、值含 headerSignature', () => {
    expect(TABLE_VIEW_STORAGE_KEY).toBe('zonwiki:tableView:v1');
    writeTableView(noteId, 2, signature, makeState());
    const raw = localStorage.getItem('zonwiki:tableView:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed)).toEqual(['note-123:2']);
    // 儲存值形狀照設計文件：{headerSignature, sort, filters}。
    expect(parsed['note-123:2']).toEqual({ headerSignature: signature, ...makeState() });
  });

  test('write → read（簽章相符）round-trip 得回同一狀態', () => {
    writeTableView(noteId, 0, signature, makeState());
    expect(readTableView(noteId, 0, signature)).toEqual(makeState());
  });

  test('簽章不符（表頭被改過）→ 棄用回 null', () => {
    writeTableView(noteId, 0, signature, makeState());
    const changedSignature = buildHeaderSignature(['狀態改', '職缺', '已讀']);
    expect(readTableView(noteId, 0, changedSignature)).toBeNull();
  });

  test('沒存過 → null', () => {
    expect(readTableView(noteId, 0, signature)).toBeNull();
  });

  test('sort 可為 null（只存篩選）', () => {
    const state: TableViewState = { sort: null, filters: { 2: ['[x]'] } };
    writeTableView(noteId, 1, signature, state);
    expect(readTableView(noteId, 1, signature)).toEqual(state);
  });

  test('localStorage 內容是壞 JSON → 容錯回 null 不丟例外', () => {
    localStorage.setItem(TABLE_VIEW_STORAGE_KEY, '{壞掉的json');
    expect(readTableView(noteId, 0, signature)).toBeNull();
  });

  test('形狀不對（dir 非 asc/desc）→ 回 null', () => {
    localStorage.setItem(
      TABLE_VIEW_STORAGE_KEY,
      JSON.stringify({
        'note-123:0': { headerSignature: signature, sort: { col: 0, dir: '亂寫' }, filters: {} },
      })
    );
    expect(readTableView(noteId, 0, signature)).toBeNull();
  });

  test('形狀不對（filters 的值不是字串陣列）→ 回 null', () => {
    localStorage.setItem(
      TABLE_VIEW_STORAGE_KEY,
      JSON.stringify({
        'note-123:0': { headerSignature: signature, sort: null, filters: { 0: 'not-array' } },
      })
    );
    expect(readTableView(noteId, 0, signature)).toBeNull();
  });

  test('形狀不對（缺 headerSignature）→ 回 null', () => {
    localStorage.setItem(
      TABLE_VIEW_STORAGE_KEY,
      JSON.stringify({ 'note-123:0': { sort: null, filters: {} } })
    );
    expect(readTableView(noteId, 0, signature)).toBeNull();
  });

  test('clearTableView：清掉後讀回 null，不影響其他表的紀錄', () => {
    writeTableView(noteId, 0, signature, makeState());
    writeTableView(noteId, 1, signature, makeState());
    clearTableView(noteId, 0);
    expect(readTableView(noteId, 0, signature)).toBeNull();
    expect(readTableView(noteId, 1, signature)).toEqual(makeState());
  });
});
