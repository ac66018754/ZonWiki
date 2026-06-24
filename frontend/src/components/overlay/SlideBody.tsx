'use client';

import { useRef, useState } from 'react';
import { safeParse } from '@/lib/drawing/shapes';
import { navBtn, type OverlayItemView } from './overlayShared';

/**
 * 圖片板內容：固定大小（可手動拖曳調整）、可放多張圖片、手動切換（不自動輪播）。
 * 框不會自適應圖片——由使用者決定框的大小，圖片以 contain 顯示。
 * 由 NoteOverlay 抽出，筆記頁浮層與開問啦畫布標註共用。
 */
export function SlideBody({
  item, onImagesChange,
}: {
  item: OverlayItemView;
  onImagesChange: (imgs: string[]) => void;
}) {
  const images: string[] = item.dataJson ? safeParse<string[]>(item.dataJson, []) : [];
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /** 直接上傳/貼上圖片：讀成 data URL 後加入圖片板（不需網址）。 */
  const addImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImagesChange([...images, reader.result]);
        setIdx(images.length);
      }
    };
    reader.readAsDataURL(file);
  };

  const safeIdx = images.length ? idx % images.length : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, position: 'relative', minHeight: 0, background: 'var(--bg-surface-secondary, #1118)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {images.length === 0 ? (
          <span
            style={{ color: '#aaa', fontSize: 'var(--text-xs)', textAlign: 'center', cursor: 'pointer', padding: '0 8px' }}
            onClick={() => fileRef.current?.click()}
            title="點此上傳圖片"
            onPaste={(e) => {
              const it = Array.from(e.clipboardData?.items ?? []).find((x) => x.type.startsWith('image/'));
              const f = it?.getAsFile();
              if (f) { e.preventDefault(); addImageFile(f); }
            }}
          >
            尚無圖片，點此上傳或下方貼上/加網址
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={images[safeIdx]}
            alt={`board-${safeIdx}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        )}
        {images.length > 1 && (
          <>
            <button onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)} style={navBtn('left')} title="上一張">‹</button>
            <button onClick={() => setIdx((i) => (i + 1) % images.length)} style={navBtn('right')} title="下一張">›</button>
            <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center' }}>
              {images.map((_, i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === safeIdx ? '#fff' : 'rgba(255,255,255,0.4)' }} />
              ))}
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 3, padding: '3px', flexShrink: 0 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) addImageFile(f); e.target.value = ''; }}
        />
        <button
          className="tk-btn"
          style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px', flexShrink: 0 }}
          onClick={() => fileRef.current?.click()}
          title="上傳圖片（直接放圖，不需網址）"
          data-testid="slide-upload"
        >
          📁 上傳
        </button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            const it = Array.from(e.clipboardData?.items ?? []).find((x) => x.type.startsWith('image/'));
            const f = it?.getAsFile();
            if (f) { e.preventDefault(); addImageFile(f); }
          }}
          placeholder="或貼上圖片 / 網址…"
          style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', padding: '2px 4px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}
          data-testid="slide-url"
        />
        <button
          className="tk-btn"
          style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px' }}
          disabled={!/^https?:\/\//.test(url.trim())}
          onClick={() => { onImagesChange([...images, url.trim()]); setUrl(''); setIdx(images.length); }}
          data-testid="slide-add"
        >
          加入
        </button>
        {images.length > 0 && (
          <button
            className="tk-btn"
            style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px' }}
            onClick={() => { const next = images.filter((_, i) => i !== safeIdx); onImagesChange(next); setIdx(0); }}
            title="移除目前這張"
          >
            移除
          </button>
        )}
      </div>
    </div>
  );
}
