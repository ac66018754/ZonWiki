'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  listNoteOverlay,
  createNoteOverlay,
  updateNoteOverlay,
  deleteNoteOverlay,
  type NoteOverlayItem,
} from '@/lib/api';
import { logger } from '@/lib/logger';
import { ColorPickerInline } from '@/components/ColorPicker';
import { pushUndo } from '@/lib/undoManager';

/** 便利貼可選底色。 */
const STICKY_COLORS = ['#fff9c4', '#ffe0b2', '#c8e6c9', '#bbdefb', '#f8bbd0', '#e1bee7'];

/**
 * 繪圖工具。null＝不繪圖（一般互動：可選文字、拖便利貼）。
 * erase-stroke＝整筆刪除（點一筆即刪整筆）；erase-area＝局部擦除（擦到哪、那裏消失）。
 */
type DrawTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'erase-stroke' | 'erase-area' | null;

/** 一個繪圖形狀。free＝多點折線；line/rect/ellipse＝起訖兩點。 */
interface Shape {
  type: 'free' | 'line' | 'rect' | 'ellipse';
  color: string;
  width: number;
  dash?: boolean;
  points: [number, number][];
}

interface Props {
  /** 筆記 ID。 */
  noteId: string;
  /** 內文容器（.markdown-prose）參考；浮層覆蓋其上。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 筆記浮層：在內文最上層疊加「便利貼 / 手繪塗鴉 / 圖片輪播」，可隨意擺放、覆蓋所有內容。
 * 全部持久化於資料庫（取代舊的 localStorage 浮動白板）。
 *
 * 繪圖工具：自由筆、直線、矩形、橢圓、兩種橡皮擦（整筆刪除 / 局部擦除）；
 * 可選顏色（完整色盤）、線寬（同時作為局部橡皮擦半徑）、虛線；可清除。
 * 復原 / 重做交由共用的 {@link pushUndo}（與「畫重點」共用同一條 Ctrl+Z 堆疊）。
 *
 * 工具列以 portal 固定在視窗右上角（position:fixed），捲動內文時不會被滑掉（#6）。
 * 浮層容器 pointer-events:none；繪圖中時 SVG 捕捉指標、便利貼暫不可拖；未繪圖時指標穿透、便利貼可互動，
 * 故不影響底下文字選取（#5 標註）。
 */
export function NoteOverlay({ noteId, containerRef }: Props) {
  const [items, setItems] = useState<NoteOverlayItem[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [mounted, setMounted] = useState(false);

  // 繪圖工具狀態
  const [tool, setTool] = useState<DrawTool>(null);
  const [penColor, setPenColor] = useState('#ef4444');
  const [penWidth, setPenWidth] = useState(3);
  const [penDash, setPenDash] = useState(false);
  const [showPenColor, setShowPenColor] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    listNoteOverlay(noteId).then((list) => {
      if (alive) setItems(list);
    });
    return () => { alive = false; };
  }, [noteId]);

  // 量測內文容器尺寸（繪圖 SVG 用）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const maxZ = items.reduce((m, i) => Math.max(m, i.zIndex), 0);

