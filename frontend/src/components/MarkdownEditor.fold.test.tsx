// @vitest-environment jsdom
/**
 * MarkdownEditor「編輯模式摺疊」元件測試 —
 * 對應 docs/design/測試計畫-編輯模式toggle摺疊.md v2 的 B 節與 C1+/C2+/C3+/H3+。
 *
 * 核心驗證：onChange 對外永遠是「展開後完整文字」；摺疊/展開不觸發 onChange；
 * 破壞徽章的編輯被拒絕（還原＋toast）；外部 value 變更重設摺疊；自家編輯不重設。
 *
 * jsdom 沒有真排版：gutter 按鈕位置全為 0（疊在一起）但照樣渲染、可點擊——
 * 這裡只驗邏輯行為，視覺位置由 Playwright E2E 驗。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownEditor, type EditorFoldApi } from './MarkdownEditor';
import { makeBadge } from '@/lib/editorFolding';
import { showToast } from '@/lib/toast';
import { uploadAttachment } from '@/lib/api';

// 換掉重依賴：預覽 stub 直接吐出收到的原文（供驗證「預覽收到完整文字」）。
vi.mock('@/components/MarkdownPreview', () => ({
  ToggleAwareMarkdown: ({ value }: { value: string }) => <div data-testid="md-stub">{value}</div>,
}));
vi.mock('@/lib/api', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

const SIMPLE = ['前文', ':::toggle 標題A', '內文一', '內文二', ':::', '後文'].join('\n');

/** 有狀態測試殼：onChangeSpy 監看對外送出的「完整文字」。 */
function Harness({
  initial = SIMPLE,
  onChangeSpy,
  externalSetRef,
  foldApiRef,
  ...rest
}: {
  initial?: string;
  onChangeSpy?: (v: string) => void;
  /** 供測試從「編輯器外部」直接改 value（模擬 AI 重排／預覽勾選）。 */
  externalSetRef?: { current: ((v: string) => void) | null };
  foldApiRef?: React.RefObject<EditorFoldApi | null>;
} & Partial<Omit<React.ComponentProps<typeof MarkdownEditor>, 'value' | 'onChange' | 'foldApiRef'>>) {
  const [value, setValue] = useState(initial);
  // ref 只能在 effect 內寫（react-hooks/refs）；effect 於 commit 後執行，測試取用時已就緒。
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
      {...rest}
    />
  );
}

const editorTextarea = () =>
  screen.getByRole('textbox', { name: 'Markdown 編輯器' }) as HTMLTextAreaElement;
const foldAllBtn = () => screen.queryByRole('button', { name: '全部摺疊' });
const unfoldAllBtn = () => screen.queryByRole('button', { name: '全部展開' });

/** 便利：按「全部摺疊」並回傳摺疊後的顯示文字。 */
function foldAllViaToolbar(): string {
  fireEvent.click(foldAllBtn()!);
  return editorTextarea().value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('B26/B31 摺疊工具鈕與 gutter 的出現條件', () => {
  it('B26: 內容含 toggle → 「全部摺疊/全部展開」與 gutter 鈕出現；點「全部摺疊」→ 顯示值含徽章、onChange 未被呼叫', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    expect(foldAllBtn()).not.toBeNull();
    expect(unfoldAllBtn()).not.toBeNull();
    // gutter 量測有 debounce（GUTTER_MEASURE_DEBOUNCE_MS）→ 按鈕非同步出現
    expect((await screen.findAllByRole('button', { name: '摺疊區塊' })).length).toBe(1);

    const display = foldAllViaToolbar();
    expect(display).toContain('⋯〔已摺疊 3 行 #');
    expect(display).not.toContain('內文一');
    expect(spy).not.toHaveBeenCalled(); // 摺疊純視圖，不改內容
  });

  it('B31: 無 toggle 內容 → 無摺疊鈕、無 gutter，顯示值===value', () => {
    render(<Harness initial={'只是一般內容\n第二行'} />);
    expect(foldAllBtn()).toBeNull();
    expect(screen.queryAllByRole('button', { name: '摺疊區塊' })).toHaveLength(0);
    expect(editorTextarea().value).toBe('只是一般內容\n第二行');
  });

  it('gutter ▾ 鈕：點一下摺疊該區塊（與全部摺疊等效，單一區塊情境）', async () => {
    render(<Harness />);
    // gutter 量測有 debounce → 按鈕非同步出現
    fireEvent.click((await screen.findAllByRole('button', { name: '摺疊區塊' }))[0]);
    expect(editorTextarea().value).toContain('⋯〔已摺疊 3 行 #');
    // 摺疊後 gutter 鈕變成「展開」（同樣等 debounce 後的重量測）
    expect((await screen.findAllByRole('button', { name: '展開摺疊區塊' })).length).toBe(1);
  });
});

