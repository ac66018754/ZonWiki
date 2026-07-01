'use client';

import React, { useState } from 'react';
import { reformatNote, beautifyNote } from '@/lib/api';

interface NoteAiActionsProps {
  /** 筆記 ID */
  noteId: string;
  /** 目前的 Markdown 內容 */
  currentContent: string;
  /** HTML 內容更新回調 */
  onContentUpdate?: (contentRaw: string, contentHtml: string) => void;
  /** 設定錯誤提示 */
  onError?: (message: string) => void;
  /** 由上層停用（例如「保存」進行中）；停用時不可觸發 AI。 */
  disabled?: boolean;
  /** AI 忙碌狀態變更回調（讓上層在 AI 進行中停用「保存」，避免兩者重疊）。 */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * AI 排版調整與美化按鈕組
 * - 調整排版: POST /api/notes/{id}/reformat
 * - 美化內容: POST /api/notes/{id}/beautify
 */
export function NoteAiActions({
  noteId,
  currentContent,
  onContentUpdate,
  onError,
  disabled = false,
  onBusyChange,
}: NoteAiActionsProps) {
  const [isReformatting, setIsReformatting] = useState(false);
  const [isBeautifying, setIsBeautifying] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);

  // 調整排版
  const handleReformat = async () => {
    if (isReformatting || isBeautifying || disabled) return;

    try {
      setIsReformatting(true);
      onBusyChange?.(true);
      // 保存當前內容到撤銷堆疊
      setUndoStack([currentContent, ...undoStack].slice(0, 10));
      setCanUndo(true);

      // 對「目前編輯器內容」做轉換（後端不落地）。
      const result = await reformatNote(noteId, currentContent);
      if (result) {
        onContentUpdate?.(result.contentRaw, result.contentHtml);
      } else {
        onError?.('排版調整失敗，請稍後重試。');
      }
    } catch (err) {
      onError?.(
        err instanceof Error
          ? err.message
          : '排版調整出錯，請稍後重試。'
      );
    } finally {
      setIsReformatting(false);
      onBusyChange?.(false);
    }
  };

  // 美化內容
  const handleBeautify = async () => {
    if (isReformatting || isBeautifying || disabled) return;

    try {
      setIsBeautifying(true);
      onBusyChange?.(true);
      // 保存當前內容到撤銷堆疊
      setUndoStack([currentContent, ...undoStack].slice(0, 10));
      setCanUndo(true);

      const result = await beautifyNote(noteId, currentContent);
      if (result) {
        onContentUpdate?.(result.contentRaw, result.contentHtml);
      } else {
        onError?.('美化內容失敗，請稍後重試。');
      }
    } catch (err) {
      onError?.(
        err instanceof Error
          ? err.message
          : '美化內容出錯，請稍後重試。'
      );
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
    setCanUndo(rest.length > 0);
    onContentUpdate?.(previous, ''); // 傳空字串，讓上層重新渲染 HTML
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--spacing-2)',
        alignItems: 'center',
      }}
    >
      <button
        onClick={handleReformat}
        disabled={isReformatting || isBeautifying || disabled}
        className="btn-secondary"
        title="用 AI 調整排版 (更好的段落、格式、換行)"
        style={{
          fontSize: 'var(--text-sm)',
          opacity: isReformatting ? 0.6 : 1,
        }}
      >
        {isReformatting ? '⚙️ 調整中...' : '⚙️ 調整排版'}
      </button>

      <button
        onClick={handleBeautify}
        disabled={isReformatting || isBeautifying || disabled}
        className="btn-secondary"
        title="用 AI 美化內容 (改進措詞、流暢度、表達)"
        style={{
          fontSize: 'var(--text-sm)',
          opacity: isBeautifying ? 0.6 : 1,
        }}
      >
        {isBeautifying ? '✨ 美化中...' : '✨ 美化內容'}
      </button>

      {canUndo && (
        <button
          onClick={handleUndo}
          disabled={isReformatting || isBeautifying}
          className="btn-secondary"
          title="撤銷上一次 AI 操作"
          style={{
            fontSize: 'var(--text-sm)',
            opacity: isReformatting || isBeautifying ? 0.6 : 1,
          }}
        >
          ↶ 撤銷
        </button>
      )}
    </div>
  );
}
