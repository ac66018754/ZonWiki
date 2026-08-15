// @vitest-environment jsdom
/**
 * MarkdownEditor「表格 <br> 視圖層」元件測試 —
 * 對應 docs/design/測試計畫-Enter硬換行與表格br視圖層.md B3 組（含 v2 修訂新增列）。
 *
 * 核心驗證：
 * - textarea 顯示展開形（↳ 續行）、onChange 對外永遠是「單行 <br> 形」完整文字；
 * - Shift+Enter 只在表格儲存格內攔截（jsdom 無 execCommand → 走 applyEdit 退路）；
 * - join 原子區手勢（Backspace/Delete 整段刪、打字貼齊內容起點）不外漏 ↳ 進完整文字；
 * - 病態內容停用視圖層後，編輯不做 collapse（不吃使用者的字面 ↳ 行）；
 * - 摺疊與表格視圖層併用時的映射順序（先徽章、再 join）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownEditor, type EditorFoldApi } from './MarkdownEditor';
import { showToast } from '@/lib/toast';

vi.mock('@/components/MarkdownPreview', () => ({
  ToggleAwareMarkdown: ({ value }: { value: string }) => <div data-testid="md-stub">{value}</div>,
}));
vi.mock('@/lib/api', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

/** 標準三列表（資料列首格含 <br>）。 */
const TABLE = ['| h1 | h2 |', '| --- | --- |', '| a<br>b | c |'].join('\n');
/** TABLE 的展開形。 */
const TABLE_EXPANDED = ['| h1 | h2 |', '| --- | --- |', '| a', '↳ b | c |'].join('\n');
/** TABLE_EXPANDED 的 join 區：start=29（換行）、contentStart=32（'b'）。 */
const JOIN_START = 29;
const JOIN_CONTENT = 32;

/** 有狀態測試殼（同 fold 測試慣例）。 */
function Harness({
  initial = TABLE,
  onChangeSpy,
  externalSetRef,
  foldApiRef,
}: {
  initial?: string;
  onChangeSpy?: (v: string) => void;
  externalSetRef?: { current: ((v: string) => void) | null };
  foldApiRef?: React.RefObject<EditorFoldApi | null>;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (externalSetRef) externalSetRef.current = setValue;
  });
  return (
    <MarkdownEditor
      value={value}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
      foldApiRef={foldApiRef}
    />
  );
}

const editorTextarea = () =>
  screen.getByRole('textbox', { name: 'Markdown 編輯器' }) as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('B3-1/B3-8 視圖層初始化與外部變更', () => {
  it('B3-1: value 含 <br> 表格 → textarea 顯示展開形；純視圖、不觸發 onChange', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    expect(editorTextarea().value).toBe(TABLE_EXPANDED);
    expect(spy).not.toHaveBeenCalled();
  });

  it('B3-8: 外部 value 變更（AI 重排等）→ display 重新展開', () => {
    const externalSetRef = { current: null as ((v: string) => void) | null };
    render(<Harness initial={'一般內容'} externalSetRef={externalSetRef} />);
    fireEvent.click(document.body); // 讓 effect 寫好 externalSetRef
    act(() => externalSetRef.current!(TABLE));
    expect(editorTextarea().value).toBe(TABLE_EXPANDED);
  });
});

describe('B3-2 顯示形編輯 → onChange 收斂形', () => {
  it('在續行改字 → onChange 收到單行 <br> 形完整文字', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const edited = TABLE_EXPANDED.replace('↳ b | c |', '↳ bb | c |');
    fireEvent.change(editorTextarea(), { target: { value: edited } });
    expect(spy).toHaveBeenLastCalledWith(
      ['| h1 | h2 |', '| --- | --- |', '| a<br>bb | c |'].join('\n'),
    );
    expect(editorTextarea().value).toBe(edited); // display 保留使用者輸入形
  });

  it('B3-23: 貼上字面 <br> 文字（onChange 路徑）→ 維持字面、無 ↳ 外漏', () => {
    const spy = vi.fn();
    render(<Harness initial={'段落'} onChangeSpy={spy} />);
    fireEvent.change(editorTextarea(), { target: { value: '段落\n甲<br>乙' } });
    expect(spy).toHaveBeenLastCalledWith('段落\n甲<br>乙');
  });
});

