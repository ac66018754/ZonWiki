'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  listNoteOverlay,
  createNoteOverlay,
  updateNoteOverlay,
  deleteNoteOverlay,
  askNoteSelectionAnswer,
  type NoteOverlayItem,
} from '@/lib/api';
import { logger } from '@/lib/logger';
import { ColorPickerInline } from '@/components/ColorPicker';
import { pushUndo } from '@/lib/undoManager';
import {
  type DrawTool,
  type Shape,
  normalizeShapes,
  safeParse,
  samePoint,
  eraseAt,
  eraseInBox,
} from '@/lib/drawing/shapes';
import { ShapeEl } from '@/lib/drawing/ShapeEl';
import { StickyBody } from '@/components/overlay/StickyBody';
import { SlideBody } from '@/components/overlay/SlideBody';
import { STICKY_COLORS } from '@/components/overlay/overlayShared';

/**
 * 事件：框選提問的答案要放進「就在原處旁邊」的便利貼（由 NoteMarksLayer 派發、NoteOverlay 接收建立）。
 * detail：{ x, y, text }（x/y 為相對內文容器的座標）。
 */
export const NOTE_ASK_STICKY_EVENT = 'zonwiki:note-ask-sticky';

/** 便利貼/圖片板標題列上的小圖示按鈕樣式（－ 收合、🗑 刪除）。 */
const chromeBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1,
  padding: '0 2px',
};

