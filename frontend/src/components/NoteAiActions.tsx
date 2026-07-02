'use client';

import React, { useState } from 'react';
import { reformatNote, beautifyNote, type AiTransformResult } from '@/lib/api';
import { maskProtectedRegions, restoreProtectedRegions } from '@/lib/toggleBlocks';

interface NoteAiActionsProps {
  /** 筆記 ID */
  noteId: string;
  /** 目前的 Markdown 內容 */
  currentContent: string;
  /** 內容更新回調（第二參數 HTML 目前上層忽略、由編輯預覽即時重算）。 */
  onContentUpdate?: (contentRaw: string, contentHtml: string) => void;
  /** 設定錯誤提示 */
  onError?: (message: string) => void;
  /** 由上層停用（例如「保存」進行中）；停用時不可觸發 AI。 */
  disabled?: boolean;
  /** AI 忙碌狀態變更回調（讓上層在 AI 進行中停用「保存」，避免兩者重疊）。 */
  onBusyChange?: (busy: boolean) => void;
  /** 編輯器 textarea 參考：供「局部排版（重排選取範圍）」讀取目前選取位置。 */
  taRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * AI 排版調整與美化按鈕組。
 * - 調整排版（整篇）: POST /api/notes/{id}/reformat
 * - 重排選取: 只重排編輯器目前選取的範圍，其餘一字不動（局部排版）。
 * - 美化內容: POST /api/notes/{id}/beautify
 *
 * 保護區塊（`:::protect … :::`）在送 AI 前一律被「抽掉、換成占位符」，AI 完全看不到其內容；
 * 回來後再原樣換回並驗證（占位符若遺失則放棄套用、保留原內容），確保「不想動的地方」絕不被改。
 */
export function NoteAiActions({
  noteId,
  currentContent,
  onContentUpdate,
  onError,
  disabled = false,
  onBusyChange,
  taRef,
}: NoteAiActionsProps) {
  const [isReformatting, setIsReformatting] = useState(false);
  const [isBeautifying, setIsBeautifying] = useState(false);
  const [isPartial, setIsPartial] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);

  const busy = isReformatting || isBeautifying || isPartial;
  const canUndo = undoStack.length > 0;

  const pushUndo = () => setUndoStack((s) => [currentContent, ...s].slice(0, 10));
  const errMsg = (err: unknown, label: string) =>
    err instanceof Error ? err.message : `${label}出錯，請稍後重試。`;

  /**
   * 遮罩保護區 → 呼叫 AI → 還原保護區並驗證。
   * @returns 處理後內容；失敗（AI 無結果或保護區還原失敗）回 null（已透過 onError 提示）。
   */
  const transformWithProtect = async (
    label: string,
    content: string,
    apiFn: (id: string, c: string) => Promise<AiTransformResult | null>,
  ): Promise<string | null> => {
    const { masked, regions } = maskProtectedRegions(content);
    const result = await apiFn(noteId, masked);
    if (!result) {
      onError?.(`${label}失敗，請稍後重試。`);
      return null;
    }
    const { restored, ok } = restoreProtectedRegions(result.contentRaw, regions);
    if (!ok) {
      onError?.(`${label}：保護區還原失敗，未套用（保護內容保持原樣）。`);
      return null;
    }
    return restored;
  };

  // 調整排版（整篇）
  const handleReformat = async () => {
    if (busy || disabled) return;
    try {
      setIsReformatting(true);
      onBusyChange?.(true);
      pushUndo();
      const next = await transformWithProtect('排版調整', currentContent, reformatNote);
      if (next != null) onContentUpdate?.(next, '');
    } catch (err) {
      onError?.(errMsg(err, '排版調整'));
    } finally {
      setIsReformatting(false);
      onBusyChange?.(false);
    }
  };

  // 重排選取範圍（局部排版）：只把選取的那段送 AI 重排，其餘一字不動。
  const handleReformatSelection = async () => {
    if (busy || disabled) return;
    const ta = taRef?.current;
    if (!ta) {
      onError?.('無法取得編輯器選取範圍。');
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start >= end) {
      onError?.('請先在編輯器反白選取要重排的範圍。');
      return;
    }
    const selected = currentContent.slice(start, end);
    try {
      setIsPartial(true);
      onBusyChange?.(true);
      pushUndo();
      const next = await transformWithProtect('局部排版', selected, reformatNote);
      if (next != null) {
        // 去掉結果尾端多餘換行，避免與後段之間多出空行；其餘原樣接回。
        const merged = currentContent.slice(0, start) + next.replace(/\n+$/, '') + currentContent.slice(end);
        onContentUpdate?.(merged, '');
      }
    } catch (err) {
      onError?.(errMsg(err, '局部排版'));
    } finally {
      setIsPartial(false);
      onBusyChange?.(false);
    }
  };

  // 美化內容（整篇）
  const handleBeautify = async () => {
    if (busy || disabled) return;
    try {
      setIsBeautifying(true);
      onBusyChange?.(true);
      pushUndo();
      const next = await transformWithProtect('美化內容', currentContent, beautifyNote);
      if (next != null) onContentUpdate?.(next, '');
    } catch (err) {
      onError?.(errMsg(err, '美化內容'));
    } finally {
      setIsBeautifying(false);
      onBusyChange?.(false);
    }
  };

  // 撤銷
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const [previous, ...rest] = undoStack;
    setUndoStack(rest);
    onContentUpdate?.(previous, '');
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        onClick={handleReformat}
        disabled={busy || disabled}
        className="btn-secondary"
        title="用 AI 調整整篇排版（保護區塊會被跳過、保持原樣）"
        style={{ fontSize: 'var(--text-sm)', opacity: isReformatting ? 0.6 : 1 }}
      >
        {isReformatting ? '⚙️ 調整中...' : '⚙️ 調整排版'}
      </button>

      <button
        onClick={handleReformatSelection}
        disabled={busy || disabled}
        className="btn-secondary"
        title="只重排編輯器目前反白選取的那段，其餘一字不動（局部排版）"
        style={{ fontSize: 'var(--text-sm)', opacity: isPartial ? 0.6 : 1 }}
      >
        {isPartial ? '🖊 重排中...' : '🖊 重排選取'}
      </button>

      <button
        onClick={handleBeautify}
        disabled={busy || disabled}
        className="btn-secondary"
        title="用 AI 美化內容（改進措詞、流暢度；保護區塊會被跳過）"
        style={{ fontSize: 'var(--text-sm)', opacity: isBeautifying ? 0.6 : 1 }}
      >
        {isBeautifying ? '✨ 美化中...' : '✨ 美化內容'}
      </button>

      {canUndo && (
        <button
          onClick={handleUndo}
          disabled={busy}
          className="btn-secondary"
          title="撤銷上一次 AI 操作"
          style={{ fontSize: 'var(--text-sm)', opacity: busy ? 0.6 : 1 }}
        >
          ↶ 撤銷
        </button>
      )}
    </div>
  );
}