describe('B3-3/B3-4/B3-20 Shift+Enter', () => {
  it('B3-3: 儲存格內 Shift+Enter → display 多一條 ↳ 續行、onChange 該格多一個 <br>', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    const pos = TABLE_EXPANDED.indexOf(' c |') + 2; // 'c' 之後
    ta.setSelectionRange(pos, pos);
    const notPrevented = fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(false); // 已攔截
    expect(ta.value).toBe(
      ['| h1 | h2 |', '| --- | --- |', '| a', '↳ b | c', '↳  |'].join('\n'),
    );
    expect(spy).toHaveBeenLastCalledWith(
      ['| h1 | h2 |', '| --- | --- |', '| a<br>b | c<br> |'].join('\n'),
    );
  });

  it('B3-4: 段落內 Shift+Enter → 放行預設（不攔截）', () => {
    render(<Harness initial={'一般段落文字'} />);
    const ta = editorTextarea();
    ta.setSelectionRange(3, 3);
    const notPrevented = fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(true);
  });

  it('B3-20: 分隔列上 Shift+Enter → 放行預設', () => {
    render(<Harness />);
    const ta = editorTextarea();
    const pos = TABLE_EXPANDED.indexOf('---') + 1;
    ta.setSelectionRange(pos, pos);
    expect(fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })).toBe(true);
  });

  it('B3-11: IME 組字中（isComposing）不攔截', () => {
    render(<Harness />);
    const ta = editorTextarea();
    const pos = TABLE_EXPANDED.indexOf(' c |') + 2;
    ta.setSelectionRange(pos, pos);
    expect(fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true, isComposing: true })).toBe(true);
  });

  it('B3-22: 續行上 Shift+Enter → 沿用該行墊片再開一條續行', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    const pos = TABLE_EXPANDED.indexOf('↳ b') + 3; // 'b' 之後
    ta.setSelectionRange(pos, pos);
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(ta.value).toBe(
      ['| h1 | h2 |', '| --- | --- |', '| a', '↳ b', '↳  | c |'].join('\n'),
    );
    expect(spy).toHaveBeenLastCalledWith(
      ['| h1 | h2 |', '| --- | --- |', '| a<br>b<br> | c |'].join('\n'),
    );
  });
});

describe('B3-5/B3-6/B3-16 join 原子區手勢', () => {
  it('B3-5: 續行內容起點 Backspace → 整個 join 一次刪除（移除該 <br>）', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    ta.setSelectionRange(JOIN_CONTENT, JOIN_CONTENT);
    const notPrevented = fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(notPrevented).toBe(false);
    expect(ta.value).toBe(['| h1 | h2 |', '| --- | --- |', '| ab | c |'].join('\n'));
    expect(spy).toHaveBeenLastCalledWith(['| h1 | h2 |', '| --- | --- |', '| ab | c |'].join('\n'));
  });

  it('B3-6: 前行行尾 Delete（次行為續行）→ 同樣整段刪除', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    ta.setSelectionRange(JOIN_START, JOIN_START);
    const notPrevented = fireEvent.keyDown(ta, { key: 'Delete' });
    expect(notPrevented).toBe(false);
    expect(spy).toHaveBeenLastCalledWith(['| h1 | h2 |', '| --- | --- |', '| ab | c |'].join('\n'));
  });

  it('B3-16: 游標在墊片/標記區內打字 → 先貼齊內容起點（字不會落進標記、無 ↳ 外漏）', () => {
    render(<Harness />);
    const ta = editorTextarea();
    ta.setSelectionRange(JOIN_START + 1, JOIN_START + 1); // ↳ 之前（標記區內）
    const notPrevented = fireEvent.keyDown(ta, { key: 'x' });
    expect(notPrevented).toBe(true); // 不吃掉按鍵，讓字照常落下
    expect(ta.selectionStart).toBe(JOIN_CONTENT); // 但游標已貼齊內容起點
  });
});