  const patchLocal = (id: string, patch: Partial<NoteOverlayItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const persist = useCallback(async (id: string, patch: Partial<NoteOverlayItem>) => {
    try {
      await updateNoteOverlay(id, patch);
    } catch (e) {
      logger.error('Failed to update overlay item:', e);
    }
  }, []);

  const bringToFront = (item: NoteOverlayItem) => {
    if (item.zIndex >= maxZ) return;
    const z = maxZ + 1;
    patchLocal(item.id, { zIndex: z });
    persist(item.id, { zIndex: z });
  };

  // ── 新增便利貼 / 輪播 ──
  const addSticky = async () => {
    const created = await createNoteOverlay(noteId, {
      kind: 'sticky', x: 24, y: 24, width: 180, height: 120, zIndex: maxZ + 1,
      color: STICKY_COLORS[0], text: '',
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const addSlide = async () => {
    const created = await createNoteOverlay(noteId, {
      kind: 'slide', x: 24, y: 24, width: 260, height: 200, zIndex: maxZ + 1,
      dataJson: JSON.stringify([]),
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteNoteOverlay(id);
  };

  // ── 拖曳 / 縮放 ──
  const startDrag = (e: React.PointerEvent, item: NoteOverlayItem, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(item);
    const sx = e.clientX, sy = e.clientY;
    const ox = item.x, oy = item.y, ow = item.width, oh = item.height;
    let next = { x: ox, y: oy, width: ow, height: oh };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === 'move') {
        next = { x: Math.max(0, ox + dx), y: Math.max(0, oy + dy), width: ow, height: oh };
        patchLocal(item.id, { x: next.x, y: next.y });
      } else {
        next = { x: ox, y: oy, width: Math.max(120, ow + dx), height: Math.max(80, oh + dy) };
        patchLocal(item.id, { width: next.width, height: next.height });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persist(item.id, mode === 'move' ? { x: next.x, y: next.y } : { width: next.width, height: next.height });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── 繪圖 ──
  const drawing = items.find((i) => i.kind === 'drawing') ?? null;
  const shapes: Shape[] = drawing?.dataJson ? normalizeShapes(safeParse<unknown[]>(drawing.dataJson, [])) : [];
  const curShape = useRef<Shape | null>(null);
  const eraseWork = useRef<Shape[] | null>(null); // 局部擦除進行中的暫存結果
  const [, forceRerender] = useState(0);

  // 以 ref 持有最新狀態，避免復原 / 重做的閉包鎖死過時物件（例如尚未建立的繪圖項目）。
  const shapesRef = useRef<Shape[]>(shapes);
  shapesRef.current = shapes;
  const drawingRef = useRef<NoteOverlayItem | null>(drawing);
  drawingRef.current = drawing;
  // 建立 drawing 項目的 in-flight 守衛：避免「第一筆畫完、建立 POST 尚未回來時就 Ctrl+Z」
  // 導致重複建立第二個 drawing 項目。後續呼叫會等同一個建立完成、再更新同一項目。
  const creatingRef = useRef<Promise<void> | null>(null);

  /** 把手繪寫入（local + 後端）；一律透過 drawingRef 取得「當前」繪圖項目，故供復原閉包安全沿用。 */
  const setDrawingShapes = async (next: Shape[]) => {
    shapesRef.current = next; // 立即同步，連續復原 / 重做不必等重繪
    const json = JSON.stringify(next);
    // 若有建立中的請求，先等它完成（屆時 drawingRef 已就緒），避免重複建立。
    if (!drawingRef.current && creatingRef.current) {
      await creatingRef.current;
    }
    const d = drawingRef.current;
    if (d) {
      patchLocal(d.id, { dataJson: json });
      await persist(d.id, { dataJson: json });
      return;
    }
    // 尚無 drawing 項目 → 建立（以 creatingRef 串行守衛）。
    creatingRef.current = (async () => {
      const created = await createNoteOverlay(noteId, {
        kind: 'drawing', x: 0, y: 0, width: 0, height: 0, zIndex: 0, dataJson: json,
      });
      if (created) {
        drawingRef.current = created; // 立即同步，後續呼叫直接走「更新」分支
        setItems((prev) => [...prev, created]);
      }
    })();
    await creatingRef.current;
    creatingRef.current = null;
  };

  /** 變更手繪：推入共用復原堆疊（undo→回前狀態、redo→回新狀態），再寫入。 */
  const commitShapes = (next: Shape[]) => {
    const prev = shapesRef.current;
    pushUndo({ undo: () => setDrawingShapes(prev), redo: () => setDrawingShapes(next) });
    setDrawingShapes(next);
  };

  const eraseRadius = Math.max(8, penWidth * 3); // 局部橡皮擦半徑（沿用線寬滑桿）
  const isPenTool = tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ellipse';

  const relPoint = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onSvgDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!tool || tool === 'erase-stroke') return; // 整筆刪除由各形狀自行接收點擊
    const p = relPoint(e);
    // 抓住指標，跨出 SVG 仍持續繪圖 / 擦除；合成事件或無作用指標時可能拋錯，忽略即可。
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (tool === 'erase-area') {
      eraseWork.current = eraseAt(shapes, p[0], p[1], eraseRadius);
      forceRerender((n) => n + 1);
      return;
    }
    curShape.current =
      tool === 'pen'
        ? { type: 'free', color: penColor, width: penWidth, dash: penDash, points: [p] }
        : { type: tool, color: penColor, width: penWidth, dash: penDash, points: [p, p] };
    forceRerender((n) => n + 1);
  };
  const onSvgMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'erase-area' && eraseWork.current) {
      const p = relPoint(e);
      eraseWork.current = eraseAt(eraseWork.current, p[0], p[1], eraseRadius);
      forceRerender((n) => n + 1);
      return;
    }
    if (!curShape.current) return;
    const p = relPoint(e);
    if (curShape.current.type === 'free') curShape.current.points.push(p);
    else curShape.current.points[1] = p;
    forceRerender((n) => n + 1);
  };
  const onSvgUp = () => {
    if (eraseWork.current) {
      const next = eraseWork.current;
      eraseWork.current = null;
      // 只有真的擦掉東西才記錄一步（拖過空白不留下空的復原項）
      if (JSON.stringify(next) !== JSON.stringify(shapes)) commitShapes(next);
      else forceRerender((n) => n + 1);
      return;
    }
    const s = curShape.current;
    curShape.current = null;
    if (!s) return;
    const ok = s.type === 'free' ? s.points.length > 1 : !samePoint(s.points[0], s.points[1]);
    if (ok) commitShapes([...shapes, s]);
    else forceRerender((n) => n + 1);
  };
  const eraseShape = (idx: number) => {
    if (tool !== 'erase-stroke') return;
    commitShapes(shapes.filter((_, i) => i !== idx));
  };
  const clearDrawing = () => {
    if (!shapes.length) return;
    if (!window.confirm('清除這張筆記上的所有手繪？（可用 Ctrl+Z 復原）')) return;
    commitShapes([]);
  };

  const allShapes = eraseWork.current
    ? eraseWork.current
    : curShape.current
      ? [...shapes, curShape.current]
      : shapes;
  const drawingActive = tool !== null;

  return (
    <>
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, overflow: 'hidden' }}
        data-testid="note-overlay"
      >
        {/* 手繪 SVG（繪圖中捕捉指標；否則僅顯示、指標穿透）。 */}
        <svg
          width={size.w}
          height={size.h}
          style={{
            position: 'absolute', left: 0, top: 0,
            pointerEvents: drawingActive ? 'auto' : 'none',
            cursor: tool === 'erase-stroke' || tool === 'erase-area' ? 'cell' : drawingActive ? 'crosshair' : 'default',
          }}
          onPointerDown={onSvgDown}
          onPointerMove={onSvgMove}
          onPointerUp={onSvgUp}
          onPointerLeave={onSvgUp}
          data-testid="overlay-draw-svg"
        >
          {allShapes.map((s, i) => (
            <ShapeEl key={i} s={s} erasable={tool === 'erase-stroke'} onErase={() => eraseShape(i)} />
          ))}
        </svg>

        {/* 便利貼 / 輪播 元件（繪圖中暫不可互動，讓 SVG 捕捉） */}
        {items.filter((i) => i.kind !== 'drawing').map((item) => (
          <div
            key={item.id}
            style={{
              position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height,
              zIndex: item.zIndex, pointerEvents: drawingActive ? 'none' : 'auto',
              display: 'flex', flexDirection: 'column',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', overflow: 'hidden',
              border: '1px solid var(--border-default)',
              background: item.kind === 'sticky' ? (item.color || STICKY_COLORS[0]) : 'var(--bg-surface)',
            }}
            onPointerDown={() => bringToFront(item)}
            data-testid={`overlay-item-${item.kind}`}
          >
            <div
              onPointerDown={(e) => startDrag(e, item, 'move')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '2px 6px', cursor: 'move', background: 'rgba(0,0,0,0.06)', flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {item.kind === 'sticky' ? '便利貼' : '輪播'}
              </span>
              <button
                onClick={() => remove(item.id)}
                title="刪除"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}
              >
                ✕
              </button>
            </div>

            {item.kind === 'sticky' ? (
              <StickyBody
                item={item}
                onText={(t) => patchLocal(item.id, { text: t })}
                onTextCommit={(t) => persist(item.id, { text: t })}
                onColor={(c) => { patchLocal(item.id, { color: c }); persist(item.id, { color: c }); }}
              />
            ) : (
              <SlideBody
                item={item}
                onImagesChange={(imgs) => {
                  const json = JSON.stringify(imgs);
                  patchLocal(item.id, { dataJson: json });
                  persist(item.id, { dataJson: json });
                }}
              />
            )}

            <div
              onPointerDown={(e) => startDrag(e, item, 'resize')}
              title="拖曳調整大小"
              style={{
                position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
                cursor: 'nwse-resize', background: 'transparent',
                borderRight: '2px solid var(--border-strong, #999)', borderBottom: '2px solid var(--border-strong, #999)',
              }}
            />
          </div>
        ))}
      </div>

      {/* 工具列：portal 至 body 並 position:fixed → 捲動內文時固定不動，不會被滑掉（#6）。
          固定在右下角（浮動工具盤），避免蓋住內文頂端的「編輯 / 匯出 PDF / 刪除」按鈕。
          flexDirection: column-reverse → 工具列在下、色盤彈窗往上開，留在畫面內。 */}
      {mounted && createPortal(
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1400, pointerEvents: 'auto',
            display: 'flex', flexDirection: 'column-reverse', gap: 4, alignItems: 'flex-end',
          }}
          data-testid="overlay-toolbar"
        >
          <div style={{
            display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end',
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', padding: 4, boxShadow: 'var(--shadow-md)', maxWidth: 380,
          }}>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSticky} title="新增便利貼" data-testid="overlay-add-sticky">＋便利貼</button>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSlide} title="新增圖片輪播" data-testid="overlay-add-slide">＋輪播</button>
            {/* 繪圖工具：點同一鈕可再關閉 */}
            {([
              ['pen', '✏️', '自由筆'],
              ['line', '／', '直線'],
              ['rect', '▭', '矩形'],
              ['ellipse', '◯', '橢圓'],
              ['erase-stroke', '🧹', '橡皮擦：整筆刪除（點一筆即刪整筆）'],
              ['erase-area', '🧽', '橡皮擦：局部擦除（擦到哪、那裏消失）'],
            ] as [Exclude<DrawTool, null>, string, string][]).map(([t, icon, label]) => (
              <button
                key={t}
                className={`tk-btn ${tool === t ? 'tk-btn--primary' : ''}`}
                style={{ cursor: 'pointer' }}
                title={label}
                onClick={() => setTool(tool === t ? null : t)}
                data-testid={`overlay-tool-${t}`}
              >
                {icon}
              </button>
            ))}
            {isPenTool && (
              <button
                title="畫筆顏色"
                onClick={() => setShowPenColor((v) => !v)}
                data-testid="overlay-pen-color"
                style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: penColor, border: '1px solid var(--border-strong, #999)', cursor: 'pointer' }}
              />
            )}
            {(isPenTool || tool === 'erase-area') && (
              <input
                type="range" min={1} max={20} value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value))}
                title={tool === 'erase-area' ? `橡皮擦大小：${eraseRadius}` : `線寬：${penWidth}`}
                style={{ width: 70 }}
                data-testid="overlay-pen-width"
              />
            )}
            {isPenTool && (
              <button
                className={`tk-btn ${penDash ? 'tk-btn--primary' : ''}`}
                style={{ cursor: 'pointer' }}
                title="虛線 / 實線"
                onClick={() => setPenDash((v) => !v)}
              >
                {penDash ? '┄' : '—'}
              </button>
            )}
            {shapes.length > 0 && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={clearDrawing} title="清除全部手繪（可 Ctrl+Z 復原）" data-testid="overlay-clear">清除</button>
            )}
            {drawingActive && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={() => setTool(null)} title="結束繪圖（回到一般互動）">完成</button>
            )}
          </div>

          {showPenColor && isPenTool && (
            <div style={{
              width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
            }}>
              <ColorPickerInline
                initial={penColor}
                onChange={(hex) => setPenColor(hex)}
                onPick={(hex) => { setPenColor(hex); setShowPenColor(false); }}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** 渲染單一形狀。 */
function ShapeEl({ s, erasable, onErase }: { s: Shape; erasable: boolean; onErase: () => void }) {
  const common = {
    fill: 'none' as const,
    stroke: s.color,
    strokeWidth: s.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: s.dash ? '6 4' : undefined,
    style: { pointerEvents: (erasable ? 'stroke' : 'none') as React.CSSProperties['pointerEvents'], cursor: erasable ? 'cell' : 'default' },
    onPointerDown: erasable ? onErase : undefined,
  };
  if (s.type === 'free' || s.type === 'line') {
    return <polyline points={s.points.map((p) => `${p[0]},${p[1]}`).join(' ')} {...common} />;
  }
  const [a, b] = s.points;
  if (!a || !b) return null;
  if (s.type === 'rect') {
    return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} {...common} />;
  }
  // ellipse
  return <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(b[0] - a[0]) / 2} ry={Math.abs(b[1] - a[1]) / 2} {...common} />;
}

