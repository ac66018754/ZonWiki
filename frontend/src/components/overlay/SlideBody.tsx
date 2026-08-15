'use client';

import { useEffect, useRef, useState } from 'react';
import { navBtn, parseSlideData, STICKY_COLORS, type OverlayItemView } from './overlayShared';
import { ColorPickerInline } from '@/components/ColorPicker';
import { uploadAttachment } from '@/lib/api';
import { toAbsoluteAttachmentUrl } from '@/lib/attachmentUrl';
import { showToast } from '@/lib/toast';

/**
 * 圖片板內容：固定大小（可手動拖曳調整）、可放多張圖片、手動切換（不自動輪播）。
 * 框不會自適應圖片——由使用者決定框的大小，圖片以 contain 顯示。可調整整塊底色（背景顏色）。
 * 由 NoteOverlay 抽出，筆記頁浮層與開問啦畫布標註共用。
 */
export function SlideBody({
  item, onImagesChange, onColor,
}: {
  item: OverlayItemView;
  onImagesChange: (imgs: string[]) => void;
  /** 變更圖片板底色。未提供＝不顯示「背景顏色」鈕（如開問啦畫布標註）。 */
  onColor?: (c: string) => void;
}) {
  const images: string[] = parseSlideData(item.dataJson).images;
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState('');
  const [showBgPalette, setShowBgPalette] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 色盤「選色不關閉、點空白才關閉」（與便利貼一致）：點到色盤本身或其開關鈕以外才收起。
  useEffect(() => {
    if (!showBgPalette) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-slide-pop]') || t?.closest('[data-slide-popbtn]')) return;
      setShowBgPalette(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showBgPalette]);

  // 圖片上傳進行中（顯示提示、避免重複觸發）。
  const [isUploading, setIsUploading] = useState(false);

  /**
   * 直接上傳/貼上圖片：上傳成附件後把「相對短網址」加入圖片板
   * （取代舊的 base64 data URL 內嵌——base64 會灌爆 DataJson；
   * 舊資料裡既有的 data URL 仍相容顯示）。
   */
  const addImageFile = (file: File) => {
    if (!file.type.startsWith('image/') || isUploading) return;
    setIsUploading(true);
    uploadAttachment(file)
      .then((uploaded) => {
        onImagesChange([...images, uploaded.url]);
        setIdx(images.length);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '圖片上傳失敗';
        showToast(message, { type: 'error' });
      })
      .finally(() => setIsUploading(false));
  };

  const safeIdx = images.length ? idx % images.length : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, position: 'relative', minHeight: 0, background: item.color || 'var(--bg-surface-secondary, #1118)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            src={toAbsoluteAttachmentUrl(images[safeIdx])}
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
          disabled={isUploading}
        >
          {isUploading ? '⏳ 上傳中…' : '📁 上傳'}
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
        {onColor && (
          <button
            className="tk-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowBgPalette((v) => !v)}
            title="圖片板背景顏色（點開換色）"
            data-testid="slide-bg-toggle"
            data-slide-popbtn
            style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px', flexShrink: 0, background: showBgPalette ? 'rgba(0,0,0,0.12)' : undefined }}
          >
            🎨
          </button>
        )}
      </div>
      {/* 背景色盤（點 🎨 展開）：完整色盤；選色不關閉，點空白才關閉。 */}
      {showBgPalette && onColor && (
        <div
          data-testid="slide-bg-palette"
          data-slide-pop
          style={{ padding: '6px', borderTop: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.85)', flexShrink: 0, maxHeight: '60%', overflowY: 'auto' }}
        >
          <ColorPickerInline
            initial={item.color ?? STICKY_COLORS[0]}
            onPick={(hex) => onColor(hex)}
          />
        </div>
      )}
    </div>
  );
}
