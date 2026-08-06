// @vitest-environment jsdom
/**
 * MarkdownEditor 契約測試：本次「答題彈窗回答區」兩個新可選行為＋既有行為回歸守衛。
 *
 * 涵蓋（對應測試計畫 A1~A12）：
 * - defaultView：初始檢視模式可由呼叫端指定（答題彈窗要「預設預覽」）；不傳＝維持既有預設「編輯」。
 * - rightClickTogglesEdit：預覽檢視中「快速連點兩下右鍵」切回編輯，且一律抑制瀏覽器右鍵選單；
 *   間隔判定 pin 在 Date.now()（測試以 vi.spyOn(Date,'now') 控制間隔，不開 fake timers——
 *   vitest 3 預設會 fake 掉整組計時 API，會誤傷 rAF focus 與彈出視窗的 1 秒輪詢 interval）。
 * - popoutAlwaysOnTop：「⬈ 彈出預覽」優先走 Document Picture-in-Picture（OS 置頂視窗）；
 *   不支援（Firefox/Safari/舊版）→ 退回既有 window.open；未啟用（既有呼叫端）→ 一律 window.open。
 *
 * 環境防呆（復審修訂）：
 * - jsdom 26 沒有 BroadcastChannel（目前能動是 Node 全域殘留）→ 顯式 stubGlobal，不賭環境。
 * - jsdom 的 window.open 是 Not implemented → spy 一律 mockReturnValue 假視窗，避免穿透噪音。
 * - PiP 假視窗以 EventTarget 為基底＋createHTMLDocument：portal 與 pagehide 派發都吃真 DOM 事件機制。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MarkdownEditor } from './MarkdownEditor';

// 換掉重依賴（react-markdown/remark-gfm/highlight.js）：stub 直接吐出原文，斷言內容仍可行。
vi.mock('@/components/MarkdownPreview', () => ({
  ToggleAwareMarkdown: ({ value }: { value: string }) => <div data-testid="md-stub">{value}</div>,
}));
vi.mock('@/lib/api', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

/** 受控的 Date.now：以變數回傳，逐案例撥動時間（不影響其他計時 API）。 */
let fakeNow = 100_000;

/** window.open 的假回傳視窗（避免 jsdom Not implemented；供輪詢 .closed 與卸載 close()）。 */
function makeFakeLegacyWindow() {
  return { focus: vi.fn(), close: vi.fn(), closed: false } as unknown as Window;
}

/** Document PiP 的假視窗：EventTarget 基底（pagehide 走真事件派發）＋獨立 HTML 文件（portal 目標）。 */
function makeFakePipWindow() {
  const win = new EventTarget() as EventTarget & {
    document: Document;
    close: ReturnType<typeof vi.fn>;
    closed: boolean;
    focus: ReturnType<typeof vi.fn>;
  };
  win.document = document.implementation.createHTMLDocument('pip');
  win.close = vi.fn();
  win.closed = false;
  win.focus = vi.fn();
  return win;
}

/** 有狀態的測試殼：讓受控元件可被 fireEvent.change 真正改值（驗 PiP 即時同步）。 */
function Harness({
  initial = '',
  ...rest
}: { initial?: string } & Partial<Omit<React.ComponentProps<typeof MarkdownEditor>, 'value' | 'onChange'>>) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor value={value} onChange={setValue} withPreview {...rest} />;
}

/** 取內嵌預覽窗格（注意：不可用 .md-preview——答題彈窗的問題框也有這個 class）。 */
const previewPane = () => document.querySelector('.mde-preview');
/** 取編輯 textarea（預設 aria-label）。 */
const editorTextarea = () => screen.queryByRole('textbox', { name: 'Markdown 編輯器' });

beforeEach(() => {
  fakeNow = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: unknown = null;
      postMessage() {}
      close() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
});

