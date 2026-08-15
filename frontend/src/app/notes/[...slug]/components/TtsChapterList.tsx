'use client';

import React from 'react';
import { formatDuration, type TtsChapterVector } from '@/lib/ttsPlayer';

/**
 * TtsChapterList 的屬性。
 */
interface TtsChapterListProps {
  /** 章節清單（依 startSeconds 遞增）。 */
  chapters: TtsChapterVector[];
  /** 當前章節索引（-1＝無）。 */
  currentIndex: number;
  /** 點擊某章節跳段（傳該章 startSeconds）。 */
  onSeek: (startSeconds: number) => void;
}

/**
 * 章節列表（點擊跳段；當前章節高亮）。
 *
 * 無障礙：當前章節以「顏色＋粗體＋『▸』圖示」三載體標示（顏色非唯一資訊載體，色盲友善）。
 * 每一列是一顆可鍵盤聚焦的按鈕（≥44px 高、有 focus 樣式）。
 */
export function TtsChapterList({ chapters, currentIndex, onSeek }: TtsChapterListProps) {
  if (chapters.length === 0) {
    return (
      <div className="tts-chapters__empty" role="note">
        這篇筆記沒有可跳段的章節。
      </div>
    );
  }

  return (
    <ul className="tts-chapters" aria-label="章節列表">
      {chapters.map((chapter, index) => {
        const isCurrent = index === currentIndex;
        return (
          <li key={`${index}-${chapter.startSeconds}`}>
            <button
              type="button"
              className={`tts-chapters__item${isCurrent ? ' is-current' : ''}`}
              onClick={() => onSeek(chapter.startSeconds)}
              aria-current={isCurrent ? 'true' : undefined}
              title={`跳到「${chapter.title || '章節'}」`}
            >
              <span className="tts-chapters__marker" aria-hidden="true">
                {isCurrent ? '▸' : '·'}
              </span>
              <span className="tts-chapters__title">
                {chapter.title || `章節 ${index + 1}`}
              </span>
              <span className="tts-chapters__time">
                {formatDuration(chapter.startSeconds)}
              </span>
            </button>
          </li>
        );
      })}

      <style jsx>{`
        .tts-chapters {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 40vh;
          overflow-y: auto;
        }

        .tts-chapters__empty {
          padding: var(--spacing-3);
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .tts-chapters__item {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
          width: 100%;
          min-height: 44px;
          padding: var(--spacing-2) var(--spacing-3);
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          text-align: left;
          font-size: var(--text-sm);
          color: var(--text-secondary);
          transition: background 0.15s ease, color 0.15s ease;
        }

        .tts-chapters__item:hover {
          background: var(--bg-surface-secondary);
          color: var(--text-primary);
        }

        /* 按壓態（四態之 active）：章節列點按回饋。 */
        .tts-chapters__item:active {
          background: var(--bg-surface-secondary);
          color: var(--text-primary);
          transform: translateY(1px);
        }

        .tts-chapters__item:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: -2px;
        }

        /* 當前章節：左側藍色邊條＋粗體＋▸ 圖示三載體（文字維持高對比 text-primary，
           不把藍字放在弱對比底上——避免暗/亮主題某些組合掉到 WCAG AA 以下）。 */
        .tts-chapters__item.is-current {
          color: var(--text-primary);
          font-weight: 700;
          border-left: 3px solid var(--action-secondary-fg);
          padding-left: calc(var(--spacing-3) - 3px);
        }

        .tts-chapters__marker {
          flex-shrink: 0;
          width: 1em;
          text-align: center;
          color: inherit;
        }

        /* ▸ 標記在當前章節用藍色（圖示著色，非文字對比要求）。 */
        .tts-chapters__item.is-current .tts-chapters__marker {
          color: var(--action-secondary-fg);
        }

        .tts-chapters__title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tts-chapters__time {
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .tts-chapters__item.is-current .tts-chapters__time {
          color: var(--action-secondary-fg);
        }
      `}</style>
    </ul>
  );
}
