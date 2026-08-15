// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoteMetaQuickEdit } from './NoteMetaQuickEdit';

/**
 * 閱讀模式就地調整分類/標籤面板的測試（測試計畫 包2 C1–C3）。
 * 核心不變式：只打分類/標籤端點，**絕不**打 PUT /api/notes/{id} 整包更新
 * （由 mock 模組層保證——元件根本沒 import updateNote，此測試鎖住呼叫面）。
 */

const setNoteCategoriesMock = vi.fn<(id: string, ids: string[]) => Promise<boolean>>();
const updateNoteTagsMock = vi.fn<(id: string, ids: string[]) => Promise<boolean>>();
const updateNoteMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('@/lib/api', () => ({
  setNoteCategories: (id: string, ids: string[]) => setNoteCategoriesMock(id, ids),
  updateNoteTags: (id: string, ids: string[]) => updateNoteTagsMock(id, ids),
  updateNote: (...args: unknown[]) => updateNoteMock(...args),
}));
vi.mock('@/lib/toast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

const CATEGORY_OPTIONS = [
  { id: 'c1', name: '甲類' },
  { id: 'c2', name: '乙類' },
];
const TAG_OPTIONS = [{ id: 't1', name: '重要' }];

function renderPanel(overrides: Partial<Parameters<typeof NoteMetaQuickEdit>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <div style={{ position: 'relative' }}>
      <NoteMetaQuickEdit
        noteId="note-1"
        categoryOptions={CATEGORY_OPTIONS}
        tagOptions={TAG_OPTIONS}
        initialCategoryIds={['c1']}
        initialTagIds={[]}
        onSaved={onSaved}
        onClose={onClose}
        {...overrides}
      />
    </div>,
  );
  return { onSaved, onClose };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setNoteCategoriesMock.mockResolvedValue(true);
  updateNoteTagsMock.mockResolvedValue(true);
});

describe('NoteMetaQuickEdit', () => {
  test('C1：改選分類後儲存 → 只呼叫分類/標籤端點、帶最終選取、onSaved+onClose', async () => {
    const { onSaved, onClose } = renderPanel();

    // 開啟分類下拉並加選「乙類」
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    fireEvent.click(await screen.findByRole('button', { name: '乙類' }));

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(setNoteCategoriesMock).toHaveBeenCalledWith('note-1', ['c1', 'c2']);
    expect(updateNoteTagsMock).toHaveBeenCalledWith('note-1', []);
    expect(updateNoteMock).not.toHaveBeenCalled(); // 絕不走整包更新
    expect(onSaved).toHaveBeenCalledWith(['c1', 'c2'], []);
    expect(onClose).toHaveBeenCalled();
  });

  test('C2：儲存失敗（端點回 false）→ toast 錯誤、面板不關（onClose 不被叫）', async () => {
    setNoteCategoriesMock.mockResolvedValue(false);
    const { onSaved, onClose } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('C4：下拉開啟時按 Esc → 只關下拉、面板不關（分層關閉）', async () => {
    const { onClose } = renderPanel();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]); // 開啟分類下拉
    await screen.findByRole('button', { name: '乙類' });
    fireEvent.keyDown(inputs[0], { key: 'Escape' }); // 第一下：關下拉
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' }); // 第二下（無下拉）：關面板
    expect(onClose).toHaveBeenCalled();
  });

  test('C5：分類成功、標籤失敗 → onSaved 回報（分類=新、標籤=原值）、面板不關（二輪復審 M）', async () => {
    updateNoteTagsMock.mockResolvedValue(false);
    const { onSaved, onClose } = renderPanel();

    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    fireEvent.click(await screen.findByRole('button', { name: '乙類' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await vi.waitFor(() => expect(showToastMock).toHaveBeenCalled());

    expect(onSaved).toHaveBeenCalledWith(['c1', 'c2'], []); // 分類已落地、標籤維持原值
    expect(onClose).not.toHaveBeenCalled(); // 面板留著供重試標籤
  });

  test('C3：取消 → 不打任何 API、onClose 被叫', () => {
    const { onSaved, onClose } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(setNoteCategoriesMock).not.toHaveBeenCalled();
    expect(updateNoteTagsMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
