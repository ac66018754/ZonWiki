'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useViewport } from '@xyflow/react';
import { kaiwenApi } from '../kaiwen-api';
import type { CanvasAnnotationDto } from '../kaiwen-types';
import { logger } from '@/lib/logger';
import { ColorPickerInline } from '@/components/ColorPicker';
import { pushUndo, useUndoHotkeys } from '@/lib/undoManager';
import {
  type DrawTool,
  type Shape,
  normalizeShapes,
  safeParse,
  samePoint,
  eraseAt,
  eraseInBox,
  hitTestShape,
} from '@/lib/drawing/shapes';
import { ShapeEl } from '@/lib/drawing/ShapeEl';
import { StickyBody } from '@/components/overlay/StickyBody';
import { SlideBody } from '@/components/overlay/SlideBody';
import { STICKY_COLORS } from '@/components/overlay/overlayShared';
import { CanvasTextBox, parseTextExtra, type TextExtra } from './CanvasTextBox';

/** 純文字框的字色 / 背景常用色票。 */
const TEXT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#000000', '#ffffff'];

/** 畫布標註的前端內部表示（由 CanvasAnnotationDto 正規化而來，欄位採 camelCase）。 */
interface AnnoItem {
  id: string;
  kind: 'sticky' | 'drawing' | 'slide' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  color?: string | null;
  text?: string | null;
  dataJson?: string | null;
}

/** DTO → 內部表示。 */
function fromDto(d: CanvasAnnotationDto): AnnoItem {
  return {
    id: d.CanvasAnnotation_Id,
    kind: (d.CanvasAnnotation_Kind as AnnoItem['kind']) ?? 'sticky',
    x: d.CanvasAnnotation_X,
    y: d.CanvasAnnotation_Y,
    width: d.CanvasAnnotation_Width,
    height: d.CanvasAnnotation_Height,
    zIndex: d.CanvasAnnotation_ZIndex,
    color: d.CanvasAnnotation_Color,
    text: d.CanvasAnnotation_Text,
    dataJson: d.CanvasAnnotation_DataJson,
  };
}

interface Props {
  /** 目前畫布 ID（null＝尚未選畫布，整層停用）。 */
  canvasId: string | null;
  /** 通知父層「目前是否正在使用繪圖工具」→ 父層據此鎖住畫布平移/縮放/選取。 */
  onDrawingActiveChange?: (active: boolean) => void;
}

/**
 * 開問啦畫布標註層：把筆記頁右下角那組浮層工具（便利貼 / 圖片板 / 手繪塗鴉 + 三種橡皮擦）
 * 搬到 React Flow 畫布上，放右下角；不含 ＋高/−高（畫布可無限平移，不需手動加高）。
 *
 * 座標策略（詳見 docs/design/canvas-annotation-toolbar.md）：
 * - 擷取（pointer）一律在螢幕座標，經 {@link useReactFlow}().screenToFlowPosition 轉成畫布座標後才存。
 * - 渲染一律包在 `transform: translate(viewport)+scale(zoom)` 的內層，子元素直接用畫布座標定位，
 *   故所有標註會跟著畫布一起 pan/zoom，與節點對齊。
 * - 繪圖時用一層覆蓋全畫布的「擷取面」接所有筆畫/擦除；三種橡皮擦皆以純函式在畫布座標命中。
 */
