'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TtsMode } from '@/lib/api';
import { TtsMiniPlayer } from './TtsMiniPlayer';

/**
 * ListenButton 的屬性。
 */
interface ListenButtonProps {
  /** 來源筆記 ID。 */
  noteId: string;
  /** 筆記標題（傳給播放器抬頭）。 */
  noteTitle: string;
}

/**
 * 「🎧 聆聽」＋「🎙️ 雙人 Podcast」按鈕（筆記詳情頁工具列）＋底部迷你播放器的協調者。
 *
 * 設計取捨：
 * - 兩個入口共用同一顆 <see cref="TtsMiniPlayer"/>，只差朗讀模式（read／dialogue）；同一時間只開一個
 *   （以 openMode 記錄目前開啟的模式，null＝未開）。雙人 Podcast 成本較高，故<b>手動觸發、非預設</b>
 *   （與單人朗讀並列，不搶預設）。
 * - 播放器以 `createPortal` 掛到 `document.body`，`position:fixed`，避免祖先 transform/overflow 影響定位。
 * - 合成／輪詢／播放的完整生命週期都收在 TtsMiniPlayer 內；本元件只負責「開哪個模式」與焦點歸還。
 */
export function ListenButton({ noteId, noteTitle }: ListenButtonProps) {
  // 目前開啟的模式（null＝未開）。切換模式時 key 會變 → 播放器重新掛載並以新模式重合成。
  const [openMode, setOpenMode] = useState<TtsMode | null>(null);
  // 觸發鈕的參照：關閉播放器時把鍵盤焦點歸還到「最後按下的那顆」（a11y 焦點管理）。
  const readBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogueBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  /** 開啟指定模式的播放器並記住觸發鈕。 */
  function handleOpen(mode: TtsMode, trigger: HTMLButtonElement | null) {
    lastTriggerRef.current = trigger;
    setOpenMode(mode);
  }

  /** 關閉播放器並把焦點歸還最後的觸發鈕。 */
  function handleClose() {
    setOpenMode(null);
    // 下一個 tick 播放器已卸載，再把焦點移回，避免焦點掉到 <body>。
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={readBtnRef}
        type="button"
        className="btn-secondary"
        style={{ minHeight: 44, flexShrink: 0 }}
        onClick={() => handleOpen('read', readBtnRef.current)}
        title="以 AI 語音朗讀這篇筆記"
        aria-haspopup="true"
        aria-expanded={openMode === 'read'}
      >
        🎧 聆聽
      </button>

      <button
        ref={dialogueBtnRef}
        type="button"
        className="btn-secondary"
        style={{ minHeight: 44, flexShrink: 0 }}
        onClick={() => handleOpen('dialogue', dialogueBtnRef.current)}
        title="以雙主持人對談方式生成 Podcast（成本較高，手動觸發）"
        aria-haspopup="true"
        aria-expanded={openMode === 'dialogue'}
      >
        🎙️ 雙人 Podcast
      </button>

      {openMode !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <TtsMiniPlayer
            // key 帶 mode：切換模式時強制重新掛載，確保以新模式重跑合成生命週期。
            key={openMode}
            noteId={noteId}
            noteTitle={noteTitle}
            mode={openMode}
            onClose={handleClose}
          />,
          document.body,
        )}
    </>
  );
}
