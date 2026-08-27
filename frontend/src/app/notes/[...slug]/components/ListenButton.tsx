'use client';

import React, { useEffect, useRef, useState } from 'react';
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
 * 筆記詳情頁工具列的「聆聽 ▾」下拉，以及底部迷你播放器的協調者。
 *
 * 設計取捨：
 * - 2026-08-28 依使用者裁示改為「一顆按鈕 + 下拉選單」：工具列上只留「聆聽」，
 *   點開才看得到「朗讀（單人）」與「雙人 Podcast」。原本兩顆並排的按鈕太佔工具列寬度。
 * - 兩個選項共用同一顆 <see cref="TtsMiniPlayer"/>，只差朗讀模式（read／dialogue）；同一時間只開一個
 *   （以 openMode 記錄目前開啟的模式，null＝未開）。雙人 Podcast 成本較高，故<b>手動觸發、非預設</b>。
 * - 播放器以 `createPortal` 掛到 `document.body`，`position:fixed`，避免祖先 transform/overflow 影響定位。
 * - 合成／輪詢／播放的完整生命週期都收在 TtsMiniPlayer 內；本元件只負責「開哪個模式」與焦點歸還。
 */
export function ListenButton({ noteId, noteTitle }: ListenButtonProps) {
  // 目前開啟的模式（null＝未開）。切換模式時 key 會變 → 播放器重新掛載並以新模式重合成。
  const [openMode, setOpenMode] = useState<TtsMode | null>(null);
  // 下拉選單是否展開。
  const [menuOpen, setMenuOpen] = useState(false);
  // 觸發鈕的參照：關閉播放器時把鍵盤焦點歸還給它（a11y 焦點管理）。
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // 選單開啟時按 Esc 關閉（與「編輯」下拉一致的鍵盤可用性）。
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  /** 開啟指定模式的播放器並收起選單。 */
  function handleOpen(mode: TtsMode) {
    setMenuOpen(false);
    setOpenMode(mode);
  }

  /** 關閉播放器並把焦點歸還觸發鈕。 */
  function handleClose() {
    setOpenMode(null);
    // 下一個 tick 播放器已卸載，再把焦點移回，避免焦點掉到 <body>。
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary"
        onClick={() => setMenuOpen((v) => !v)}
        title="以 AI 語音朗讀這篇筆記（可選單人朗讀或雙人 Podcast）"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        聆聽 ▾
      </button>

      {menuOpen && (
        <>
          {/* 點空白處關閉選單 */}
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="menu" className="note-topbar__menu">
            <button
              role="menuitem"
              className="note-topbar__menuitem"
              onClick={() => handleOpen('read')}
            >
              朗讀
              <span className="note-topbar__menuitem-desc">單人 AI 語音，逐段朗讀全文</span>
            </button>
            <button
              role="menuitem"
              className="note-topbar__menuitem"
              onClick={() => handleOpen('dialogue')}
            >
              雙人 Podcast
              <span className="note-topbar__menuitem-desc">雙主持人對談；成本較高，手動觸發</span>
            </button>
          </div>
        </>
      )}

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
    </div>
  );
}