describe('defaultView（A1/A2）', () => {
  it('A1: defaultView="preview" → 初始顯示預覽窗格、無編輯 textarea、「預覽」鈕 active', () => {
    render(<Harness initial="哈囉" defaultView="preview" />);
    expect(previewPane()).not.toBeNull();
    expect(editorTextarea()).toBeNull();
    expect(screen.getByRole('button', { name: '預覽' }).className).toContain('mde-view-btn--on');
  });

  it('A2: 不傳 defaultView → 維持既有預設「編輯」（textarea 存在、無預覽窗格）', () => {
    render(<Harness initial="哈囉" />);
    expect(editorTextarea()).not.toBeNull();
    expect(previewPane()).toBeNull();
    expect(screen.getByRole('button', { name: '編輯' }).className).toContain('mde-view-btn--on');
  });
});

describe('rightClickTogglesEdit（A3~A6、A12）', () => {
  it('A3: 預覽中快速連點兩下右鍵（<500ms）→ 切到編輯，且兩次 contextmenu 都被 preventDefault', () => {
    render(<Harness initial="內容" defaultView="preview" rightClickTogglesEdit />);
    const pane = previewPane()!;
    const first = fireEvent.contextMenu(pane); // fireEvent 回傳值＝dispatchEvent 結果；被 preventDefault 過＝false
    fakeNow += 400;
    const second = fireEvent.contextMenu(pane);
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(editorTextarea()).not.toBeNull();
    expect(screen.getByRole('button', { name: '編輯' }).className).toContain('mde-view-btn--on');
  });

  it('A4: 單次右鍵 → 不切換（仍預覽），但仍抑制瀏覽器右鍵選單', () => {
    render(<Harness initial="內容" defaultView="preview" rightClickTogglesEdit />);
    const notPrevented = fireEvent.contextMenu(previewPane()!);
    expect(notPrevented).toBe(false);
    expect(editorTextarea()).toBeNull();
    expect(previewPane()).not.toBeNull();
  });

  it('A5: 兩次右鍵間隔 >500ms → 不切換', () => {
    render(<Harness initial="內容" defaultView="preview" rightClickTogglesEdit />);
    fireEvent.contextMenu(previewPane()!);
    fakeNow += 600;
    fireEvent.contextMenu(previewPane()!);
    expect(editorTextarea()).toBeNull();
  });

  it('A6: 未啟用 rightClickTogglesEdit → 右鍵不被攔截、不切換（既有行為回歸守衛）', () => {
    render(<Harness initial="內容" defaultView="preview" />);
    const pane = previewPane()!;
    const first = fireEvent.contextMenu(pane);
    fakeNow += 100;
    const second = fireEvent.contextMenu(pane);
    expect(first).toBe(true); // 未 preventDefault
    expect(second).toBe(true);
    expect(editorTextarea()).toBeNull();
  });

  it('A12: split（並排）檢視雙右鍵 → 不切換、不 preventDefault（手勢只綁「預覽」檢視）', () => {
    render(<Harness initial="內容" defaultView="split" rightClickTogglesEdit />);
    const pane = previewPane()!;
    const first = fireEvent.contextMenu(pane);
    fakeNow += 100;
    const second = fireEvent.contextMenu(pane);
    expect(first).toBe(true);
    expect(second).toBe(true);
    // 仍是並排：編輯與預覽同時存在。
    expect(editorTextarea()).not.toBeNull();
    expect(previewPane()).not.toBeNull();
    expect(screen.getByRole('button', { name: '並排' }).className).toContain('mde-view-btn--on');
  });

  it('操作提示：啟用手勢時預覽窗格帶右鍵操作說明（可發現性）', () => {
    render(<Harness initial="內容" defaultView="preview" rightClickTogglesEdit />);
    expect(previewPane()!.getAttribute('title') || '').toContain('右鍵');
  });
});

