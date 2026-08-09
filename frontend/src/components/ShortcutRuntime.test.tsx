// @vitest-environment jsdom
/**
 * ShortcutRuntime 派發行為測試（對應測試計畫 B 組）。
 *
 * 鎖住「overlay scope 只在筆記頁與畫布頁派發」與既有 scope 解析不回歸：
 * B1: 筆記頁按 1 → 派發 toolPen 且 preventDefault。
 * B2: 畫布頁按 1 → 同上。
 * B3: 首頁按 1 → 不派發、不 preventDefault。
 * B4: Todo 頁按 1 → 不派發 overlay 動作。
 * B5: Ctrl+1 / Alt+1 → 不觸發（保留瀏覽器行為）。
 * B5b: Shift+S 仍觸發 addSticky——記錄現況：系統只排除 Ctrl/Cmd/Alt、不排除 Shift。
 * B6: 輸入框聚焦時按 1 → 不觸發。
 * B7: 筆記頁按 c → 派發 toggleToc（新動作走 notes scope 既有派發分支）。
 * B8: 一鍵多動作 scope 解析不回歸（筆記頁 a＝newNote、Todo 頁 a＝newTodo）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ShortcutRuntime } from './ShortcutRuntime';
import { SHORTCUT_ACTION_EVENT } from '@/lib/shortcuts';

/** 目前模擬的路徑（各測試自行設定後再 render）。 */
let mockPath = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: vi.fn() }),
}));
// shortcuts.ts 的載入/儲存走後端 API；測試一律回「無覆寫」。
vi.mock('@/lib/api', () => ({
  getUserSettings: vi.fn().mockResolvedValue(null),
  updateUserSettings: vi.fn(),
}));
vi.mock('@/lib/navigationGuard', () => ({
  confirmNavigation: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/notesNavTarget', () => ({
  getNotesNavTarget: () => '/notes',
}));

/** 收集本回合派發出的 SHORTCUT_ACTION_EVENT actionId。 */
let received: string[] = [];
const onActionEvent = (e: Event) => {
  const id = (e as CustomEvent<{ actionId?: string }>).detail?.actionId;
  if (id) received.push(id);
};

beforeEach(() => {
  received = [];
  window.addEventListener(SHORTCUT_ACTION_EVENT, onActionEvent);
});

afterEach(() => {
  window.removeEventListener(SHORTCUT_ACTION_EVENT, onActionEvent);
  cleanup();
});

/** 渲染執行器並等 keymap 非同步載入完成。 */
async function renderRuntime(path: string) {
  mockPath = path;
  render(<ShortcutRuntime />);
  await act(async () => {});
}

/** 對指定目標派發 keydown（預設 window），回傳事件供斷言 defaultPrevented。 */
function pressKey(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(evt);
  });
  return evt;
}

describe('B1 筆記頁按 1', () => {
  it('派發 toolPen 且 preventDefault', async () => {
    await renderRuntime('/notes/test-note');
    const evt = pressKey('1');
    expect(received).toEqual(['toolPen']);
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe('B2 畫布頁按 1', () => {
  it('派發 toolPen', async () => {
    await renderRuntime('/canvas');
    pressKey('1');
    expect(received).toEqual(['toolPen']);
  });
});

describe('B3 首頁按 1', () => {
  it('不派發、不 preventDefault', async () => {
    await renderRuntime('/');
    const evt = pressKey('1');
    expect(received).toEqual([]);
    expect(evt.defaultPrevented).toBe(false);
  });
});

describe('B4 Todo 頁按 1', () => {
  it('不派發 overlay 動作', async () => {
    await renderRuntime('/tasks');
    pressKey('1');
    expect(received).toEqual([]);
  });
});

describe('B5 修飾鍵組合保留給瀏覽器', () => {
  it('Ctrl+1 / Alt+1 都不觸發', async () => {
    await renderRuntime('/notes/test-note');
    pressKey('1', { ctrlKey: true });
    pressKey('1', { altKey: true });
    expect(received).toEqual([]);
  });
});

describe('B5b Shift 不在排除清單（既有行為留底）', () => {
  it('Shift+S（大寫 S）仍觸發 addSticky', async () => {
    await renderRuntime('/notes/test-note');
    pressKey('S', { shiftKey: true });
    expect(received).toEqual(['addSticky']);
  });
});

describe('B9 OS 按鍵自動重複不觸發', () => {
  it('repeat=true 的 keydown（按住不放的連發）不派發——防長按狂建便利貼', async () => {
    await renderRuntime('/notes/test-note');
    pressKey('s', { repeat: true });
    expect(received).toEqual([]);
    pressKey('s'); // 真正的第一次按下仍正常觸發
    expect(received).toEqual(['addSticky']);
  });
});

describe('B6 輸入元素聚焦時不觸發', () => {
  it('在 input 上按 1 → 不派發', async () => {
    await renderRuntime('/notes/test-note');
    const input = document.createElement('input');
    document.body.appendChild(input);
    pressKey('1', {}, input);
    expect(received).toEqual([]);
    input.remove();
  });
});

describe('B7 筆記頁按 c', () => {
  it('派發 toggleToc', async () => {
    await renderRuntime('/notes/test-note');
    pressKey('c');
    expect(received).toEqual(['toggleToc']);
  });
});

describe('B8 一鍵多動作 scope 解析不回歸', () => {
  it('筆記頁按 a → newNote', async () => {
    await renderRuntime('/notes/test-note');
    pressKey('a');
    expect(received).toEqual(['newNote']);
  });

  it('Todo 頁按 a → newTodo', async () => {
    await renderRuntime('/tasks');
    pressKey('a');
    expect(received).toEqual(['newTodo']);
  });
});