export function CanvasAnnotationLayer({ canvasId, onDrawingActiveChange }: Props) {
  const { screenToFlowPosition, setViewport, getViewport } = useReactFlow();
  const { x: vx, y: vy, zoom } = useViewport();
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 畫筆模式下用右鍵 / 中鍵拖曳平移畫布（左鍵才是畫畫）：記住按下時的滑鼠位置與當下視窗位移。
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; zoom: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<AnnoItem[]>([]);
  // 以 ref 持有最新 items，供事件監聽器（如刪除空文字框）避免 stale closure。
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [mounted, setMounted] = useState(false);
  // 純文字框：目前選取 / 編輯中的文字框 id。
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // 繪圖工具狀態（與筆記版相同）
  const [tool, setTool] = useState<DrawTool>(null);
  const [penColor, setPenColor] = useState('#ef4444');
  const [penWidth, setPenWidth] = useState(3);
  const [penDash, setPenDash] = useState(false);
  const [showPenColor, setShowPenColor] = useState(false);
  const [selectedShapeIdx, setSelectedShapeIdx] = useState<number | null>(null);
  // 工具列收合狀態（收合時只剩一顆 🧰 工具箱圖示）；記憶於 localStorage。
  const [toolbarOpen, setToolbarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('kaiwen:annoToolbarOpen') !== '0' : true
  );

  const drawingActive = tool !== null;

  /** 收合工具列（順手結束繪圖，避免工具列收起來、畫布卻還鎖著）。 */
  const collapseToolbar = () => {
    setTool(null);
    setSelectedShapeIdx(null);
    setShowPenColor(false);
    setToolbarOpen(false);
    if (typeof window !== 'undefined') localStorage.setItem('kaiwen:annoToolbarOpen', '0');
  };
  /** 展開工具列。 */
  const expandToolbar = () => {
    setToolbarOpen(true);
    if (typeof window !== 'undefined') localStorage.setItem('kaiwen:annoToolbarOpen', '1');
  };

  useEffect(() => setMounted(true), []);

  // 只有在使用繪圖工具時才接管 Ctrl+Z / Ctrl+Y（不干擾畫布其他操作）。
  useUndoHotkeys(drawingActive);

  // 通知父層鎖/解鎖畫布。
  useEffect(() => {
    onDrawingActiveChange?.(drawingActive);
  }, [drawingActive, onDrawingActiveChange]);

  // 畫筆色盤：點空白處（色盤與色票鈕以外）才關閉。
  useEffect(() => {
    if (!showPenColor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-canvas-colorpop]') || t?.closest('[data-canvas-colorbtn]')) return;
      setShowPenColor(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showPenColor]);

  // 載入此畫布的所有標註。切換畫布時也重置繪圖工具與選取，避免把前一張畫布的
  // 工具狀態（例如還停在畫筆）帶到新畫布、害使用者一進去就誤畫。
  useEffect(() => {
    setTool(null);
    setSelectedShapeIdx(null);
    setShowPenColor(false);
    if (!canvasId) {
      setItems([]);
      return;
    }
    let alive = true;
    kaiwenApi
      .listCanvasAnnotations(canvasId)
      .then((list) => {
        if (alive) setItems((list ?? []).map(fromDto));
      })
      .catch((e) => logger.error('Failed to load canvas annotations:', e));
    return () => {
      alive = false;
    };
  }, [canvasId]);

  const maxZ = items.reduce((m, i) => Math.max(m, i.zIndex), 0);

  const patchLocal = (id: string, patch: Partial<AnnoItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  /** 寫回後端（camelCase patch → PascalCase request；undefined 欄位會被略過）。 */
  const persist = useCallback(async (id: string, patch: Partial<AnnoItem>) => {
    try {
      await kaiwenApi.updateCanvasAnnotation(id, {
        X: patch.x,
        Y: patch.y,
        Width: patch.width,
        Height: patch.height,
        ZIndex: patch.zIndex,
        Color: patch.color ?? undefined,
        Text: patch.text ?? undefined,
        DataJson: patch.dataJson ?? undefined,
      });
    } catch (e) {
      logger.error('Failed to update canvas annotation:', e);
    }
  }, []);

  const bringToFront = (item: AnnoItem) => {
    if (item.zIndex >= maxZ) return;
    const z = maxZ + 1;
    patchLocal(item.id, { zIndex: z });
    persist(item.id, { zIndex: z });
  };

  /** 取得目前畫布視窗中心的畫布座標（讓新增的標註出現在使用者正看著的地方）。 */
  const viewCenter = (): { x: number; y: number } => {
    const el = rootRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  };

  // ── 新增便利貼 / 圖片板 ──
  const addSticky = async () => {
    if (!canvasId) return;
    const c = viewCenter();
    const created = await kaiwenApi.createCanvasAnnotation(canvasId, {
      Kind: 'sticky', X: c.x - 90, Y: c.y - 60, Width: 180, Height: 120, ZIndex: maxZ + 1,
      Color: STICKY_COLORS[0], Text: '',
    });
    if (created) setItems((prev) => [...prev, fromDto(created)]);
  };
  const addSlide = async () => {
    if (!canvasId) return;
    const c = viewCenter();
    const created = await kaiwenApi.createCanvasAnnotation(canvasId, {
      Kind: 'slide', X: c.x - 130, Y: c.y - 100, Width: 260, Height: 200, ZIndex: maxZ + 1,
      DataJson: JSON.stringify([]),
    });
    if (created) setItems((prev) => [...prev, fromDto(created)]);
  };
  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await kaiwenApi.deleteCanvasAnnotation(id);
  };

  // ── 純文字框（Snipaste 風格）──
  /** 螢幕座標 → 畫布座標（供純文字框縮放/旋轉換算）。 */
  const toFlow = (clientX: number, clientY: number) => screenToFlowPosition({ x: clientX, y: clientY });

  const addTextBox = async () => {
    if (!canvasId) return;
    const c = viewCenter();
    const created = await kaiwenApi.createCanvasAnnotation(canvasId, {
      Kind: 'text', X: c.x - 90, Y: c.y - 24, Width: 180, Height: 48, ZIndex: maxZ + 1,
      Color: '#ef4444', Text: '', DataJson: JSON.stringify({ bg: null, fontSize: 20, rotation: 0 }),
    });
    if (created) {
      const it = fromDto(created);
      setItems((prev) => [...prev, it]);
      setToolbarOpen(true);
      setSelectedTextId(it.id);
      setEditingTextId(it.id);
    }
  };

  /** 若指定文字框內容為空 → 刪除（避免留下看不見的空框）。回傳是否刪除。 */
  const deleteIfEmpty = (id: string): boolean => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it && it.kind === 'text' && !(it.text ?? '').trim()) {
      setItems((prev) => prev.filter((x) => x.id !== id));
      kaiwenApi.deleteCanvasAnnotation(id);
      return true;
    }
    return false;
  };

  // 點文字框與其屬性面板以外的地方 → 取消選取（空框順手刪除）。
  useEffect(() => {
    if (!selectedTextId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-testid="canvas-anno-text"]') || t?.closest('[data-canvas-textprops]')) return;
      const id = selectedTextId;
      setSelectedTextId(null);
      setEditingTextId(null);
      deleteIfEmpty(id);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selectedTextId]);

  // 屬性面板用：目前選取的文字框 + 其額外屬性。
  const selectedTextItem = items.find((i) => i.id === selectedTextId && i.kind === 'text') ?? null;
  /** 更新選取文字框的額外屬性（bg / fontSize / rotation）並持久化。 */
  const updateTextExtra = (patch: Partial<TextExtra>) => {
    if (!selectedTextItem) return;
    const cur = parseTextExtra(selectedTextItem.dataJson);
    const json = JSON.stringify({ ...cur, ...patch });
    patchLocal(selectedTextItem.id, { dataJson: json });
    persist(selectedTextItem.id, { dataJson: json });
  };
  /** 設定選取文字框的字體顏色。 */
  const setTextColor = (c: string) => {
    if (!selectedTextItem) return;
    patchLocal(selectedTextItem.id, { color: c });
    persist(selectedTextItem.id, { color: c });
  };
  /** 刪除目前選取的文字框。 */
  const deleteSelectedText = () => {
    const id = selectedTextId;
    setSelectedTextId(null);
    setEditingTextId(null);
    if (id) remove(id);
  };

  // ── 拖曳 / 縮放（螢幕位移 ÷ zoom = 畫布位移）──
  const startDrag = (e: React.PointerEvent, item: AnnoItem, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(item);
    const sx = e.clientX, sy = e.clientY;
    const z = zoomRef.current || 1;
    const ox = item.x, oy = item.y, ow = item.width, oh = item.height;
    let next = { x: ox, y: oy, width: ow, height: oh };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (mode === 'move') {
        next = { x: ox + dx, y: oy + dy, width: ow, height: oh };
        patchLocal(item.id, { x: next.x, y: next.y });
      } else {
        next = { x: ox, y: oy, width: Math.max(80, ow + dx), height: Math.max(60, oh + dy) };
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

  // ── 繪圖（與筆記版邏輯相同，只是座標改用畫布座標）──
  const drawing = items.find((i) => i.kind === 'drawing') ?? null;
  const shapes: Shape[] = drawing?.dataJson ? normalizeShapes(safeParse<unknown[]>(drawing.dataJson, [])) : [];
  const curShape = useRef<Shape | null>(null);
  const eraseWork = useRef<Shape[] | null>(null);
  const eraseBox = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [, forceRerender] = useState(0);

  const shapesRef = useRef<Shape[]>(shapes);
  shapesRef.current = shapes;
  const drawingRef = useRef<AnnoItem | null>(drawing);
  drawingRef.current = drawing;
  const creatingRef = useRef<Promise<void> | null>(null);

  /** 把手繪寫入（local + 後端）；透過 drawingRef 取得當前繪圖項目，供復原閉包安全沿用。 */
  const setDrawingShapes = async (next: Shape[]) => {
    if (!canvasId) return;
    shapesRef.current = next;
    const json = JSON.stringify(next);
    if (!drawingRef.current && creatingRef.current) {
      await creatingRef.current;
    }
    const d = drawingRef.current;
    if (d) {
      patchLocal(d.id, { dataJson: json });
      await persist(d.id, { dataJson: json });
      return;
    }
    creatingRef.current = (async () => {
      const created = await kaiwenApi.createCanvasAnnotation(canvasId, {
        Kind: 'drawing', X: 0, Y: 0, Width: 0, Height: 0, ZIndex: 0, DataJson: json,
      });
      if (created) {
        const item = fromDto(created);
        drawingRef.current = item;
        setItems((prev) => [...prev, item]);
      }
    })();
    await creatingRef.current;
    creatingRef.current = null;
  };

  /** 變更手繪：推入共用復原堆疊，再寫入。 */
  const commitShapes = (next: Shape[]) => {
    const prev = shapesRef.current;
    pushUndo({ undo: () => setDrawingShapes(prev), redo: () => setDrawingShapes(next) });
    setDrawingShapes(next);
  };

  const eraseRadius = Math.max(8, penWidth * 3);
  const isPenTool = tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ellipse';

  /** 螢幕座標 → 畫布座標。 */
  const flowPoint = (e: React.PointerEvent): [number, number] => {
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return [p.x, p.y];
  };

  const onCaptureDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tool) return;
    // 右鍵 / 中鍵：拖曳平移畫布（不畫畫）；左鍵才是畫畫。
    if (e.button === 2 || e.button === 1) {
      const vp = getViewport();
      panRef.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y, zoom: vp.zoom };
      try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button !== 0) return; // 其它按鍵忽略
    setSelectedShapeIdx(null);
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const p = flowPoint(e);
    if (tool === 'erase-stroke') {
      // 整筆刪除：以純函式找出點到的最上層形狀並整筆移除（每次點擊一筆）。
      const idx = hitTestShape(shapes, p[0], p[1], eraseRadius);
      if (idx >= 0) commitShapes(shapes.filter((_, i) => i !== idx));
      return;
    }
    if (tool === 'erase-area') {
      eraseWork.current = eraseAt(shapes, p[0], p[1], eraseRadius);
      forceRerender((n) => n + 1);
      return;
    }
    if (tool === 'erase-box') {
      eraseBox.current = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
      forceRerender((n) => n + 1);
      return;
    }
    curShape.current =
      tool === 'pen'
        ? { type: 'free', color: penColor, width: penWidth, dash: penDash, points: [p] }
        : { type: tool, color: penColor, width: penWidth, dash: penDash, points: [p, p] };
    forceRerender((n) => n + 1);
  };

  const onCaptureMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // 右鍵 / 中鍵拖曳中：平移畫布（螢幕位移 1:1 對應視窗位移，zoom 不變）。
    if (panRef.current) {
      const p = panRef.current;
      setViewport({ x: p.vx + (e.clientX - p.sx), y: p.vy + (e.clientY - p.sy), zoom: p.zoom });
      return;
    }
    if (tool === 'erase-area' && eraseWork.current) {
      const p = flowPoint(e);
      eraseWork.current = eraseAt(eraseWork.current, p[0], p[1], eraseRadius);
      forceRerender((n) => n + 1);
      return;
    }
    if (tool === 'erase-box' && eraseBox.current) {
      const p = flowPoint(e);
      eraseBox.current = { ...eraseBox.current, x1: p[0], y1: p[1] };
      forceRerender((n) => n + 1);
      return;
    }
    if (!curShape.current) return;
    const p = flowPoint(e);
    if (curShape.current.type === 'free') curShape.current.points.push(p);
    else curShape.current.points[1] = p;
    forceRerender((n) => n + 1);
  };

  const onCaptureUp = () => {
    if (panRef.current) { panRef.current = null; return; }
    if (eraseWork.current) {
      const next = eraseWork.current;
      eraseWork.current = null;
      if (JSON.stringify(next) !== JSON.stringify(shapes)) commitShapes(next);
      else forceRerender((n) => n + 1);
      return;
    }
    if (eraseBox.current) {
      const b = eraseBox.current;
      eraseBox.current = null;
      const minX = Math.min(b.x0, b.x1);
      const maxX = Math.max(b.x0, b.x1);
      const minY = Math.min(b.y0, b.y1);
      const maxY = Math.max(b.y0, b.y1);
      if (maxX - minX < 4 && maxY - minY < 4) {
        forceRerender((n) => n + 1);
        return;
      }
      const next = eraseInBox(shapes, minX, minY, maxX, maxY);
      if (JSON.stringify(next) !== JSON.stringify(shapes)) commitShapes(next);
      else forceRerender((n) => n + 1);
      return;
    }
    const s = curShape.current;
    curShape.current = null;
    if (!s) return;
    const ok = s.type === 'free' ? s.points.length > 1 : !samePoint(s.points[0], s.points[1]);
    if (ok) {
      setSelectedShapeIdx(shapes.length);
      commitShapes([...shapes, s]);
    } else {
      forceRerender((n) => n + 1);
    }
  };

  const clearDrawing = () => {
    if (!shapes.length) return;
    if (!window.confirm('清除這張畫布上的所有手繪？（可用 Ctrl+Z 復原）')) return;
    setSelectedShapeIdx(null);
    commitShapes([]);
  };

  // ── 即時調整「剛畫完形狀」的樣式（顏色 / 線寬 / 虛線）──
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
    if (isPenTool) applyToSelected({ width: w });
  };
  const togglePenDash = () => {
    setPenDash((v) => {
      const nextDash = !v;
      applyToSelected({ dash: nextDash });
      return nextDash;
    });
  };

  const selectTool = (t: Exclude<DrawTool, null>) => {
    setSelectedShapeIdx(null);
    setTool((cur) => (cur === t ? null : t));
  };

  const allShapes = eraseWork.current
    ? eraseWork.current
    : curShape.current
      ? [...shapes, curShape.current]
      : shapes;

  if (!canvasId) return null;

  const captureCursor =
    tool === 'erase-stroke' || tool === 'erase-area' || tool === 'erase-box' ? 'cell' : 'crosshair';

  return (
    <>
      {/* 渲染層：transform 跟著畫布 pan/zoom；pointer-events:none，子元素自行開啟可互動。 */}
      <div
        ref={rootRef}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 4 }}
        data-testid="canvas-annotation-layer"
      >
        <div
          style={{
            position: 'absolute', left: 0, top: 0,
            transformOrigin: '0 0',
            transform: `translate(${vx}px, ${vy}px) scale(${zoom})`,
          }}
        >
          {/* 手繪 SVG（僅顯示；命中改由擷取面負責）。overflow:visible 讓任何畫布座標的形狀都能畫出。 */}
          <svg
            width={10000}
            height={10000}
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
            data-testid="canvas-annotation-svg"
          >
            {allShapes.map((s, i) => (
              <ShapeEl key={i} s={s} erasable={false} onErase={() => {}} />
            ))}
            {eraseBox.current && (
              <rect
                x={Math.min(eraseBox.current.x0, eraseBox.current.x1)}
                y={Math.min(eraseBox.current.y0, eraseBox.current.y1)}
                width={Math.abs(eraseBox.current.x1 - eraseBox.current.x0)}
                height={Math.abs(eraseBox.current.y1 - eraseBox.current.y0)}
                fill="rgba(120,120,120,0.12)"
                stroke="var(--text-secondary, #888)"
                strokeWidth={1}
                strokeDasharray="5 4"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>

          {/* 便利貼 / 圖片板（繪圖中暫不可互動，讓擷取面接管） */}
          {items.filter((i) => i.kind === 'sticky' || i.kind === 'slide').map((item) => (
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
              data-testid={`canvas-anno-${item.kind}`}
            >
              <div
                onPointerDown={(e) => startDrag(e, item, 'move')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '2px 6px', cursor: 'move', background: 'rgba(0,0,0,0.06)', flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {item.kind === 'sticky' ? '便利貼' : '圖片板'}
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

          {/* 純文字框（Snipaste 風格：可打字、設背景、旋轉縮放） */}
          {items.filter((i) => i.kind === 'text').map((item) => (
            <CanvasTextBox
              key={item.id}
              item={item}
              zoomRef={zoomRef}
              toFlow={toFlow}
              selected={selectedTextId === item.id}
              editing={editingTextId === item.id}
              onSelect={() => { bringToFront(item); setSelectedTextId(item.id); }}
              onStartEdit={() => { setSelectedTextId(item.id); setEditingTextId(item.id); }}
              onStopEdit={() => { setEditingTextId(null); deleteIfEmpty(item.id); }}
              onChange={(patch) => patchLocal(item.id, patch)}
              onCommit={(patch) => persist(item.id, patch)}
            />
          ))}
        </div>
      </div>

      {/* 擷取面：只在使用工具時出現，覆蓋整個畫布、接所有筆畫/擦除（螢幕座標 → flow）。 */}
      {drawingActive && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'auto', cursor: captureCursor, touchAction: 'none' }}
          onPointerDown={onCaptureDown}
          onPointerMove={onCaptureMove}
          onPointerUp={onCaptureUp}
          onPointerLeave={onCaptureUp}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="canvas-annotation-capture"
        />
      )}

      {/* 工具列：portal 至 body、固定右下角（往上墊高避開小地圖）；不含 ＋高/−高。
          可收合：收合後只剩一顆 🧰 工具箱圖示，點它再展開。 */}
      {mounted && createPortal(
        toolbarOpen ? (
        <div
          style={{
            position: 'fixed', bottom: 168, right: 16, zIndex: 1400, pointerEvents: 'auto',
            display: 'flex', flexDirection: 'column-reverse', gap: 4, alignItems: 'flex-end',
          }}
          data-testid="canvas-annotation-toolbar"
        >
          <div style={{
            display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end',
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', padding: 4, boxShadow: 'var(--shadow-md)', maxWidth: 360,
          }}>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={collapseToolbar} title="收合工具箱" data-testid="canvas-anno-collapse">🧰</button>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSticky} title="新增便利貼" data-testid="canvas-anno-add-sticky">＋便利貼</button>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSlide} title="新增圖片板（可放多張圖、手動切換）" data-testid="canvas-anno-add-slide">＋圖片板</button>
            <button className="tk-btn" style={{ cursor: 'pointer', fontWeight: 700 }} onClick={addTextBox} title="新增純文字框（可打字、設背景顏色/透明、旋轉縮放、調字級字色）" data-testid="canvas-anno-add-text">T</button>
            {([
              ['pen', '✏️', '自由筆'],
              ['line', '／', '直線'],
              ['rect', '▭', '矩形'],
              ['ellipse', '◯', '橢圓'],
              ['erase-stroke', '🧹', '橡皮擦：整筆刪除（點一筆即刪整筆）'],
              ['erase-area', '🧽', '橡皮擦：局部擦除（擦到哪、那裏消失）'],
              ['erase-box', '⬚', '橡皮擦：框選擦除（框到哪、那裏消失，同一形狀不連帶整個刪除）'],
            ] as [Exclude<DrawTool, null>, string, string][]).map(([t, icon, label]) => (
              <button
                key={t}
                className={`tk-btn ${tool === t ? 'tk-btn--primary' : ''}`}
                style={{ cursor: 'pointer' }}
                title={label}
                onClick={() => selectTool(t)}
                data-testid={`canvas-anno-tool-${t}`}
              >
                {icon}
              </button>
            ))}
            {isPenTool && (
              <button
                title="畫筆顏色"
                onClick={() => setShowPenColor((v) => !v)}
                data-testid="canvas-anno-pen-color"
                data-canvas-colorbtn
                style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: penColor, border: '1px solid var(--border-strong, #999)', cursor: 'pointer' }}
              />
            )}
            {(isPenTool || tool === 'erase-area') && (
              <input
                type="range" min={1} max={20} value={penWidth}
                onChange={(e) => changePenWidth(Number(e.target.value))}
                title={tool === 'erase-area' ? `橡皮擦大小：${eraseRadius}` : `線寬：${penWidth}`}
                style={{ width: 70 }}
                data-testid="canvas-anno-pen-width"
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
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={clearDrawing} title="清除全部手繪（可 Ctrl+Z 復原）" data-testid="canvas-anno-clear">清除</button>
            )}
            {drawingActive && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={() => { setSelectedShapeIdx(null); setTool(null); }} title="結束繪圖（回到一般畫布操作）" data-testid="canvas-anno-done">完成</button>
            )}
          </div>

          {showPenColor && isPenTool && (
            <div
              data-canvas-colorpop
              style={{
                width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
              }}
            >
              <ColorPickerInline
                initial={penColor}
                onChange={(hex) => changePenColor(hex)}
                onPick={(hex) => changePenColor(hex)}
              />
            </div>
          )}

          {/* 純文字框屬性面板（選取文字框時出現）：字級 / 字色 / 背景（含透明）/ 刪除。 */}
          {selectedTextItem && (() => {
            const te = parseTextExtra(selectedTextItem.dataJson);
            const curFont = selectedTextItem.color || '#ef4444';
            return (
              <div
                data-canvas-textprops
                data-testid="canvas-anno-textprops"
                style={{
                  display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end',
                  background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)', padding: '4px 6px', boxShadow: 'var(--shadow-md)',
                  maxWidth: 360, fontSize: 'var(--text-xs)',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>字級</span>
                <input
                  type="range" min={10} max={80} value={te.fontSize}
                  onChange={(e) => updateTextExtra({ fontSize: Number(e.target.value) })}
                  style={{ width: 64 }}
                  data-testid="canvas-anno-text-fontsize"
                />
                <span style={{ color: 'var(--text-secondary)' }}>字色</span>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={`fc-${c}`}
                    onClick={() => setTextColor(c)}
                    title="字體顏色"
                    style={{
                      width: 14, height: 14, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: curFont === c ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.25)',
                    }}
                  />
                ))}
                <span style={{ color: 'var(--text-secondary)' }}>底</span>
                <button
                  className="tk-btn"
                  style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '1px 5px' }}
                  onClick={() => updateTextExtra({ bg: null })}
                  title="背景透明"
                  data-testid="canvas-anno-text-bg-none"
                >
                  透明
                </button>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={`bg-${c}`}
                    onClick={() => updateTextExtra({ bg: c })}
                    title="背景顏色"
                    style={{
                      width: 14, height: 14, borderRadius: 3, background: c, cursor: 'pointer',
                      border: te.bg === c ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.25)',
                    }}
                  />
                ))}
                <button
                  className="tk-btn"
                  style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '1px 5px' }}
                  onClick={deleteSelectedText}
                  title="刪除此文字框"
                  data-testid="canvas-anno-text-delete"
                >
                  刪除
                </button>
              </div>
            );
          })()}
        </div>
        ) : (
          <button
            onClick={expandToolbar}
            data-testid="canvas-annotation-toolbox"
            title="展開畫布工具箱（便利貼 / 圖片板 / 畫筆 / 橡皮擦）"
            style={{
              position: 'fixed', bottom: 168, right: 16, zIndex: 1400, pointerEvents: 'auto',
              width: 40, height: 40, borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-md)', cursor: 'pointer', fontSize: 20, lineHeight: 1,
            }}
          >
            🧰
          </button>
        ),
        document.body,
      )}
    </>
  );
}
