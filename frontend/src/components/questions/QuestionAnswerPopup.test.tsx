// @vitest-environment jsdom
/**
 * QuestionAnswerPopup 整合契約測試（對應測試計畫 B1/B2）：
 * 鎖住「答題彈窗的回答區」有把新行為接上 MarkdownEditor——
 * B1: 打開彈窗時回答區預設是「預覽」模式（不是編輯）。
 * B2: 在回答預覽區快速連點兩下右鍵 → 切換成編輯模式。
 *
 * 只驗彈窗↔編輯器的接線；手勢細節（間隔閾值、preventDefault、split 不觸發…）
 * 由 MarkdownEditor.test.tsx 的 A 系列負責，不在此重複。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestionAnswerPopup } from './QuestionAnswerPopup';

// 隔離外部依賴：API 呼叫、重量級 Markdown 渲染鏈、附件上傳與 toast（barrel 匯入鏈一併 stub）。
vi.mock('@/lib/api/notes', () => ({
  askNoteQuestion: vi.fn(),
  updateNoteOverlay: vi.fn(),
}));
vi.mock('@/components/MarkdownPreview', () => ({
  ToggleAwareMarkdown: ({ value }: { value: string }) => <div data-testid="md-stub">{value}</div>,
}));
vi.mock('@/lib/api', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

/** 受控 Date.now（雙右鍵間隔判定 pin 在 Date.now()；不開 fake timers）。 */
let fakeNow = 500_000;

/** 渲染答題彈窗（sticky 來源、已有既存回答）。 */
function renderPopup() {
  return render(
    <QuestionAnswerPopup
      itemId="item-1"
      noteId="note-1"
      kind="sticky"
      questionTitle="測試問題標題"
      questionText="這是問題內文？"
      initialAnswer="既有的回答內容"
      offsetIndex={0}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

/** 回答編輯器的 textarea（存在＝編輯模式）。 */
const answerTextarea = () => screen.queryByRole('textbox', { name: '問題回答編輯器' });
/** 回答編輯器的內嵌預覽窗格（.mde-preview 只屬於 MarkdownEditor；問題框只有 .md-preview）。 */
const answerPreviewPane = () => document.querySelector('.mde-preview');

beforeEach(() => {
  fakeNow = 500_000;
  vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('答題彈窗回答區的預設模式與右鍵切換', () => {
  it('B1: 打開彈窗 → 回答區預設是預覽模式（無編輯 textarea、有預覽窗格且顯示既有回答）', () => {
    renderPopup();
    expect(answerTextarea()).toBeNull();
    const pane = answerPreviewPane();
    expect(pane).not.toBeNull();
    expect(pane!.textContent).toContain('既有的回答內容');
  });

  it('B2: 在回答預覽區快速連點兩下右鍵 → 切換成編輯模式（textarea 出現）', () => {
    renderPopup();
    const pane = answerPreviewPane()!;
    fireEvent.contextMenu(pane);
    fakeNow += 300;
    fireEvent.contextMenu(pane);
    expect(answerTextarea()).not.toBeNull();
  });
});
