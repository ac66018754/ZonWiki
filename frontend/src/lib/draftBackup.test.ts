// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearDraft,
  createDraftWriter,
  draftKeyForNote,
  draftKeyForTask,
  loadDraft,
  saveDraft,
} from './draftBackup';

/**
 * 本地草稿備份（防停電）的測試（測試計畫 包6 B1–B3）。
 * localStorage 為同步 API：寫入即落地，行程被殺（停電/關機）也不遺失。
 */

describe('draftBackup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('鍵空間：筆記/任務、既有/新建各自獨立', () => {
    expect(draftKeyForNote('n1')).toBe('zw:draft:note:n1');
    expect(draftKeyForNote(null)).toBe('zw:draft:note:new');
    expect(draftKeyForTask('t1')).toBe('zw:draft:task:t1');
    expect(draftKeyForTask(null)).toBe('zw:draft:task:new');
  });

  test('B1：save → load round-trip（含 savedAt）', () => {
    const key = draftKeyForNote('n1');
    saveDraft(key, { title: '標題', content: '內容' });
    const loaded = loadDraft(key);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('標題');
    expect(loaded!.content).toBe('內容');
    expect(Date.parse(loaded!.savedAt)).not.toBeNaN();
  });

  test('B1b：clearDraft 後 load 為 null', () => {
    const key = draftKeyForNote('n1');
    saveDraft(key, { title: 't', content: 'c' });
    clearDraft(key);
    expect(loadDraft(key)).toBeNull();
  });

  test('B2：載入時清理 7 天以上的過期草稿（其他鍵不受影響）', () => {
    const oldKey = draftKeyForNote('old');
    const newKey = draftKeyForNote('new-one');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      oldKey,
      JSON.stringify({ title: '舊', content: '舊', savedAt: eightDaysAgo }),
    );
    saveDraft(newKey, { title: '新', content: '新' });

    loadDraft(newKey); // 任一 load 觸發清理

    expect(localStorage.getItem(oldKey)).toBeNull();
    expect(loadDraft(newKey)).not.toBeNull();
  });

  test('B2b：壞掉的 JSON 草稿 → load 回 null 並移除', () => {
    const key = draftKeyForNote('broken');
    localStorage.setItem(key, '{not json');
    expect(loadDraft(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  test('B3：setItem 丟 QuotaExceeded → 不拋出（靜默略過）', () => {
    const key = draftKeyForNote('quota');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveDraft(key, { title: 't', content: 'c' })).not.toThrow();
    spy.mockRestore();
  });

  test('createDraftWriter：write 有 debounce，flush 立即落地，cancel 不落地', () => {
    vi.useFakeTimers();
    const key = draftKeyForNote('w');

    const writer = createDraftWriter(key, 800);
    writer.write({ title: 'a', content: '1' });
    expect(loadDraft(key)).toBeNull(); // 未到 debounce 時限

    vi.advanceTimersByTime(801);
    expect(loadDraft(key)!.content).toBe('1');

    writer.write({ title: 'a', content: '2' });
    writer.flush(); // beforeunload 路徑：同步落地
    expect(loadDraft(key)!.content).toBe('2');

    writer.write({ title: 'a', content: '3' });
    writer.cancel();
    vi.advanceTimersByTime(1000);
    expect(loadDraft(key)!.content).toBe('2'); // cancel 後不落地
  });
});
