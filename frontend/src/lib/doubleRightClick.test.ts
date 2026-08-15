import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DOUBLE_RIGHT_CLICK_MS, createDoubleRightClickTracker } from './doubleRightClick';

/**
 * 共用「快速連點兩下右鍵」判定器的單元測試。
 *
 * 對應設計文件 §3.4：500ms、`Date.now()`（沿用 MarkdownEditor 被測試釘死的慣例）、
 * `e.defaultPrevented` 為真（NoteOverlay 繪圖取消先吃掉）→ 不計數、觸發後歸零。
 *
 * 時間控制照 repo 既有慣例用 `vi.spyOn(Date, 'now')`，不開 fake timers
 * （vitest 3 fake timers 會誤傷 rAF 等其他計時 API）。
 */

/** 測試用的假時鐘目前值（毫秒）。 */
let fakeNow = 100_000;

/**
 * 造一個最小化的 contextmenu 事件替身（判定器只讀 defaultPrevented）。
 * @param defaultPrevented 是否已被其他監聽器 preventDefault。
 */
const makeEvent = (defaultPrevented = false) => ({ defaultPrevented });

beforeEach(() => {
  fakeNow = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDoubleRightClickTracker', () => {
  test('間隔常數與 MarkdownEditor 慣例對齊＝500ms', () => {
    expect(DOUBLE_RIGHT_CLICK_MS).toBe(500);
  });

  test('500ms 內連兩擊 → 觸發一次', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    fakeNow += 300;
    tracker.handleContextMenu(makeEvent());
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('間隔恰為 500ms → 觸發（<= 判定，與 MarkdownEditor 相同）', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    fakeNow += DOUBLE_RIGHT_CLICK_MS;
    tracker.handleContextMenu(makeEvent());
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('超時（501ms）不觸發，但第二擊成為新的第一擊', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    fakeNow += 501;
    tracker.handleContextMenu(makeEvent()); // 超時 → 不觸發，重新起算
    expect(onTrigger).not.toHaveBeenCalled();
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 與上一擊相距 100ms → 觸發
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('單擊不觸發', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('defaultPrevented 的事件不計數（夾在中間不干擾原本的兩擊）', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent()); // 第一擊
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent(true)); // 被 NoteOverlay 吃掉 → 不計數
    expect(onTrigger).not.toHaveBeenCalled();
    fakeNow += 300; // 距第一擊 400ms
    tracker.handleContextMenu(makeEvent()); // 第二擊 → 觸發
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('defaultPrevented 當第一擊也不計數：之後的單擊不觸發', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent(true)); // 不計數
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 這才是第一擊
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('reset() 歸零：跨 reset 的兩擊不觸發', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    tracker.reset();
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // reset 後的第一擊
    expect(onTrigger).not.toHaveBeenCalled();
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 第二擊 → 觸發
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('觸發後歸零：第三擊不會連鎖觸發，第四擊才再次觸發', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    tracker.handleContextMenu(makeEvent());
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 觸發 #1
    expect(onTrigger).toHaveBeenCalledTimes(1);
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 歸零後的第一擊 → 不觸發
    expect(onTrigger).toHaveBeenCalledTimes(1);
    fakeNow += 100;
    tracker.handleContextMenu(makeEvent()); // 第二擊 → 觸發 #2
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  test('onTrigger 收到觸發那一擊（第二擊）的事件物件', () => {
    const onTrigger = vi.fn();
    const tracker = createDoubleRightClickTracker(onTrigger);
    const first = makeEvent();
    const second = makeEvent();
    tracker.handleContextMenu(first);
    fakeNow += 100;
    tracker.handleContextMenu(second);
    expect(onTrigger).toHaveBeenCalledWith(second);
  });

  test('兩個 tracker 實例互不干擾', () => {
    const onTriggerA = vi.fn();
    const onTriggerB = vi.fn();
    const trackerA = createDoubleRightClickTracker(onTriggerA);
    const trackerB = createDoubleRightClickTracker(onTriggerB);
    trackerA.handleContextMenu(makeEvent());
    fakeNow += 100;
    trackerB.handleContextMenu(makeEvent()); // B 的第一擊，不受 A 影響
    expect(onTriggerB).not.toHaveBeenCalled();
    fakeNow += 100;
    trackerA.handleContextMenu(makeEvent()); // A 的第二擊（距 200ms）→ 只觸發 A
    expect(onTriggerA).toHaveBeenCalledTimes(1);
    expect(onTriggerB).not.toHaveBeenCalled();
  });
});
