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
 * 事件：框選提問的答案要放進「就在原處旁邊」的便利貼（由 NoteMarksLayer 派發、NoteOverlay 接收建立）。
 * detail：{ x, y, text }（x/y 為相對內文容器的座標）。
 */
export const NOTE_ASK_STICKY_EVENT = 'zonwiki:note-ask-sticky';

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
  // 「剛畫完的形狀」索引：可在工具列即時調整其顏色 / 線寬 / 虛線並立刻看到變化。
  // null＝沒有可調整的對象（換工具、擦除、開始畫新的一筆都會清除）。
  const [selectedShapeIdx, setSelectedShapeIdx] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    listNoteOverlay(noteId).then((list) => {
      if (alive) setItems(list);
    });
    return () => { alive = false; };
  }, [noteId]);

  // 以 ref 持有最新 items，供事件監聽器計算 zIndex（避免 stale closure）。
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 接收「框選提問答案 → 便利貼」事件：在指定座標建立便利貼並加入浮層（取代開新筆記）。
  useEffect(() => {
    const onAskSticky = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number; text: string }>).detail;
      if (!detail) return;
      const z = itemsRef.current.reduce((m, i) => Math.max(m, i.zIndex), 0) + 1;
      createNoteOverlay(noteId, {
        kind: 'sticky',
        x: Math.max(0, detail.x),
        y: Math.max(0, detail.y),
        width: 300,
        height: 220,
        zIndex: z,
        color: STICKY_COLORS[2],
        text: detail.text,
      }).then((created) => {
        if (created) setItems((prev) => [...prev, created]);
      });
    };
    window.addEventListener(NOTE_ASK_STICKY_EVENT, onAskSticky);
    return () => window.removeEventListener(NOTE_ASK_STICKY_EVENT, onAskSticky);
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
    // 開始新的一筆 / 擦除 → 取消「可調整上一個形狀」的選取。
    setSelectedShapeIdx(null);
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
    if (ok) {
      // 把剛畫好的形狀設為「可即時調整」對象（它會是陣列最後一個）。
      setSelectedShapeIdx(shapes.length);
      commitShapes([...shapes, s]);
    } else {
      forceRerender((n) => n + 1);
    }
  };
  const eraseShape = (idx: number) => {
    if (tool !== 'erase-stroke') return;
    setSelectedShapeIdx(null);
    commitShapes(shapes.filter((_, i) => i !== idx));
  };
  const clearDrawing = () => {
    if (!shapes.length) return;
    if (!window.confirm('清除這張筆記上的所有手繪？（可用 Ctrl+Z 復原）')) return;
    setSelectedShapeIdx(null);
    commitShapes([]);
  };

  // ── 手動加高繪圖區（讓便利貼 / 塗鴉 / 輪播可向下延伸）──
  // 把「額外高度」存在 drawing 項目的 height 欄位（原本未用），不更動 shapes(dataJson) 格式。
  const GROW_STEP = 320; // 每次加高的像素
  const extraHeight = Math.max(0, drawing?.height ?? 0);

  /** 確保有 drawing 項目，回傳它（沒有就建立一個帶指定額外高度者）。 */
  const ensureDrawingItem = async (initialExtraHeight: number): Promise<NoteOverlayItem | null> => {
    if (drawingRef.current) return drawingRef.current;
    if (creatingRef.current) await creatingRef.current;
    if (drawingRef.current) return drawingRef.current;
    const created = await createNoteOverlay(noteId, {
      kind: 'drawing', x: 0, y: 0, width: 0, height: initialExtraHeight, zIndex: 0, dataJson: JSON.stringify([]),
    });
    if (created) {
      drawingRef.current = created;
      setItems((prev) => [...prev, created]);
    }
    return created;
  };

  /** 把繪圖區額外高度設為指定值（>=0）並持久化。 */
  const setCanvasExtraHeight = async (next: number) => {
    const clamped = Math.max(0, Math.round(next));
    const d = await ensureDrawingItem(clamped);
    if (!d) return;
    patchLocal(d.id, { height: clamped });
    await persist(d.id, { height: clamped });
  };

  const growCanvas = () => setCanvasExtraHeight(extraHeight + GROW_STEP);
  const shrinkCanvas = () => setCanvasExtraHeight(Math.max(0, extraHeight - GROW_STEP));

  // ── 即時調整「剛畫完形狀」的樣式（顏色 / 線寬 / 虛線）──
  /** 把樣式套到目前選取的形狀並即時持久化（不推 undo，避免微調時產生大量步驟）。 */
  const applyToSelected = (patch: Partial<Pick<Shape, 'color' | 'width' | 'dash'>>) => {
    if (selectedShapeIdx === null) return;
    const cur = shapesRef.current;
    if (selectedShapeIdx < 0 || selectedShapeIdx >= cur.length) return;
    const next = cur.map((s, i) => (i === selectedShapeIdx ? { ...s, ...patch } : s));
    setDrawingShapes(next);
  };
  const changePenColor = (hex: string) => {
    setPenColor(hex);
    applyToSelected({ color: hex });
  };
  const changePenWidth = (w: number) => {
    setPenWidth(w);
    // 橡皮擦半徑沿用此滑桿；只有在繪圖工具且有選取形狀時才回套到形狀。
    if (isPenTool) applyToSelected({ width: w });
  };
  const togglePenDash = () => {
    setPenDash((v) => {
      const nextDash = !v;
      applyToSelected({ dash: nextDash });
      return nextDash;
    });
  };

  /** 切換繪圖工具：點同一鈕關閉；換工具時清除「可調整形狀」選取。 */
  const selectTool = (t: Exclude<DrawTool, null>) => {
    setSelectedShapeIdx(null);
    setTool((cur) => (cur === t ? null : t));
  };

  const allShapes = eraseWork.current
    ? eraseWork.current
    : curShape.current
      ? [...shapes, curShape.current]
      : shapes;
  const drawingActive = tool !== null;

  // 是否可選取形狀做即時調整（非擦除中、非繪製中）。
  const canSelectShape = !eraseWork.current && !curShape.current;

  return (
    <>
      {/* 撐高內文容器的占位元素（正常流）：讓繪圖區與便利貼/輪播可向下延伸到加高後的區域。 */}
      {extraHeight > 0 && <div aria-hidden style={{ height: extraHeight, pointerEvents: 'none' }} />}

      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, overflow: 'hidden' }}
        data-testid="note-overlay"
      >
        {/* 手繪 SVG（繪圖中捕捉指標；否則僅顯示、指標穿透）。高度含手動加高（extraHeight）。 */}
        <svg
          width={size.w}
          height={size.h + extraHeight}
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
            <ShapeEl
              key={i}
              s={s}
              erasable={tool === 'erase-stroke'}
              onErase={() => eraseShape(i)}
              selected={canSelectShape && i === selectedShapeIdx}
            />
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
                onClick={() => selectTool(t)}
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
                onChange={(e) => changePenWidth(Number(e.target.value))}
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
                onClick={togglePenDash}
              >
                {penDash ? '┄' : '—'}
              </button>
            )}
            {selectedShapeIdx !== null && isPenTool && (
              <span
                style={{ fontSize: 'var(--text-xs)', color: 'var(--action-secondary-fg)', whiteSpace: 'nowrap' }}
                title="可直接調整工具列的顏色 / 線寬 / 虛線，會即時套用到剛畫的圖形"
              >
                ✎ 調整剛畫的圖形
              </span>
            )}
            {shapes.length > 0 && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={clearDrawing} title="清除全部手繪（可 Ctrl+Z 復原）" data-testid="overlay-clear">清除</button>
            )}
            {drawingActive && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={growCanvas} title="加高繪圖區（往下擴充，可放更多便利貼/塗鴉/輪播）" data-testid="overlay-grow">＋高</button>
            )}
            {drawingActive && extraHeight > 0 && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={shrinkCanvas} title="降低繪圖區高度" data-testid="overlay-shrink">−高</button>
            )}
            {drawingActive && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={() => { setSelectedShapeIdx(null); setTool(null); }} title="結束繪圖（回到一般互動）">完成</button>
            )}
          </div>

          {showPenColor && isPenTool && (
            <div style={{
              width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
            }}>
              <ColorPickerInline
                initial={penColor}
                onChange={(hex) => changePenColor(hex)}
                onPick={(hex) => { changePenColor(hex); setShowPenColor(false); }}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** 依給定描邊屬性渲染單一形狀（free/line→polyline、rect→rect、ellipse→ellipse）。 */
function renderShapeWith(
  s: Shape,
  props: React.SVGProps<SVGPolylineElement & SVGRectElement & SVGEllipseElement>
): React.ReactElement | null {
  if (s.type === 'free' || s.type === 'line') {
    return <polyline points={s.points.map((p) => `${p[0]},${p[1]}`).join(' ')} {...props} />;
  }
  const [a, b] = s.points;
  if (!a || !b) return null;
  if (s.type === 'rect') {
    return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} {...props} />;
  }
  return <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(b[0] - a[0]) / 2} ry={Math.abs(b[1] - a[1]) / 2} {...props} />;
}

