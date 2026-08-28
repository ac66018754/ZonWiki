'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  CROP_OUTPUT_SIZE,
  DEFAULT_CROP,
  type CropTransform,
  type DecodedImage,
  clampCrop,
  cropToDataUrl,
  decodeImageFile,
  drawCrop,
} from '@/lib/imageCrop';

/** 編輯區畫布的邊長（CSS 像素）。實際輸出另外以 CROP_OUTPUT_SIZE 重繪。 */
const EDITOR_SIZE = 288;

/** 小預覽的兩種尺寸：對應 Header 圓形圖示（32/40px）的真實顯示大小。 */
const PREVIEW_SIZES = [40, 32] as const;

/**
 * 圓形圖片（品牌標誌 / 大頭貼）的裁切編輯器。
 *
 * 為什麼要有它：先前是「自動置中裁切」，使用者選了一張人像照，結果被切掉半顆頭也不知道。
 * 這裡提供拖曳位移、縮放、旋轉，並且**編輯區與最終輸出共用同一支繪製函式**（見 lib/imageCrop），
 * 所以圓形遮罩內看到的構圖，就是存下來的構圖——不會有「與預期落差」。
 *
 * @param open 是否開啟。
 * @param file 使用者選的圖片檔（open 為 true 時必須有值）。
 * @param title 對話框標題（例如「調整品牌標誌」）。
 * @param onCancel 取消（或關閉）時呼叫。
 * @param onConfirm 按下「套用」時呼叫，帶入裁切後的圖片 data URI。
 */
