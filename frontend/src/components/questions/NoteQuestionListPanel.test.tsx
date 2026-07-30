// @vitest-environment jsdom
/**
 * NoteQuestionListPanel 元件契約測試（對抗式復審 HIGH：鎖住「點列項目定位不關閉面板」）。
 *
 * 背景：2026-07-31 修復「點問題清單列項目後面板被關閉」——關閉行為原發生在
 * NoteOverlay.handleLocateQuestion（呼叫 onQuestionPanelOpenChange(false)），已移除。
 * 本測試從面板契約端鎖住：點列項目「只」觸發 onLocate、點答鈕「只」觸發 onAnswer，
 * 兩者都絕不觸發 onClose；onClose 只屬於 ✕ 鈕。若日後有人把「定位順便關面板」
 * 加回任一層（面板內部或上層回呼串接），此測試與 E2E（zonwiki-ui-tests）會一起抓到。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoteQuestionListPanel } from './NoteQuestionListPanel';
import type { NoteOverlayItem } from '@/lib/api/notes';

afterEach(cleanup);

/** 產生最小可用的問題浮層項目（sticky，已標記問題）。 */
function makeQuestion(partial: Partial<NoteOverlayItem> = {}): NoteOverlayItem {
  return {
    id: 'q-1',
    kind: 'sticky',
    x: 0,
    y: 0,
    width: 220,
    height: 180,
    zIndex: 1,
    color: '#FFF9C4',
    text: '這是一個測試問題？',
    dataJson: null,
    isQuestion: true,
    questionAnswer: null,
    ...partial,
  } as NoteOverlayItem;
}

/** 渲染面板並回傳三個 spy（onLocate / onAnswer / onClose）。 */
function renderPanel(questions: NoteOverlayItem[]) {
  const onLocate = vi.fn();
  const onAnswer = vi.fn();
  const onClose = vi.fn();
  render(
    <NoteQuestionListPanel
      questions={questions}
      onLocate={onLocate}
      onAnswer={onAnswer}
      onClose={onClose}
    />
  );
  return { onLocate, onAnswer, onClose };
}

describe('NoteQuestionListPanel 互動契約', () => {
  it('點列項目（定位）→ 只呼叫 onLocate 一次，絕不呼叫 onClose', () => {
    // Arrange
    const { onLocate, onAnswer, onClose } = renderPanel([makeQuestion()]);

    // Act
    fireEvent.click(screen.getByTitle('移動到此問題的位置'));

    // Assert
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith('q-1');
    expect(onClose).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('點「答」鈕 → 只呼叫 onAnswer，絕不呼叫 onClose', () => {
    // Arrange
    const item = makeQuestion();
    const { onLocate, onAnswer, onClose } = renderPanel([item]);

    // Act
    fireEvent.click(screen.getByTitle('開啟答題彈窗'));

    // Assert
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(item);
    expect(onClose).not.toHaveBeenCalled();
    expect(onLocate).not.toHaveBeenCalled();
  });

  it('點 ✕ → 呼叫 onClose（關閉只屬於 ✕ 鈕）', () => {
    // Arrange
    const { onClose } = renderPanel([makeQuestion()]);

    // Act
    fireEvent.click(screen.getByLabelText('關閉'));

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('已作答的問題列顯示「✓ 已答」徽章、未作答不顯示', () => {
    // Arrange
    renderPanel([
      makeQuestion({ id: 'q-a', text: '已答的問題', questionAnswer: '答案內容' }),
      makeQuestion({ id: 'q-b', text: '未答的問題' }),
    ]);

    // Assert
    expect(screen.getAllByTitle('已作答')).toHaveLength(1);
  });
});
