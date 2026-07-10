'use client';

import { createPortal } from 'react-dom';
import type { NoteOverlayItem } from '@/lib/api/notes';
import { deriveQuestionTitle } from '@/lib/questionTitle';

/**
 * 筆記頁「問題清單」面板的屬性。
 */
interface NoteQuestionListPanelProps {
  /** 本篇被標記為問題的浮層元件（sticky / text）。 */
  questions: NoteOverlayItem[];
  /** 點列項目：捲動定位到該問題並高亮。 */
  onLocate: (itemId: string) => void;
  /** 點「答」：開啟該問題的答題彈窗。 */
  onAnswer: (item: NoteOverlayItem) => void;
  /** 關閉面板。 */
  onClose: () => void;
}

/** 浮層型別對應的小圖示（便利貼 / T 文字框）。 */
function kindIcon(kind: string): string {
  return kind === 'text' ? '🔤' : '🗒';
}

/** 是否已作答：與後端 QuestionEndpoints 的 !string.IsNullOrEmpty 一致（非 null 且非空字串，不 trim）。 */
function hasAnswer(item: NoteOverlayItem): boolean {
  return item.questionAnswer != null && item.questionAnswer !== '';
}

/**
 * 筆記頁「問題清單」面板：列出本篇所有問題（便利貼標題 / T 文字前段），
 * 點列項目→捲動定位＋高亮；每列最右「答」鈕→開答題彈窗。右側浮動面板（portal 到 body）。
 */
export function NoteQuestionListPanel({ questions, onLocate, onAnswer, onClose }: NoteQuestionListPanelProps) {
  // 面板僅在使用者開啟後（客戶端）渲染，不會出現在 SSR 初始 HTML，故可直接 portal 到 body。
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="問題清單"
      style={{
        position: 'fixed',
        top: 96,
        right: 24,
        width: 320,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 140px)',
        zIndex: 1600,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
        overflow: 'hidden',
      }}
    >
      {/* 標題列 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          padding: 'var(--spacing-2) var(--spacing-3)',
          background: 'var(--action-secondary-bg, rgba(0,0,0,0.06))',
          color: 'var(--action-secondary-fg, var(--text-primary))',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, flex: 1 }}>
          ❓ 問題清單 ({questions.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          title="關閉"
          aria-label="關閉"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 'var(--text-md)',
            lineHeight: 1,
            padding: 2,
          }}
        >
          ✕
        </button>
      </div>

      {/* 清單 / 空狀態 */}
      <div style={{ overflowY: 'auto', padding: 'var(--spacing-1)' }}>
        {questions.length === 0 ? (
          <div style={{ padding: 'var(--spacing-4)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.7 }}>
            本篇尚無問題。<br />
            把便利貼或 T 文字框標記為問題（❓）後會出現在這裡。
          </div>
        ) : (
          questions.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                padding: 'var(--spacing-2)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {/* 列身：點擊定位 */}
              <button
                type="button"
                onClick={() => onLocate(item.id)}
                title="移動到此問題的位置"
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text-primary)',
                  padding: 'var(--spacing-1)',
                }}
              >
                <span aria-hidden style={{ flexShrink: 0 }}>{kindIcon(item.kind)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deriveQuestionTitle(item.kind, item.text, item.dataJson)}
                </span>
                {hasAnswer(item) && (
                  <span
                    title="已作答"
                    style={{
                      flexShrink: 0,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--action-success-fg, var(--color-success, #16a34a))',
                      border: '1px solid currentColor',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0 4px',
                    }}
                  >
                    ✓ 已答
                  </span>
                )}
              </button>
              {/* 答鈕 */}
              <button
                type="button"
                onClick={() => onAnswer(item)}
                className="btn-secondary"
                style={{ flexShrink: 0, fontSize: 'var(--text-xs)', padding: '2px 10px', minHeight: 0 }}
                title="開啟答題彈窗"
              >
                答
              </button>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}