/** 渲染單一形狀；selected＝顯示「可即時調整」的淡色光暈外框。 */
function ShapeEl({
  s, erasable, onErase, selected,
}: {
  s: Shape;
  erasable: boolean;
  onErase: () => void;
  selected?: boolean;
}) {
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
  const shapeNode = renderShapeWith(s, common);
  if (!selected) return shapeNode;
  // 選取光暈：相同形狀、較寬且半透明的藍色描邊墊在底層，標示「正在調整這個圖形」。
  const halo = renderShapeWith(s, {
    fill: 'none',
    stroke: 'var(--action-primary-bg, #3b82f6)',
    strokeWidth: s.width + 8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    opacity: 0.25,
    style: { pointerEvents: 'none' },
  });
  return (
    <g>
      {halo}
      {shapeNode}
    </g>
  );
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

/** 把折線各段以約 2px 間距加密取樣，讓局部橡皮擦能可靠命中描邊。 */
function densifyPolyline(corners: [number, number][], stepPx = 2): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(segLen / stepPx));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  if (corners.length > 0) out.push(corners[corners.length - 1]);
  return out;
}

/**
 * 把幾何形狀（line/rect/ellipse）攤平成密集點折線，供局部橡皮擦做「部分擦除」。
 * 自由筆（free）已是點折線，直接回傳其點。
 */
