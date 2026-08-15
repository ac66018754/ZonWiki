// @vitest-environment jsdom
/**
 * useShortcutKeyCaps——鍵帽提示 hook 測試（對應測試計畫 D 組）。
 *
 * D1: 預設回傳各動作生效鍵的「顯示用大寫鍵帽」（toolPen→"1"、toggleToc→"C"）。
 * D2: 廣播 SHORTCUTS_UPDATED_EVENT（使用者改鍵存檔）後，hook 回傳新鍵。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { SHORTCUTS_UPDATED_EVENT } from './shortcuts';
import { useShortcutKeyCaps } from './useShortcutKeyCaps';

// 覆寫來源走後端 API：預設回「無覆寫」，個別測試再改回傳值。
const getUserSettingsMock = vi.fn().mockResolvedValue(null);
vi.mock('./api', () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
  updateUserSettings: vi.fn(),
}));

afterEach(() => {
  cleanup();
  getUserSettingsMock.mockReset();
  getUserSettingsMock.mockResolvedValue(null);
});

describe('D1 預設鍵帽', () => {
  it('回傳大寫顯示鍵帽：toolPen→2、toggleToc→C、addSticky→S、addSlide→I', async () => {
    const { result } = renderHook(() =>
      useShortcutKeyCaps(['toolPen', 'toggleToc', 'addSticky', 'addSlide']),
    );
    await waitFor(() => {
      expect(result.current).toEqual({
        toolPen: '2',
        toggleToc: 'C',
        addSticky: 'S',
        addSlide: 'I',
      });
    });
  });
});

describe('D2 改鍵後即時更新', () => {
  it('SHORTCUTS_UPDATED_EVENT 廣播後回傳新鍵', async () => {
    const { result } = renderHook(() => useShortcutKeyCaps(['toolPen']));
    await waitFor(() => expect(result.current.toolPen).toBe('2'));

    // 模擬使用者把畫筆改成 x 並存檔：後端回新覆寫 → 廣播更新事件。
    getUserSettingsMock.mockResolvedValue({ shortcutsJson: JSON.stringify({ toolPen: 'x' }) });
    act(() => {
      window.dispatchEvent(new CustomEvent(SHORTCUTS_UPDATED_EVENT));
    });
    await waitFor(() => expect(result.current.toolPen).toBe('X'));
  });
});