interface Props {
  /** 筆記 ID。 */
  noteId: string;
  /** 內文容器（.markdown-prose）參考；浮層覆蓋其上。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 點右下角工具列「📖 目錄」時呼叫（重新開啟章節目錄表）。 */
  onRequestToc?: () => void;
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
export function NoteOverlay({ noteId, containerRef, onRequestToc }: Props) {
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

  // 便利貼/圖片板：收合（只剩標題）的項目集合；正在編輯標題的項目與其草稿值。
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  const toggleCollapse = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 畫筆色盤：點空白處（色盤與色票鈕以外）才關閉，方便連續調色。
  useEffect(() => {
    if (!showPenColor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-overlay-colorpop]') || t?.closest('[data-overlay-colorbtn]')) return;
      setShowPenColor(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showPenColor]);

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
      // detail.x/y 為「相對內文容器」座標；新便利貼預設跟著內文（absolute），直接沿用即可。
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
  }, [noteId, containerRef]);

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
  // 新元件預設「跟著內文捲動」（pinned=false、相對內文座標），出現在內文左上、稍微階梯錯開避免完全重疊；
  // 之後可用標題列的「📌」切換成「釘住浮動、可拖到任何地方」。
  const spawnPos = () => {
    const step = (items.filter((i) => i.kind !== 'drawing').length % 6) * 18;
    return { x: 36 + step, y: 36 + step };
  };
  const addSticky = async () => {
    const p = spawnPos();
    const created = await createNoteOverlay(noteId, {
      kind: 'sticky', x: p.x, y: p.y, width: 220, height: 200, zIndex: maxZ + 1,
      color: STICKY_COLORS[0], text: '',
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const addSlide = async () => {
    const p = spawnPos();
    const created = await createNoteOverlay(noteId, {
      kind: 'slide', x: p.x, y: p.y, width: 260, height: 200, zIndex: maxZ + 1,
      dataJson: JSON.stringify([]),
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteNoteOverlay(id);
  };

  // ── 便利貼「繼續問」：脈絡＝筆記內容（後端自動帶）＋前一張便利貼＋本便利貼，答案變成新便利貼 ──
  const askFromSticky = async (item: NoteOverlayItem, question: string) => {
    // 「前一張便利貼」＝便利貼清單中、排在本貼之前的那一張（依顯示/建立順序）。
    const stickies = itemsRef.current.filter((i) => i.kind === 'sticky');
    const idx = stickies.findIndex((s) => s.id === item.id);
    const prev = idx > 0 ? stickies[idx - 1] : null;
    const anchorText =
      (prev ? `【前一張便利貼】\n${prev.text ?? ''}\n\n` : '') +
      `【目前便利貼】\n${item.text ?? ''}`;
    const answer = await askNoteSelectionAnswer(noteId, {
      anchorText,
      anchorStart: 0,
      anchorEnd: 0,
      anchorPrefix: '',
      anchorSuffix: '',
      question,
    });
    if (!answer) return;
    const z = itemsRef.current.reduce((m, i) => Math.max(m, i.zIndex), 0) + 1;
    const created = await createNoteOverlay(noteId, {
      kind: 'sticky',
      x: Math.max(0, item.x + 28),
      y: Math.max(0, item.y + 28),
      width: Math.max(240, item.width),
      height: Math.max(180, item.height),
      zIndex: z,
      color: STICKY_COLORS[2],
      text: `Q：${question}\n\nA：${answer}`,
    });
    if (created) setItems((prev2) => [...prev2, created]);
  };

  // ── 便利貼 dataJson 結構 { title?, highlights? }：標題與重點共存於同一欄，互不覆蓋 ──
  const stickyDataObj = (item: NoteOverlayItem): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(item.dataJson || '');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* 舊格式（純陣列）或空 → 視為無標題 */ }
    return {};
  };
  const stickyTitle = (item: NoteOverlayItem): string => {
    const title = stickyDataObj(item).title;
    return typeof title === 'string' ? title : '';
  };
  /** 合併寫入便利貼 dataJson（保留另一欄）。 */
  const writeStickyData = (item: NoteOverlayItem, patch: Record<string, unknown>) => {
    const json = JSON.stringify({ ...stickyDataObj(item), ...patch });
    patchLocal(item.id, { dataJson: json });
    persist(item.id, { dataJson: json });
  };
  /** 刪除浮層項目（先確認；軟刪除 → 進垃圾桶可還原）。 */
  const confirmRemove = (item: NoteOverlayItem) => {
    const label = item.kind === 'sticky' ? '便利貼' : '圖片板';
    if (window.confirm(`刪除這張${label}？（之後可在「垃圾桶 → 便利貼」還原）`)) remove(item.id);
  };

  // ── 「釘住浮動 / 跟著內文」切換（#5）──
  // pinned=true：position:fixed、portal 到 body、可拖到整個畫面（含側欄），但不隨內文捲動（像章節目錄表）。
  // pinned=false（預設）：position:absolute 疊在內文上，隨內文捲動、被內文區裁切（原本的便利貼行為）。
  // x/y 的意義隨 pinned 改變（fixed＝視窗座標、absolute＝相對內文座標），切換時換算座標讓它停在原地。
  const isPinned = (item: NoteOverlayItem): boolean => stickyDataObj(item).pinned === true;
  const togglePin = (item: NoteOverlayItem) => {
    const pinned = !isPinned(item);
    const rect = containerRef.current?.getBoundingClientRect();
    let nx = item.x;
    let ny = item.y;
    if (rect) {
      // 釘住：內文座標 → 視窗座標；取消：視窗座標 → 內文座標。
      nx = pinned ? rect.left + item.x : item.x - rect.left;
      ny = pinned ? rect.top + item.y : item.y - rect.top;
    }
    patchLocal(item.id, { x: nx, y: ny });
    persist(item.id, { x: nx, y: ny });
    writeStickyData(item, { pinned });
  };

  /**
   * 「便利貼歸位」救援：把所有便利貼/圖片板移回內文左上角階梯排列、並取消釘住——
   * 救回被拖到看不見（標題列被裁切、抓不回來）的元件。
   */
  const gatherStrayItems = () => {
    items
      .filter((i) => i.kind !== 'drawing')
      .forEach((item, i) => {
        const x = 28 + (i % 8) * 26;
        const y = 28 + (i % 8) * 26;
        patchLocal(item.id, { x, y });
        persist(item.id, { x, y });
        if (item.kind === 'sticky' && isPinned(item)) {
          writeStickyData(item, { pinned: false });
        }
      });
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
        let nx = ox + dx;
        let ny = oy + dy;
        if (isPinned(item)) {
          // 釘住（視窗座標）：夾在畫面內，至少保留標題列可抓，避免拖到完全看不到。
          const maxX = (typeof window !== 'undefined' ? window.innerWidth : 2000) - 40;
          const maxY = (typeof window !== 'undefined' ? window.innerHeight : 2000) - 28;
          nx = Math.min(maxX, Math.max(0, nx));
          ny = Math.min(maxY, Math.max(0, ny));
        } else {
          // 跟著內文（相對座標）：夾在內文範圍內，至少保留 40px 寬＋標題列高度可見，
          // 避免被內文區（overflow:hidden）裁切到「整條標題列＋按鈕都看不到、抓不回來」。
          const maxX = Math.max(0, size.w - 40);
          const maxY = Math.max(0, size.h + extraHeight - 28);
          nx = Math.min(maxX, Math.max(0, nx));
          ny = Math.min(maxY, Math.max(0, ny));
        }
        next = { x: nx, y: ny, width: ow, height: oh };
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
  const eraseBox = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // 框選擦除進行中的選取框
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
  const onSvgMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'erase-area' && eraseWork.current) {
      const p = relPoint(e);
      eraseWork.current = eraseAt(eraseWork.current, p[0], p[1], eraseRadius);
      forceRerender((n) => n + 1);
      return;
    }
    if (tool === 'erase-box' && eraseBox.current) {
      const p = relPoint(e);
      eraseBox.current = { ...eraseBox.current, x1: p[0], y1: p[1] };
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
    if (eraseBox.current) {
      const b = eraseBox.current;
      eraseBox.current = null;
      const minX = Math.min(b.x0, b.x1);
      const maxX = Math.max(b.x0, b.x1);
      const minY = Math.min(b.y0, b.y1);
      const maxY = Math.max(b.y0, b.y1);
      // 太小的框視為誤點，不擦。
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

  /**
   * 渲染單張便利貼 / 圖片板。pinned 者用 position:fixed（由 portal 掛到 body，可拖到整個畫面）；
   * 非 pinned 者用 position:absolute（疊在內文上、隨內文捲動、被內文區裁切）。
   */
  const renderOverlayItem = (item: NoteOverlayItem): React.ReactNode => {
    const collapsed = collapsedIds.has(item.id);
    const isSticky = item.kind === 'sticky';
    const pinned = isPinned(item);
    return (
      <div
        key={item.id}
        style={{
          position: pinned ? 'fixed' : 'absolute', left: item.x, top: item.y, width: item.width,
          height: collapsed ? 'auto' : item.height,
          zIndex: pinned ? 1100 + item.zIndex : item.zIndex,
          pointerEvents: drawingActive ? 'none' : 'auto',
          display: 'flex', flexDirection: 'column',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', overflow: 'hidden',
          border: '1px solid var(--border-default)',
          background: isSticky ? (item.color || STICKY_COLORS[0]) : 'var(--bg-surface)',
        }}
        onPointerDown={() => bringToFront(item)}
        data-testid={`overlay-item-${item.kind}`}
      >
        <div
          className="overlay-item-chrome"
          onPointerDown={(e) => startDrag(e, item, 'move')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px 2px 6px', cursor: 'move', background: 'rgba(0,0,0,0.06)', flexShrink: 0,
          }}
        >
          {/* 標題：便利貼可點擊自訂；圖片板固定。 */}
          {editingTitleId === item.id && isSticky ? (
            <input
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => { writeStickyData(item, { title: titleDraft.trim() }); setEditingTitleId(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditingTitleId(null);
              }}
              placeholder="便利貼標題…"
              style={{
                flex: 1, minWidth: 0, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 3,
                padding: '0 4px', fontSize: 'var(--text-xs)', background: 'rgba(255,255,255,0.8)', color: '#333', outline: 'none',
              }}
            />
          ) : (
            <span
              onClick={(e) => {
                if (!isSticky) return;
                e.stopPropagation();
                setTitleDraft(stickyTitle(item));
                setEditingTitleId(item.id);
              }}
              onPointerDown={(e) => { if (isSticky) e.stopPropagation(); }}
              title={isSticky ? '點擊修改標題' : undefined}
              style={{
                flex: '0 1 auto', maxWidth: '50%', minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                cursor: isSticky ? 'text' : 'move', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {isSticky ? (stickyTitle(item) || '便利貼') : '圖片板'}
            </span>
          )}
          {/* 可拖曳的留白（標題與按鈕之間）：讓人好抓著拖曳整張便利貼。 */}
          {editingTitleId !== item.id && (
            <span aria-hidden="true" style={{ flex: 1, alignSelf: 'stretch', cursor: 'move' }} />
          )}
          {/* 📌 釘住浮動 / 跟著內文 切換（便利貼專屬） */}
          {isSticky && (
            <button
              onClick={() => togglePin(item)}
              onPointerDown={(e) => e.stopPropagation()}
              title={pinned ? '已釘住浮動（可拖到任何地方）；點擊改為跟著內文捲動' : '跟著內文捲動；點擊改為釘住浮動、可拖到任何地方'}
              data-testid="overlay-item-pin"
              style={{ ...chromeBtnStyle, opacity: pinned ? 1 : 0.5 }}
            >
              📌
            </button>
          )}
          {/* － 收合（只剩標題） */}
          <button
            onClick={() => toggleCollapse(item.id)}
            onPointerDown={(e) => e.stopPropagation()}
            title={collapsed ? '展開' : '收合（只剩標題）'}
            data-testid="overlay-item-collapse"
            style={chromeBtnStyle}
          >
            {collapsed ? '＋' : '－'}
          </button>
          {/* 🗑 刪除（先確認；進垃圾桶可還原） */}
          <button
            onClick={() => confirmRemove(item)}
            onPointerDown={(e) => e.stopPropagation()}
            title="刪除（進垃圾桶可還原）"
            data-testid="overlay-item-delete"
            style={chromeBtnStyle}
          >
            🗑
          </button>
        </div>

        {!collapsed && (isSticky ? (
          <StickyBody
            item={item}
            onText={(t) => patchLocal(item.id, { text: t })}
            onTextCommit={(t) => persist(item.id, { text: t })}
            onColor={(c) => { patchLocal(item.id, { color: c }); persist(item.id, { color: c }); }}
            onHighlightsChange={(highlights) => writeStickyData(item, { highlights })}
            onAsk={(q) => askFromSticky(item, q)}
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
        ))}

        {!collapsed && (
          <div
            className="overlay-item-chrome"
            onPointerDown={(e) => startDrag(e, item, 'resize')}
            title="拖曳調整大小"
            style={{
              position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
              cursor: 'nwse-resize', background: 'transparent',
              borderRight: '2px solid var(--border-strong, #999)', borderBottom: '2px solid var(--border-strong, #999)',
            }}
          />
        )}
      </div>
    );
  };

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
            />
          ))}
          {/* 框選擦除進行中的選取框（虛線；放開後框內內容被擦除） */}
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
        {/* 非 pinned 便利貼/圖片板：position:absolute 疊在內文上、隨內文捲動、被內文區裁切（原本行為）。 */}
        {items.filter((i) => i.kind !== 'drawing' && !isPinned(i)).map(renderOverlayItem)}
      </div>

      {/* pinned 便利貼/圖片板：portal 至 body、position:fixed → 可自由拖到整個畫面（含側欄），不隨內文捲動。 */}
      {mounted && createPortal(
        <>{items.filter((i) => i.kind !== 'drawing' && isPinned(i)).map(renderOverlayItem)}</>,
        document.body,
      )}

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
            {onRequestToc && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={onRequestToc} title="顯示章節目錄表" data-testid="overlay-toggle-toc">📖 目錄</button>
            )}
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSticky} title="新增便利貼" data-testid="overlay-add-sticky">＋便利貼</button>
            <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={addSlide} title="新增圖片板（可放多張圖、手動切換）" data-testid="overlay-add-slide">＋圖片板</button>
            {items.some((i) => i.kind !== 'drawing') && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={gatherStrayItems} title="便利貼歸位：把所有便利貼/圖片板拉回左上角（救回被拖到看不見、抓不回來的）" data-testid="overlay-gather">↺ 歸位</button>
            )}
            {/* 繪圖工具：點同一鈕可再關閉 */}
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
                data-overlay-colorbtn
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
            <div
              data-overlay-colorpop
              style={{
                width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
              }}
            >
              {/* 選色後不關閉色盤（連續調色）；點空白處才關 */}
              <ColorPickerInline
                initial={penColor}
                onChange={(hex) => changePenColor(hex)}
                onPick={(hex) => changePenColor(hex)}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