describe('popoutAlwaysOnTop（A7~A11）', () => {
  it('A7: 瀏覽器不支援 Document PiP → 退回既有 window.open，且文案不假承諾「置頂」', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeFakeLegacyWindow());
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    const btn = screen.getByRole('button', { name: /彈出預覽/ });
    expect(btn.getAttribute('title') || '').toContain('不支援置頂');
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe('/notes/preview-popout');
  });

  it('A8: 支援 PiP → requestWindow 開置頂視窗、不走 window.open、內容渲染進 PiP 文件', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeFakeLegacyWindow());
    const pip = makeFakePipWindow();
    const requestWindow = vi.fn(async () => pip as unknown as Window);
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };

    render(<Harness initial="置頂內容驗證" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {}); // 等 requestWindow promise 解決＋portal 掛載

    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    expect(within(pip.document.body).getByText('置頂內容驗證')).toBeTruthy();
    // 彈出後：按鈕變「收回預覽」、編輯區全寬可編輯。
    expect(screen.getByRole('button', { name: /收回預覽/ })).toBeTruthy();
    expect(editorTextarea()).not.toBeNull();
  });

  it('A9: PiP 開啟中編輯內容 → PiP 即時同步（portal 吃 live state）', async () => {
    const pip = makeFakePipWindow();
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(async () => pip as unknown as Window),
    };
    render(<Harness initial="原文" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {});

    fireEvent.change(editorTextarea()!, { target: { value: '改過的內容' } });
    expect(within(pip.document.body).getByText('改過的內容')).toBeTruthy();
  });

  it('A10: PiP 視窗被關（pagehide）→ 恢復未彈出狀態（按鈕與內嵌預覽回來）', async () => {
    const pip = makeFakePipWindow();
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(async () => pip as unknown as Window),
    };
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: /收回預覽/ })).toBeTruthy();

    await act(async () => {
      pip.dispatchEvent(new Event('pagehide'));
    });
    expect(screen.getByRole('button', { name: /彈出預覽/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /收回預覽/ })).toBeNull();
  });

  it('A10b: 按「⇲ 收回預覽」→ 呼叫 pipWindow.close() 並恢復未彈出狀態', async () => {
    const pip = makeFakePipWindow();
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(async () => pip as unknown as Window),
    };
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: /收回預覽/ }));
    expect(pip.close).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /彈出預覽/ })).toBeTruthy();
  });

  it('A11: 未啟用 popoutAlwaysOnTop（既有呼叫端）→ 即使瀏覽器支援 PiP 仍走 window.open', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeFakeLegacyWindow());
    const requestWindow = vi.fn(async () => makeFakePipWindow() as unknown as Window);
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };

    render(<Harness initial="內容" />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('A13: requestWindow 失敗（reject）→ 退回 window.open 且狀態正確（復審 HIGH 防護）', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeFakeLegacyWindow());
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(async () => { throw new Error('denied'); }),
    };
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {});
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /收回預覽/ })).toBeTruthy();
  });

  it('A14: window.open 被攔截（回 null）→ 不進入彈出狀態、以 toast 告知（不留假態）', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(async () => { throw new Error('denied'); }),
    };
    const { showToast } = await import('@/lib/toast');
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    await act(async () => {});
    // 仍是「彈出預覽」（沒有假裝已彈出），且使用者有收到攔截提示。
    expect(screen.getByRole('button', { name: /彈出預覽/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /收回預覽/ })).toBeNull();
    expect(vi.mocked(showToast)).toHaveBeenCalled();
  });

  it('A15: 「彈出預覽」快速連點兩下 → requestWindow 只被呼叫一次（防併發雙視窗）', async () => {
    let resolveReq: ((w: Window) => void) | undefined;
    const requestWindow = vi.fn(() => new Promise<Window>((res) => { resolveReq = res; }));
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };
    render(<Harness initial="內容" popoutAlwaysOnTop />);
    const btn = screen.getByRole('button', { name: /彈出預覽/ });
    fireEvent.click(btn);
    fireEvent.click(btn); // pending 期間第二擊
    expect(requestWindow).toHaveBeenCalledTimes(1);
    await act(async () => { resolveReq?.(makeFakePipWindow() as unknown as Window); });
  });

  it('A16: PiP 請求 pending 期間元件卸載 → resolve 後直接關掉視窗、不留孤兒（復審 HIGH 防護）', async () => {
    let resolveReq: ((w: Window) => void) | undefined;
    const requestWindow = vi.fn(() => new Promise<Window>((res) => { resolveReq = res; }));
    (window as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };
    const { unmount } = render(<Harness initial="內容" popoutAlwaysOnTop />);
    fireEvent.click(screen.getByRole('button', { name: /彈出預覽/ }));
    unmount(); // 答題彈窗被關 → MarkdownEditor 卸載
    const pip = makeFakePipWindow();
    await act(async () => { resolveReq?.(pip as unknown as Window); });
    expect(pip.close).toHaveBeenCalled();
  });
});