describe('B3-7 複製、B3-18 拖放', () => {
  it('B3-7: 選取跨 join 複製 → 剪貼簿為 <br> 單行形', () => {
    render(<Harness />);
    const ta = editorTextarea();
    // 選『| a\n↳ b | c |』（整條資料列的展開形）。
    ta.setSelectionRange(26, TABLE_EXPANDED.length);
    const setData = vi.fn();
    fireEvent.copy(ta, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '| a<br>b | c |');
  });

  it('複製未跨 join → 放行原生複製（不 setData）', () => {
    render(<Harness />);
    const ta = editorTextarea();
    ta.setSelectionRange(0, 5);
    const setData = vi.fn();
    fireEvent.copy(ta, { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
  });

  it('HIGH-1 回歸: 全選複製（選取完整包住摺疊徽章＋跨 join）→ 剪貼簿為真完整文字（無 ↳、無徽章）', () => {
    const WITH_TOGGLE = [':::toggle 標題', '內文', ':::', TABLE].join('\n');
    render(<Harness initial={WITH_TOGGLE} />);
    fireEvent.click(screen.getByRole('button', { name: '全部摺疊' }));
    const ta = editorTextarea();
    expect(ta.value).toContain('⋯〔已摺疊');
    ta.setSelectionRange(0, ta.value.length); // Ctrl+A
    const setData = vi.fn();
    fireEvent.copy(ta, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', WITH_TOGGLE);
  });

  it('HIGH-1 回歸: 剪下（端點落在 join 區內）→ 剪貼簿 <br> 形＋刪除範圍擴張、無半殘標記', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    ta.setSelectionRange(JOIN_START + 1, TABLE_EXPANDED.length); // 起點在墊片/標記區內
    const setData = vi.fn();
    fireEvent.cut(ta, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '<br>b | c |');
    expect(ta.value).toBe(['| h1 | h2 |', '| --- | --- |', '| a'].join('\n'));
    expect(ta.value).not.toContain('↳');
    expect(spy).toHaveBeenLastCalledWith(['| h1 | h2 |', '| --- | --- |', '| a'].join('\n'));
  });

  it('B3-18: 拖放內容含 join 樣式 → 擋下並提示', () => {
    render(<Harness />);
    const ta = editorTextarea();
    const notPrevented = fireEvent.drop(ta, {
      dataTransfer: { getData: () => '| x\n↳ y |' },
    });
    expect(notPrevented).toBe(false);
    expect(showToast).toHaveBeenCalled();
  });
});

describe('B3-17 工具列 linePrefix 作用於續行', () => {
  it('H1 鈕：游標在續行 → 前綴落在內容起點（標記之後），不外漏 ↳', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();
    ta.setSelectionRange(JOIN_CONTENT, JOIN_CONTENT);
    fireEvent.click(screen.getByRole('button', { name: 'H1' }));
    expect(ta.value).toContain('↳ # b | c |');
    expect(spy).toHaveBeenLastCalledWith(
      ['| h1 | h2 |', '| --- | --- |', '| a<br># b | c |'].join('\n'),
    );
  });
});

describe('B3-9/B3-10 與摺疊層併用', () => {
  const WITH_TOGGLE = [':::toggle 標題', '內文', ':::', TABLE].join('\n');

  it('B3-9: 摺疊→展開後 display 仍是表格展開形；打字 round-trip 正確', () => {
    const spy = vi.fn();
    render(<Harness initial={WITH_TOGGLE} onChangeSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: '全部摺疊' }));
    expect(editorTextarea().value).toContain('⋯〔已摺疊');
    expect(editorTextarea().value).toContain('↳ b | c |');
    fireEvent.click(screen.getByRole('button', { name: '全部展開' }));
    expect(editorTextarea().value).toBe([':::toggle 標題', '內文', ':::', TABLE_EXPANDED].join('\n'));
    // 在尾端打字 → onChange 應是「摺疊展開＋表格收斂」後的完整文字。
    const ta = editorTextarea();
    fireEvent.change(ta, { target: { value: ta.value + '!' } });
    expect(spy).toHaveBeenLastCalledWith(WITH_TOGGLE + '!');
  });

  it('B3-10: 摺疊在前＋選取跨 join → mapSelectionToFull 先過徽章、再過 join（C-1）', () => {
    const foldApiRef = { current: null as EditorFoldApi | null };
    render(<Harness initial={WITH_TOGGLE} foldApiRef={foldApiRef} />);
    fireEvent.click(screen.getByRole('button', { name: '全部摺疊' }));
    const display = editorTextarea().value;
    // 選取展開形資料列『| a\n↳ b | c |』（含 join）。
    const selStart = display.indexOf('| a\n');
    const selEnd = display.length;
    const range = foldApiRef.current!.mapSelectionToFull(selStart, selEnd);
    expect(range).not.toBeNull();
    expect(WITH_TOGGLE.slice(range!.start, range!.end)).toBe('| a<br>b | c |');
  });
});

describe('表格管線標示背景層（| 上色；使用者 2026-08-13 追加）', () => {
  it('真表格列（含續行）的未跳脫 | 畫色塊；散文管線與跳脫管線 \\| 不標', () => {
    const withEscaped = [
      '| h1 | h2 |',
      '| --- | --- |',
      '| e\\|f | x<br>y |',
      '',
      '散文 | 不是表格不標',
    ].join('\n');
    render(<Harness initial={withEscaped} />);
    const marks = Array.from(document.querySelectorAll('.mde-pipe-mark'));
    // 表頭 3＋分隔列 3＋資料列首段 2（\| 不算）＋續行 1 ＝ 9；散文那根不標。
    expect(marks).toHaveLength(9);
    expect(marks.every((m) => m.textContent === '|')).toBe(true);
  });

  it('無表格內容 → 無背景層標示', () => {
    render(<Harness initial={'散文 | 管線'} />);
    expect(document.querySelectorAll('.mde-pipe-mark')).toHaveLength(0);
  });
});

describe('B3-12 病態內容停用視圖層（C-2）', () => {
  const PATHOLOGICAL = ['| h |', '| --- |', '| a |', '↳ 使用者自己的字面箭頭行'].join('\n');

  it('display=原文；打字後 onChange 仍保留字面 ↳ 行（不 collapse）', () => {
    const spy = vi.fn();
    render(<Harness initial={PATHOLOGICAL} onChangeSpy={spy} />);
    const ta = editorTextarea();
    expect(ta.value).toBe(PATHOLOGICAL);
    fireEvent.change(ta, { target: { value: PATHOLOGICAL + 'x' } });
    expect(spy).toHaveBeenLastCalledWith(PATHOLOGICAL + 'x');
  });

  it('停用時 Shift+Enter 不攔截', () => {
    render(<Harness initial={PATHOLOGICAL} />);
    const ta = editorTextarea();
    const pos = PATHOLOGICAL.indexOf('a |') + 1;
    ta.setSelectionRange(pos, pos);
    expect(fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })).toBe(true);
  });
});
