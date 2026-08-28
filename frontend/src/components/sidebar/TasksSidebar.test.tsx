// @vitest-environment jsdom
/**
 * Todo 左側欄（TasksSidebar）的分頁與「＋ 新增」行為測試。
 *
 * 對應 2026-08-28 的兩項需求：
 * - D1：「置頂的任務」分頁多一顆「＋ 新增」，按下要請 Todo 頁彈出新增表單，
 *       且帶 pinnedToTodo=true（從這個分頁新增，意圖就是要它出現在這裡）。
 * - D2：多一個「今日任務」分頁，且預設仍停在「置頂的任務」。
 * - D3：「＋ 新增」只屬於「置頂的任務」分頁，切走就不該還在（避免誤按時語意不明）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TasksSidebar } from './ContextSidebars';
import type { NewTaskRequestDetail } from '@/lib/taskEvents';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
}));
// 兩個清單子元件都會打後端；測試只關心側欄本身的互動，故一律回空清單。
vi.mock('@/lib/api', () => ({
  getUserSettings: vi.fn().mockResolvedValue(null),
  updateUserSettings: vi.fn(),
  listPinnedTodoTasks: vi.fn().mockResolvedValue([]),
  listTaskCardsInRange: vi.fn().mockResolvedValue([]),
}));

/** 收集本回合派發出的「請求新增任務」事件 payload。 */
let requests: NewTaskRequestDetail[] = [];
const onNewTask = (e: Event) => {
  requests.push((e as CustomEvent<NewTaskRequestDetail>).detail ?? {});
};

beforeEach(() => {
  requests = [];
  window.addEventListener('zonwiki:new-task', onNewTask);
});

afterEach(() => {
  window.removeEventListener('zonwiki:new-task', onNewTask);
  cleanup();
});

describe('D1 置頂分頁的「＋ 新增」', () => {
  it('按下 → 派發「請求新增任務」事件且 pinnedToTodo=true', () => {
    render(<TasksSidebar user={null} />);
    fireEvent.click(screen.getByTestId('tasks-sidebar-new-pinned'));
    expect(requests).toEqual([{ pinnedToTodo: true }]);
  });
});

describe('D2 分頁清單', () => {
  it('三個分頁都在，且預設選中「置頂的任務」', () => {
    render(<TasksSidebar user={null} />);
    const pinned = screen.getByRole('tab', { name: /置頂的任務/ });
    const today = screen.getByRole('tab', { name: /今日任務/ });
    const shortcuts = screen.getByRole('tab', { name: /快捷鍵/ });
    expect(pinned.getAttribute('aria-selected')).toBe('true');
    expect(today.getAttribute('aria-selected')).toBe('false');
    expect(shortcuts.getAttribute('aria-selected')).toBe('false');
  });

  it('點「今日任務」→ 該分頁被選中，面板換成今日任務內容', () => {
    render(<TasksSidebar user={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /今日任務/ }));
    expect(screen.getByRole('tab', { name: /今日任務/ }).getAttribute('aria-selected')).toBe('true');
    // 面板標題（TasksTodayList 的抬頭）出現＝真的換了面板，而不只是按鈕變色。
    expect(screen.getByRole('tabpanel').textContent).toContain('今日任務');
  });
});

describe('D3 「＋ 新增」只屬於置頂分頁', () => {
  it('切到「今日任務」後，＋ 新增不再出現', () => {
    render(<TasksSidebar user={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /今日任務/ }));
    expect(screen.queryByTestId('tasks-sidebar-new-pinned')).toBeNull();
  });
});