describe('B27/H3+ 摺疊下編輯：onChange 送完整文字、摺疊不被重設', () => {
  it('B27: 摺疊後在區塊外編輯 → onChange 收到展開後完整文字；徽章仍在（round-trip 不重設）', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();

    const edited = display.replace('後文', '後文改');
    fireEvent.change(editorTextarea(), { target: { value: edited } });

    expect(spy).toHaveBeenCalledTimes(1);
    const full = spy.mock.calls[0][0] as string;
    expect(full).toBe(SIMPLE.replace('後文', '後文改')); // 完整文字（含隱藏內文）
    expect(full).not.toContain('已摺疊'); // 徽章不滲入
    // 自家 round-trip：顯示值仍是摺疊狀態
    expect(editorTextarea().value).toContain('⋯〔已摺疊 3 行 #');
  });

  it('B36: 並排預覽收到的是「完整文字」而非摺疊後的顯示文字', () => {
    render(<Harness withPreview defaultView="split" />);
    foldAllViaToolbar();
    const stub = screen.getAllByTestId('md-stub')[0];
    expect(stub.textContent).toContain('內文一'); // 預覽仍渲染完整內容
    expect(stub.textContent).not.toContain('已摺疊');
  });
});

describe('B28 展開手勢', () => {
  it('點擊落在徽章內 → 自動展開該塊', () => {
    render(<Harness />);
    const display = foldAllViaToolbar();
    const ta = editorTextarea();
    const badgeIdx = display.indexOf('⋯〔');
    ta.setSelectionRange(badgeIdx + 2, badgeIdx + 2);
    fireEvent.click(ta);
    expect(ta.value).toBe(SIMPLE); // 展開還原
  });

  it('游標貼齊徽章後緣按 Backspace → 展開（不逐字啃徽章）、內容不變', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();
    const ta = editorTextarea();
    const badge = display.slice(display.indexOf(' ⋯〔'));
    const badgeEnd = display.indexOf(' ⋯〔') + badge.indexOf('〕') + 1;
    ta.setSelectionRange(badgeEnd, badgeEnd);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(ta.value).toBe(SIMPLE);
    expect(spy).not.toHaveBeenCalled(); // 展開純視圖
  });
});

describe('B29 破壞徽章的編輯被拒絕', () => {
  it('徽章被改壞 → 顯示值還原、錯誤 toast、onChange 未被呼叫', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();

    const damaged = display.replace('已摺疊 3 行', '已摺疊 3行'); // id 殘片仍在
    fireEvent.change(editorTextarea(), { target: { value: damaged } });

    expect(spy).not.toHaveBeenCalled();
    expect(editorTextarea().value).toBe(display); // 還原
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(
      expect.stringContaining('改壞'),
      expect.objectContaining({ type: 'error' }),
    );
  });
});

describe('C3+ 刪除整塊與 undo 復活', () => {
  it('刪除含徽章的整行 → 接受＋info toast；貼回徽章（undo）→ 內容完整復活', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();
    const ta = editorTextarea();

    // 刪除整行（含完整徽章）
    const headerLine = display.split('\n').find((l) => l.includes('⋯〔'))!;
    const deleted = display.replace(`${headerLine}\n`, '');
    fireEvent.change(ta, { target: { value: deleted } });
    expect(spy).toHaveBeenLastCalledWith('前文\n後文');
    expect(vi.mocked(showToast)).toHaveBeenCalledWith(
      expect.stringContaining('Ctrl+Z 可復原'),
      expect.objectContaining({ type: 'info' }),
    );

    // 模擬 Ctrl+Z：徽章行貼回 → 紀錄復活、完整內容回歸
    fireEvent.change(ta, { target: { value: display } });
    expect(spy).toHaveBeenLastCalledWith(SIMPLE);
  });
});

describe('B30 外部 value 變更重設摺疊', () => {
  it('外部（AI 重排等）直接改 value → 摺疊重設、顯示新完整文字', () => {
    const externalSetRef = { current: null as ((v: string) => void) | null };
    render(<Harness externalSetRef={externalSetRef} />);
    foldAllViaToolbar();
    expect(editorTextarea().value).toContain('已摺疊');

    act(() => externalSetRef.current!('# 全新內容\n:::toggle 新\nX\n:::'));
    expect(editorTextarea().value).toBe('# 全新內容\n:::toggle 新\nX\n:::'); // 無徽章＝已重設
  });
});

