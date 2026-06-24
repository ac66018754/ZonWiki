'use client';

import { STICKY_COLORS, type OverlayItemView } from './overlayShared';

/**
 * 便利貼內容：可編輯文字 + 底色選擇。
 * 由 NoteOverlay 抽出，筆記頁浮層與開問啦畫布標註共用。
 */
export function StickyBody({
  item, onText, onTextCommit, onColor,
}: {
  item: OverlayItemView;
  onText: (t: string) => void;
  onTextCommit: (t: string) => void;
  onColor: (c: string) => void;
}) {
  return (
    <>
      <textarea
        value={item.text ?? ''}
        onChange={(e) => onText(e.target.value)}
        onBlur={(e) => onTextCommit(e.target.value)}
        placeholder="便利貼…"
        style={{
          flex: 1, width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none',
          background: 'transparent', padding: '6px', fontSize: 'var(--text-sm)', color: '#333', outline: 'none',
        }}
        data-testid="sticky-text"
      />
      <div style={{ display: 'flex', gap: 3, padding: '2px 6px', flexShrink: 0 }}>
        {STICKY_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColor(c)}
            title="底色"
            style={{
              width: 14, height: 14, borderRadius: '50%', background: c, cursor: 'pointer',
              border: item.color === c ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            }}
          />
        ))}
      </div>
    </>
  );
}