export function ImageCropModal({
  open,
  file,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  file: File | null;
  title: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  if (!open || !file) return null;
  // 以「檔案身分」當 key：換一張圖就整個重新掛載 → 縮放/旋轉/位移自然回到預設，
  // 不必在 effect 裡同步 setState 重設（那會造成連鎖渲染，也被 lint 擋下）。
  return (
    <CropEditor
      key={`${file.name}:${file.size}:${file.lastModified}`}
      file={file}
      title={title}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * 裁切編輯器本體（由 {@link ImageCropModal} 以 key 控制生命週期，故所有狀態都用初值即可）。
 *
 * @param file 要裁切的圖片檔。
 * @param title 對話框標題。
 * @param onCancel 取消（或關閉）時呼叫。
 * @param onConfirm 按下「套用」時呼叫，帶入裁切後的圖片 data URI。
 */
function CropEditor({
  file,
  title,
  onCancel,
  onConfirm,
}: {
  file: File;
  title: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const [image, setImage] = useState<DecodedImage | null>(null);
  const [crop, setCrop] = useState<CropTransform>(DEFAULT_CROP);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const editorRef = useRef<HTMLCanvasElement | null>(null);
  const previewRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  // 拖曳中的起點（畫面座標）與起始位移；null＝沒在拖。
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // 掛載時解碼圖片；卸載時釋放（ImageBitmap 佔原生記憶體，不會被 GC 及時回收）。
  // 所有 setState 都在非同步回呼裡發生，不在 effect 本體同步呼叫。
  useEffect(() => {
    let alive = true;
    let decoded: DecodedImage | null = null;
    decodeImageFile(file)
      .then((img) => {
        decoded = img;
        if (alive) setImage(img);
        else if ('close' in img && typeof img.close === 'function') img.close();
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '無法讀取這張圖片');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (decoded && 'close' in decoded && typeof decoded.close === 'function') decoded.close();
    };
  }, [file]);

  // 參數或圖片變動 → 重繪編輯區與所有小預覽（同一支 drawCrop，構圖必然一致）。
  useEffect(() => {
    if (!image) return;
    const paint = (canvas: HTMLCanvasElement | null, size: number) => {
      if (!canvas) return;
      // 依裝置像素比放大實際畫布，避免高解析螢幕上糊掉。
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) drawCrop(ctx, image, size * dpr, crop);
    };
    paint(editorRef.current, EDITOR_SIZE);
    PREVIEW_SIZES.forEach((size, i) => paint(previewRefs.current[i], size));
  }, [image, crop]);

  // Esc 關閉。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** 套用一組新參數（自動夾取位移，避免把圖拖出畫面）。 */
  const applyCrop = useCallback(
    (next: CropTransform) => {
      if (!image) return;
      setCrop(clampCrop(next, image));
    },
    [image],
  );

  /** 開始拖曳（記住起點與當下位移；用 pointer capture 讓滑出畫布也能繼續拖）。 */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, offsetX: crop.offsetX, offsetY: crop.offsetY };
  };

  /** 拖曳中：位移量以「編輯區邊長的倍數」累加，與輸出同單位。 */
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start || !image) return;
    applyCrop({
      ...crop,
      offsetX: start.offsetX + (e.clientX - start.x) / EDITOR_SIZE,
      offsetY: start.offsetY + (e.clientY - start.y) / EDITOR_SIZE,
    });
  };

  /** 結束拖曳。 */
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /** 滾輪縮放（往上放大）。 */
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!image) return;
    const next = crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
    applyCrop({ ...crop, zoom: Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, next)) });
  };

  /** 旋轉固定角度（±90° 快捷）。 */
  const rotateBy = (deg: number) => {
    if (!image) return;
    // 保持在 -180~180，滑桿才不會跑到範圍外。
    let next = crop.rotationDeg + deg;
    if (next > 180) next -= 360;
    if (next < -180) next += 360;
    applyCrop({ ...crop, rotationDeg: next });
  };

  return (
    <>
      <div className="modal-overlay" onClick={onCancel} role="presentation" />
      <div
        className="modal crop-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
        </div>

        <div className="modal__body">
          {error && <p className="crop-modal__error">{error}</p>}
          {loading && <p className="crop-modal__hint">讀取圖片中…</p>}

          {!error && (
            <div className="crop-modal__layout">
              {/* 編輯區：圓形遮罩內就是最終構圖；可拖曳、可滾輪縮放 */}
              <div className="crop-modal__stage" style={{ width: EDITOR_SIZE, height: EDITOR_SIZE }}>
                <canvas
                  ref={editorRef}
                  className="crop-modal__canvas"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onWheel={handleWheel}
                  data-testid="crop-canvas"
                />
                {/* 圓形遮罩：畫布外圍打暗，讓使用者一眼看出「圓內才是會被留下的部分」 */}
                <div className="crop-modal__mask" aria-hidden />
              </div>

              <div className="crop-modal__side">
                <div className="crop-modal__previews">
                  <span className="crop-modal__preview-label">實際顯示大小</span>
                  <div className="crop-modal__preview-row">
                    {PREVIEW_SIZES.map((size, i) => (
                      <canvas
                        key={size}
                        ref={(el) => {
                          previewRefs.current[i] = el;
                        }}
                        className="crop-modal__preview"
                        data-testid={`crop-preview-${size}`}
                      />
                    ))}
                  </div>
                </div>

                <label className="crop-modal__control">
                  <span>縮放</span>
                  <input
                    type="range"
                    min={CROP_MIN_ZOOM}
                    max={CROP_MAX_ZOOM}
                    step={0.01}
                    value={crop.zoom}
                    onChange={(e) => applyCrop({ ...crop, zoom: Number(e.target.value) })}
                    data-testid="crop-zoom"
                  />
                </label>

                <label className="crop-modal__control">
                  <span>旋轉 {Math.round(crop.rotationDeg)}°</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={crop.rotationDeg}
                    onChange={(e) => applyCrop({ ...crop, rotationDeg: Number(e.target.value) })}
                    data-testid="crop-rotate"
                  />
                </label>

                <div className="crop-modal__buttons">
                  <button type="button" className="btn-secondary" onClick={() => rotateBy(-90)}>
                    左轉 90°
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => rotateBy(90)}>
                    右轉 90°
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => applyCrop(DEFAULT_CROP)}
                    data-testid="crop-reset"
                  >
                    重設
                  </button>
                </div>

                <p className="crop-modal__hint">拖曳圖片可移動，滾輪可縮放。圓形內就是最終結果。</p>
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!image}
            data-testid="crop-apply"
            onClick={() => {
              if (!image) return;
              try {
                onConfirm(cropToDataUrl(image, crop, CROP_OUTPUT_SIZE));
              } catch (err) {
                setError(err instanceof Error ? err.message : '裁切失敗');
              }
            }}
          >
            套用
          </button>
        </div>
      </div>
    </>
  );
}