describe('C2+ 摺疊下的工具列與 Tab（display 座標）', () => {
  it('摺疊後選取「後文」按粗體 → onChange 完整文字在正確位置加 **', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();
    const ta = editorTextarea();
    const s = display.indexOf('後文');
    ta.setSelectionRange(s, s + 2);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(spy).toHaveBeenLastCalledWith(SIMPLE.replace('後文', '**後文**'));
    expect(editorTextarea().value).toContain('已摺疊'); // 摺疊不被重設
  });

  it('摺疊後游標在「後文」行按 Tab → 縮排落在正確行', () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const display = foldAllViaToolbar();
    const ta = editorTextarea();
    const s = display.indexOf('後文');
    ta.setSelectionRange(s, s);
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(spy).toHaveBeenLastCalledWith(SIMPLE.replace('\n後文', '\n  後文'));
  });
});

describe('C1+ foldApiRef（局部排版座標映射）', () => {
  it('無摺疊＝恆等；摺疊後「徽章之後」的範圍映射回完整座標；跨徽章＝null；unfoldAll 可展開', () => {
    const foldApiRef = { current: null as EditorFoldApi | null };
    render(<Harness foldApiRef={foldApiRef} />);
    expect(foldApiRef.current).not.toBeNull();
    expect(foldApiRef.current!.hasFolds()).toBe(false);
    expect(foldApiRef.current!.mapSelectionToFull(3, 8)).toEqual({ start: 3, end: 8 });

    const display = foldAllViaToolbar();
    expect(foldApiRef.current!.hasFolds()).toBe(true);

    // 「後文」在完整文字中的位置
    const s = display.indexOf('後文');
    const mapped = foldApiRef.current!.mapSelectionToFull(s, s + 2)!;
    expect(SIMPLE.slice(mapped.start, mapped.end)).toBe('後文');

    // 跨入徽章 → null
    const badgeIdx = display.indexOf('⋯〔');
    expect(foldApiRef.current!.mapSelectionToFull(badgeIdx - 1, badgeIdx + 3)).toBeNull();

    act(() => foldApiRef.current!.unfoldAll());
    expect(editorTextarea().value).toBe(SIMPLE);
  });
});

describe('C2+ 貼圖：佔位被摺入 hiddenText 後替換仍正確、摺疊不重設', () => {
  it('在 toggle 內文貼圖 → 摺疊 → 上傳完成 → 完整文字含圖片網址、徽章仍在', async () => {
    let resolveUpload: (v: { url: string }) => void = () => {};
    vi.mocked(uploadAttachment).mockImplementation(
      () => new Promise((r) => { resolveUpload = r as (v: { url: string }) => void; }),
    );
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const ta = editorTextarea();

    // 游標放在「內文一」行尾（toggle 內文中），貼上圖片
    const pos = SIMPLE.indexOf('內文一') + '內文一'.length;
    ta.setSelectionRange(pos, pos);
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    fireEvent.paste(ta, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    });
    expect(ta.value).toContain('〔圖片上傳中 #');

    // 摺疊（佔位進 hiddenText）
    fireEvent.click(foldAllBtn()!);
    expect(ta.value).not.toContain('圖片上傳中');

    // 上傳完成 → 佔位在 hiddenText 內被替換；摺疊不重設；完整文字含網址
    await act(async () => {
      resolveUpload({ url: '/api/attachments/xyz' });
      await Promise.resolve();
    });
    const full = spy.mock.calls[spy.mock.calls.length - 1][0] as string;
    expect(full).toContain('![圖片](/api/attachments/xyz)');
    expect(full).not.toContain('圖片上傳中');
    expect(full).not.toContain('已摺疊');
    expect(ta.value).toContain('已摺疊'); // 摺疊仍在
  });
});

describe('A5 補充：makeBadge 與顯示值的一致性', () => {
  it('顯示值中的徽章格式與 makeBadge 一致（行數正確）', () => {
    render(<Harness />);
    const display = foldAllViaToolbar();
    const m = display.match(/#([a-z0-9]+)〕/);
    expect(m).not.toBeNull();
    expect(display).toContain(makeBadge(m![1], 3));
  });
});
