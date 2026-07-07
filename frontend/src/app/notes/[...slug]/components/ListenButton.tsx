'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * 「🎧 聆聽」按鈕（筆記詳情頁工具列）＋底部迷你播放器的協調者。
 *
 * 設計取捨：播放器以 `createPortal` 掛到 `document.body`（而非在頁面 return 樹掛第二處），
 * 讓筆記頁 `page.tsx` 只需新增「這一顆按鈕」單一插入點（範圍紀律，鐵則 #5）；
 * 播放器為 `position:fixed`，透過 portal 避免任何祖先 transform/overflow 影響定位。
 * 合成／輪詢／播放的完整生命週期都收在 TtsMiniPlayer 內。
 */
export function ListenButton({ noteId, noteTitle }: ListenButtonProps) {
  const [open, setOpen] = useState(false);
  // 觸發鈕的參照：關閉播放器時把鍵盤焦點歸還到這裡（a11y 焦點管理）。
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /** 關閉播放器並把焦點歸還觸發鈕。 */
  function handleClose() {
    setOpen(false);
    // 下一個 tick 播放器已卸載，再把焦點移回，避免焦點掉到 <body>。
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary"
        style={{ minHeight: 44, flexShrink: 0 }}
        onClick={() => setOpen(true)}
        title="以 AI 語音朗讀這篇筆記"
        // 播放器為非模態的底部工具列（role="region"），非對話框，故用一般 popup 語意。
        aria-haspopup="true"
        aria-expanded={open}
      >
        🎧 聆聽
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <TtsMiniPlayer
            noteId={noteId}
            noteTitle={noteTitle}
            onClose={handleClose}
          />,
          document.body,
        )}
    </>
  );
}