function shapeToPoints(s: Shape): [number, number][] {
  if (s.type === 'free') return s.points;
  const [a, b] = s.points;
  if (!a || !b) return [];
  if (s.type === 'line') {
    return densifyPolyline([a, b]);
  }
  if (s.type === 'rect') {
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    return densifyPolyline([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
  }
  // ellipse：以參數式取樣（Ramanujan 周長近似決定取樣點數）
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(b[0] - a[0]) / 2;
  const ry = Math.abs(b[1] - a[1]) / 2;
  const circumference = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(24, Math.ceil(circumference / 2));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

/** 對一條點折線移除半徑內的點並斷開成多段，把結果（型別一律 free）推入 out。 */
function erodeFreePoints(
  template: Shape,
  points: [number, number][],
  x: number,
  y: number,
  r2: number,
  out: Shape[]
): void {
  let seg: [number, number][] = [];
  for (const p of points) {
    if (dist2(p[0], p[1], x, y) <= r2) {
      if (seg.length > 1) out.push({ ...template, type: 'free', points: seg });
      seg = [];
    } else {
      seg.push(p);
    }
  }
  if (seg.length > 1) out.push({ ...template, type: 'free', points: seg });
}

/**
 * 局部擦除：在 (x,y) 半徑 r 內移除內容（真正「擦到哪、那裏消失」）。
 * - free（自由筆）：移除半徑內的點並斷開成多段（產生破洞）。
 * - line / rect / ellipse：先判斷橡皮擦是否真的碰到描邊；沒碰到 → 保留原向量圖形（不退化）；
 *   碰到 → 攤平成密集點折線後套用與 free 相同的「移除＋斷開」邏輯，於是橢圓/矩形/直線也能被局部擦出缺口。
 * @returns 擦除後的新形狀陣列（不可變，回新陣列）。
 */
function eraseAt(list: Shape[], x: number, y: number, r: number): Shape[] {
  const r2 = r * r;
  const out: Shape[] = [];
  for (const s of list) {
    if (s.type === 'free') {
      erodeFreePoints(s, s.points, x, y, r2, out);
      continue;
    }
    // 幾何形狀：先看橡皮擦是否真的碰到此形狀的描邊
    const points = shapeToPoints(s);
    const touched = points.some((p) => dist2(p[0], p[1], x, y) <= r2);
    if (!touched) {
      out.push(s); // 沒碰到 → 保留原向量圖形（避免無謂退化成折線）
      continue;
    }
    // 碰到 → 攤平成折線並局部擦除（自此這個形狀變成自由筆近似）
    erodeFreePoints(s, points, x, y, r2, out);
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
