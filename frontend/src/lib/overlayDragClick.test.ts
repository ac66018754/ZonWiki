import { describe, expect, test } from 'vitest';
import { CLICK_DRAG_THRESHOLD_PX, createDragClickTracker } from './overlayDragClick';

/**
 * 「點擊 vs 拖曳」判定器的單元測試。
 *
 * 使用情境：便利貼/圖片板 top bar 的 pointerdown 後，pointermove 未超過閾值前視為「死區」
 * （不套用移動）；pointerup 時若從未超過閾值＝點擊（切換收合/展開），否則＝拖曳（照舊持久化座標）。
 */
describe('createDragClickTracker', () => {
  test('完全沒有 move → 視為點擊', () => {
    const tracker = createDragClickTracker();
    expect(tracker.isClick()).toBe(true);
  });

  test('多次小位移（各軸皆小於閾值）→ move 全回 false（死區），放開仍視為點擊', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(1, 0)).toBe(false);
    expect(tracker.move(-3, 2)).toBe(false);
    expect(tracker.move(4, -5)).toBe(false);
    expect(tracker.isClick()).toBe(true);
  });

  test('大位移（超過閾值）→ move 回 true，放開視為拖曳', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(10, 0)).toBe(true);
    expect(tracker.isClick()).toBe(false);
  });

  test('先小後大 → 先死區後拖曳', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(2, 1)).toBe(false);
    expect(tracker.move(9, 0)).toBe(true);
    expect(tracker.isClick()).toBe(false);
  });

  test('一旦超過閾值，即使拖回原點仍是拖曳（不會退回點擊）', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(20, 0)).toBe(true);
    expect(tracker.move(0, 0)).toBe(true);
    expect(tracker.isClick()).toBe(false);
  });

  test('邊界：位移恰等於閾值 → 視為拖曳（>= 即觸發）', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(CLICK_DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(tracker.isClick()).toBe(false);
  });

  test('負方向位移超過閾值 → 拖曳（取絕對值判定）', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(-(CLICK_DRAG_THRESHOLD_PX + 1), 0)).toBe(true);
    expect(tracker.isClick()).toBe(false);
  });

  test('斜向：各軸皆未達閾值 → 點擊；任一軸達閾值 → 拖曳', () => {
    const a = createDragClickTracker();
    expect(a.move(5, 5)).toBe(false);
    expect(a.isClick()).toBe(true);

    const b = createDragClickTracker();
    expect(b.move(5, CLICK_DRAG_THRESHOLD_PX + 1)).toBe(true);
    expect(b.isClick()).toBe(false);
  });

  test('自訂閾值生效（threshold=12 時 dx=9 仍是點擊、dx=12 是拖曳）', () => {
    const a = createDragClickTracker(12);
    expect(a.move(9, 0)).toBe(false);
    expect(a.isClick()).toBe(true);

    const b = createDragClickTracker(12);
    expect(b.move(12, 0)).toBe(true);
    expect(b.isClick()).toBe(false);
  });

  test('兩個 tracker 實例互不干擾（防止未來被改成模組層級單例造成跨手勢污染）', () => {
    const dragged = createDragClickTracker();
    const clicked = createDragClickTracker();
    expect(dragged.move(30, 30)).toBe(true);
    // dragged 已超過閾值，不影響 clicked 的判定。
    expect(clicked.move(1, 1)).toBe(false);
    expect(clicked.isClick()).toBe(true);
    expect(dragged.isClick()).toBe(false);
  });

  test('isClick 為純讀取：重複呼叫結果一致、不改變狀態', () => {
    const tracker = createDragClickTracker();
    tracker.move(1, 1);
    expect(tracker.isClick()).toBe(true);
    expect(tracker.isClick()).toBe(true);
    tracker.move(0, 50);
    expect(tracker.isClick()).toBe(false);
    expect(tracker.isClick()).toBe(false);
  });

  test('浮點輸入（高 DPI 常見的次像素位移）：略小於閾值仍是點擊', () => {
    const tracker = createDragClickTracker();
    expect(tracker.move(CLICK_DRAG_THRESHOLD_PX - 0.001, 0)).toBe(false);
    expect(tracker.isClick()).toBe(true);
  });

  test('預設閾值沿用專案拖曳把手慣例 8px', () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(8);
  });
});