/** 便利貼內容：可編輯文字 + 底色選擇。 */
function StickyBody({
  item, onText, onTextCommit, onColor,
}: {
  item: NoteOverlayItem;
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

/** 圖片輪播內容。 */
function SlideBody({
  item, onImagesChange,
}: {
  item: NoteOverlayItem;
  onImagesChange: (imgs: string[]) => void;
}) {
  const images: string[] = item.dataJson ? safeParse<string[]>(item.dataJson, []) : [];
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (images.length <= 1 || adding) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % images.length), 3000);
    return () => window.clearInterval(t);
  }, [images.length, adding]);

  const safeIdx = images.length ? idx % images.length : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, position: 'relative', minHeight: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {images.length === 0 ? (
          <span style={{ color: '#aaa', fontSize: 'var(--text-xs)' }}>尚無圖片，下方加入網址</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[safeIdx]} alt={`slide-${safeIdx}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
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
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setAdding(true)}
          onBlur={() => setAdding(false)}
          placeholder="圖片網址…"
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

function navBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 4,
    width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16, lineHeight: '1',
  } as React.CSSProperties;
}

/** 把（可能是舊版只有 points 的）資料正規化成 Shape（缺 type 視為 free）。 */
function normalizeShapes(raw: unknown[]): Shape[] {
  return (raw || [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      type: (['free', 'line', 'rect', 'ellipse'].includes(s.type as string) ? s.type : 'free') as Shape['type'],
      color: typeof s.color === 'string' ? s.color : '#ef4444',
      width: typeof s.width === 'number' ? s.width : 3,
      dash: !!s.dash,
      points: Array.isArray(s.points) ? (s.points as [number, number][]) : [],
    }));
}

/** 兩點是否幾乎相同（用於判斷形狀是否有實際拖出大小）。 */
function samePoint(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return true;
  return Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2;
}

/** 平方距離（避免開根號）。 */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** 點到線段的距離。 */
function distToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt(dist2(px, py, ax, ay));
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(dist2(px, py, ax + t * dx, ay + t * dy));
}

/**
 * 局部擦除：在 (x,y) 半徑 r 內移除內容。
 * - free（自由筆）：移除半徑內的點並把折線「斷開」成多段（產生破洞，真正的橡皮擦效果）。
 * - line：碰到線段就整條移除（直線無法部分擦除而仍維持為直線）。
 * - rect / ellipse：碰到其範圍就整個移除。
 * @returns 擦除後的新形狀陣列（不可變，回新陣列）。
 */
function eraseAt(list: Shape[], x: number, y: number, r: number): Shape[] {
  const r2 = r * r;
  const out: Shape[] = [];
  for (const s of list) {
    if (s.type === 'free') {
      let seg: [number, number][] = [];
      for (const p of s.points) {
        if (dist2(p[0], p[1], x, y) <= r2) {
          if (seg.length > 1) out.push({ ...s, points: seg });
          seg = [];
        } else {
          seg.push(p);
        }
      }
      if (seg.length > 1) out.push({ ...s, points: seg });
    } else if (s.type === 'line') {
      const [a, b] = s.points;
      if (!a || !b || distToSegment(x, y, a, b) > r) out.push(s); // 沒碰到才保留
    } else {
      // rect / ellipse：點落在（外擴 r 的）外接矩形內就移除
      const [a, b] = s.points;
      if (!a || !b) { out.push(s); continue; }
      const inside =
        x >= Math.min(a[0], b[0]) - r && x <= Math.max(a[0], b[0]) + r &&
        y >= Math.min(a[1], b[1]) - r && y <= Math.max(a[1], b[1]) + r;
      if (!inside) out.push(s);
    }
  }
  return out;
}

/** 安全解析 JSON，失敗回退預設值。 */
function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
