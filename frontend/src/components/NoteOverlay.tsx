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
import { useConfirm } from '@/components/ConfirmProvider';
import { pushUndo } from '@/lib/undoManager';
import {
  type DrawTool,
  type Shape,
  normalizeShapes,
  safeParse,
  samePoint,
  eraseAt,
  eraseInBox,
  eraseVisibleOnly,
  shapeAnchorPoint,
} from '@/lib/drawing/shapes';
import { ShapeEl } from '@/lib/drawing/ShapeEl';
import { StickyBody } from '@/components/overlay/StickyBody';
import { SlideBody } from '@/components/overlay/SlideBody';
import { STICKY_COLORS, parseSlideData } from '@/components/overlay/overlayShared';
import { DrawingTextBox, parseTextExtra, type TextExtra } from '@/components/drawing/TextBox';
import { DrawingToolbar } from '@/components/drawing/DrawingToolbar';
import { TextPropsPanel } from '@/components/drawing/TextPropsPanel';
import { computeAnchorAt, locateAnchor, isOverlayAnchor, type OverlayAnchor } from '@/lib/overlayAnchor';
import { NoteQuestionListPanel } from '@/components/questions/NoteQuestionListPanel';
import { QuestionAnswerPopup } from '@/components/questions/QuestionAnswerPopup';
import { deriveQuestionTitle } from '@/lib/questionTitle';
import { scrollToOverlayItem } from '@/lib/scrollToOverlayItem';

/**
 * 事件：框選提問的答案要放進「就在原處旁邊」的便利貼（由 NoteMarksLayer 派發、NoteOverlay 接收建立）。
 * detail：{ x, y, text }（x/y 為相對內文容器的座標）。
 */
export const NOTE_ASK_STICKY_EVENT = 'zonwiki:note-ask-sticky';

/**
 * 螢光筆「直線／自由筆」偏好的 localStorage 鍵。
 * 帶 v1 版本後綴：日後若儲存格式改變，可換 v2 而不會誤讀舊值。
 * 值為 '1'（直線）／'0'（自由筆）。
 */
const HIGHLIGHT_STRAIGHT_STORAGE_KEY = 'zonwiki:highlightStraight:v1';

/** 兩個字串集合內容是否相同（供避免無意義的 state 更新/重繪）。 */
function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

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
  /** 點右下角工具列「📖 目錄」時呼叫（切換章節目錄表開/關）。 */
  onToggleToc?: () => void;
  /** 章節目錄表目前是否開啟（開啟時工具列目錄鈕加深底色，標示 On）。 */
  tocOpen?: boolean;
  /**
   * 「問題清單」面板是否開啟（由筆記頁工具列的「❓ 問題清單」鈕控制）。
   * 面板本身由本元件渲染（因需存取 overlay items 與回答狀態），開關狀態上提給頁面。
   */
  questionPanelOpen?: boolean;
  /** 問題清單面板要求關閉時回呼（面板 ✕／點列定位後同步頁面的開關狀態）。 */
  onQuestionPanelOpenChange?: (open: boolean) => void;
  /** 本篇問題項目變動時回呼（供頁面工具列鈕顯示問題數）。 */
  onQuestionsChange?: (questions: NoteOverlayItem[]) => void;
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
export function NoteOverlay({
  noteId,
  containerRef,
  onToggleToc,
  tocOpen,
  questionPanelOpen,
  onQuestionPanelOpenChange,
  onQuestionsChange,
}: Props) {
  const confirm = useConfirm();
  const [items, setItems] = useState<NoteOverlayItem[]>([]);
  // 目前開著答題彈窗的問題 item id 清單（可多開；只存 React state，刷新即消失）。
  const [openAnswerItemIds, setOpenAnswerItemIds] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [mounted, setMounted] = useState(false);
  // 疊在內文上的浮層容器（position:absolute; inset:0）——非釘住便利貼/圖片板的絕對定位原點。
  // 用它的螢幕矩形換算便利貼左上角螢幕座標，供「跟著 toggle 收合」判定（見下方 collapsedByToggle 效果）。
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // 繪圖工具狀態
  const [tool, setTool] = useState<DrawTool>(null);
  const [penColor, setPenColor] = useState('#ef4444');
  const [penWidth, setPenWidth] = useState(3);
  // 螢光筆獨立的線寬（較粗）與透明度（半透明），與一般畫筆分開記憶。
  const [highlightWidth, setHighlightWidth] = useState(16);
  const [highlightOpacity, setHighlightOpacity] = useState(0.4);
  const [penDash, setPenDash] = useState(false);
  const [showPenColor, setShowPenColor] = useState(false);
  // 純文字框：目前選取 / 編輯中的文字框 id；字色/背景完整色盤是否展開。
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showTextFontPop, setShowTextFontPop] = useState(false);
  const [showTextBgPop, setShowTextBgPop] = useState(false);
  // 筆記座標系無縮放（zoom 固定 1）；DrawingTextBox 需要 zoomRef 換算拖曳位移。
  const noteZoomRef = useRef(1);
  // 「剛畫完的形狀」索引：可在工具列即時調整其顏色 / 線寬 / 虛線並立刻看到變化。
  // null＝沒有可調整的對象（換工具、擦除、開始畫新的一筆都會清除）。
  const [selectedShapeIdx, setSelectedShapeIdx] = useState<number | null>(null);
  // 螢光筆「直線模式」：開啟時螢光筆拖曳畫出筆直的半透明線（type:'line' + opacity），
  // 適合整行畫重點；關閉＝原本的自由筆螢光筆。
  //
  // 預設 true（直線）：多數畫重點情境要的是「整行拉一條直線」，故預設直線；
  // 但仍「記住上次選擇」——若使用者用工具列切回自由筆，換一篇筆記不該被強制拉回直線（否則體驗矛盾）。
  // SSR 安全：初始一律給 true（伺服器端無 window，不可讀 localStorage），掛載後再從 localStorage 覆蓋，
  //          以此避免 hydration mismatch（見下方兩個 effect）。
  const [highlightStraight, setHighlightStraight] = useState(true);
  // 偏好是否已從 localStorage 還原完畢。用來擋住「還沒讀就先寫回」把舊偏好覆蓋掉的競態；
  // 刻意用 state（而非 ref）故不依賴 effect 的宣告順序，較穩健。
  const [highlightStraightLoaded, setHighlightStraightLoaded] = useState(false);

  // 掛載後從 localStorage 還原螢光筆直線偏好（放 effect 而非 useState 初始值，以避免 SSR/水合不一致）。
  // 讀不到（首次使用）時維持預設 true（直線）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIGHLIGHT_STRAIGHT_STORAGE_KEY);
      if (raw !== null) setHighlightStraight(raw === '1');
    } catch {
      /* 隱私模式／停用 storage 時忽略，維持預設直線。 */
    }
    setHighlightStraightLoaded(true);
  }, []);

  // highlightStraight 變動時寫回 localStorage（工具列切換直線／自由筆即持久化，跨筆記與 session 保持）。
  // 還原完成前（loaded=false）不寫，避免掛載瞬間的預設值覆蓋掉使用者上次存下的偏好。
  useEffect(() => {
    if (!highlightStraightLoaded) return;
    try {
      window.localStorage.setItem(HIGHLIGHT_STRAIGHT_STORAGE_KEY, highlightStraight ? '1' : '0');
    } catch {
      /* 忽略寫入失敗（storage 已滿或被停用等）。 */
    }
  }, [highlightStraight, highlightStraightLoaded]);

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
      if (t?.closest('[data-draw-colorpop]') || t?.closest('[data-draw-colorbtn]')) return;
      setShowPenColor(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showPenColor]);

  useEffect(() => {
    let alive = true;
    listNoteOverlay(noteId).then((list) => {
      if (!alive) return;
      setItems(list);
      // 便利貼/圖片板預設「收合」（只顯示標題列）——每次打開筆記都全收合，不記憶展開狀態。
      setCollapsedIds(new Set(list.filter((i) => i.kind === 'sticky' || i.kind === 'slide').map((i) => i.id)));
    });
    return () => { alive = false; };
  }, [noteId]);

  // 以 ref 持有最新 items，供事件監聽器計算 zIndex（避免 stale closure）。
  const itemsRef = useRef(items);
  itemsRef.current = items;

  /**
   * 依「容器相對座標點」建立內容錨點（畫記跟著文字走的基準；點在視窗外或無文字時回 null）。
   * useCallback：只依賴穩定的 containerRef，供下方 effect 安全列入依賴。
   * @param px 相對內文容器的 X。
   * @param py 相對內文容器的 Y。
   * @returns 內容錨點或 null（呼叫端 fallback 絕對座標）。
   */
  const anchorAtContainerPoint = useCallback((px: number, py: number): OverlayAnchor | null => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!container || !rect) return null;
    return computeAnchorAt(container, rect.left + px, rect.top + py);
  }, [containerRef]);

  // 接收「框選提問答案 → 便利貼」事件：在指定座標建立便利貼並加入浮層（取代開新筆記）。
  useEffect(() => {
    const onAskSticky = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number; text: string }>).detail;
      if (!detail) return;
      const z = itemsRef.current.reduce((m, i) => Math.max(m, i.zIndex), 0) + 1;
      // detail.x/y 為「相對內文容器」座標；新便利貼預設跟著內文（absolute），直接沿用即可。
      // 一併建立內容錨點（跟著所選段落的文字走）。
      const askAnchor = anchorAtContainerPoint(Math.max(0, detail.x), Math.max(0, detail.y));
      createNoteOverlay(noteId, {
        kind: 'sticky',
        x: Math.max(0, detail.x),
        y: Math.max(0, detail.y),
        width: 300,
        height: 220,
        zIndex: z,
        color: STICKY_COLORS[2],
        text: detail.text,
        ...(askAnchor ? { dataJson: JSON.stringify({ anchor: askAnchor }) } : {}),
      }).then((created) => {
        if (created) setItems((prev) => [...prev, created]);
      });
    };
    window.addEventListener(NOTE_ASK_STICKY_EVENT, onAskSticky);
    return () => window.removeEventListener(NOTE_ASK_STICKY_EVENT, onAskSticky);
  }, [noteId, containerRef, anchorAtContainerPoint]);

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

  // ── 問題功能 ──
  // 本篇被標記為問題的浮層元件（僅 sticky / text；建立時間新→舊）。
  const questionItems = items
    .filter((i) => i.isQuestion && (i.kind === 'sticky' || i.kind === 'text'));

  // 問題項目變動時通知頁面（供工具列「❓ 問題清單 (N)」顯示數量）。用 JSON key 避免無意義的重複回呼。
  const questionsSignature = questionItems
    .map((i) => `${i.id}:${i.isQuestion ? 1 : 0}:${(i.questionAnswer ?? '') !== '' ? 1 : 0}`)
    .join('|');
  useEffect(() => {
    onQuestionsChange?.(questionItems);
    // 僅在「問題集合／已答狀態」真的變動時回呼（questionsSignature 為穩定的內容指紋）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsSignature]);

  /** 切換「設為問題／移除問題」（樂觀更新 + 持久化）。 */
  const toggleQuestion = (item: NoteOverlayItem) => {
    const next = !item.isQuestion;
    patchLocal(item.id, { isQuestion: next });
    persist(item.id, { isQuestion: next });
  };

  /** 開啟某問題的答題彈窗（同一 item 已開則不重開）。 */
  const openAnswerPopup = (itemId: string) => {
    setOpenAnswerItemIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
  };

  /** 關閉某問題的答題彈窗。 */
  const closeAnswerPopup = (itemId: string) => {
    setOpenAnswerItemIds((prev) => prev.filter((id) => id !== itemId));
  };

  /** 答題彈窗儲存成功：同步本地 item 的回答（彈窗已自行持久化，此處只更新本地狀態）。 */
  const onAnswerSaved = (itemId: string, answer: string) => {
    patchLocal(itemId, { questionAnswer: answer });
  };

  // scrollToOverlayItem 會回傳清理函式（取消尚未完成的重試與高亮計時器）。保存最近一次，
  // 下次定位前先執行上一次的清理、元件卸載時也清理，避免遺留計時器（對抗式復審 MEDIUM）。
  const locateCleanupRef = useRef<(() => void) | null>(null);
  const handleLocateQuestion = useCallback((itemId: string) => {
    onQuestionPanelOpenChange?.(false);
    locateCleanupRef.current?.();
    locateCleanupRef.current = scrollToOverlayItem(itemId);
  }, [onQuestionPanelOpenChange]);
  useEffect(() => () => {
    locateCleanupRef.current?.();
  }, []);

  // ── 新增便利貼 / 輪播 ──
  // 新元件預設「跟著內文捲動」（pinned=false、相對內文座標），出現在內文左上、稍微階梯錯開避免完全重疊；
  // 之後可用標題列的「📌」切換成「釘住浮動、可拖到任何地方」。
  const spawnPos = () => {
    const step = (items.filter((i) => i.kind !== 'drawing').length % 6) * 18;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 36 + step, y: 36 + step };
    // 生成在「使用者目前看到的位置」＝視窗中心換算成內文相對座標（扣半個便利貼讓它置中於視野），
    // 而非永遠在內文最左上角。非釘選便利貼用內文相對座標，故會跟著內文捲動停在這。
    const cx = window.innerWidth / 2 - rect.left - 110;
    const cy = window.innerHeight / 2 - rect.top - 90;
    const x = Math.max(8, Math.min(cx, Math.max(8, size.w - 120))) + step;
    const y = Math.max(8, cy) + step;
    return { x, y };
  };
  const addSticky = async () => {
    const p = spawnPos();
    const anchor = anchorAtContainerPoint(p.x, p.y);
    const created = await createNoteOverlay(noteId, {
      kind: 'sticky', x: p.x, y: p.y, width: 220, height: 200, zIndex: maxZ + 1,
      color: STICKY_COLORS[0], text: '',
      ...(anchor ? { dataJson: JSON.stringify({ anchor }) } : {}),
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const addSlide = async () => {
    const p = spawnPos();
    const anchor = anchorAtContainerPoint(p.x, p.y);
    const created = await createNoteOverlay(noteId, {
      kind: 'slide', x: p.x, y: p.y, width: 260, height: 200, zIndex: maxZ + 1,
      dataJson: JSON.stringify(anchor ? { images: [], anchor } : []),
    });
    if (created) setItems((prev) => [...prev, created]);
  };
  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteNoteOverlay(id);
  };

  // ── 純文字框（Snipaste 風格；與開問啦畫布共用 DrawingTextBox）──
  /** 螢幕座標 → 內文相對座標（筆記無縮放/平移，直接扣掉容器左上角）。 */
  const toFlow = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  };

  const addTextBox = async () => {
    // 需求：按 T＝進入文字，同時取消畫筆/形狀/螢光筆/橡皮擦模式
    //（否則繪圖 SVG 仍攔截指標，新文字框根本點不到）。
    setTool(null);
    setSelectedShapeIdx(null);
    const p = spawnPos();
    const anchor = anchorAtContainerPoint(p.x, p.y);
    const created = await createNoteOverlay(noteId, {
      kind: 'text', x: p.x, y: p.y, width: 180, height: 48, zIndex: maxZ + 1,
      color: '#ef4444', text: '',
      dataJson: JSON.stringify({ bg: null, fontSize: 20, rotation: 0, ...(anchor ? { anchor } : {}) }),
    });
    if (created) {
      setItems((prev) => [...prev, created]);
      setSelectedTextId(created.id);
      setEditingTextId(created.id);
    }
  };

  /** 若指定文字框內容為空 → 刪除（避免留下看不見的空框）。 */
  const deleteIfEmpty = (id: string): void => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it && it.kind === 'text' && !(it.text ?? '').trim()) remove(id);
  };

  const selectedTextItem = items.find((i) => i.id === selectedTextId && i.kind === 'text') ?? null;
  /** 更新選取文字框的額外屬性（bg / fontSize / rotation）並持久化（合併寫入，保留 anchor 等其他欄位）。 */
  const updateTextExtra = (patch: Partial<TextExtra>) => {
    if (!selectedTextItem) return;
    const json = JSON.stringify({ ...rawDataObj(selectedTextItem), ...patch });
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

  /**
   * 文字框持久化：移動（patch 含 x/y）時順便以新位置重建內容錨點——拖到新文字上就跟著新文字；
   * 其他 patch（打字、旋轉…）原樣持久化。
   * @param id 文字框 id。
   * @param patch 來自 DrawingTextBox 的 onCommit 內容。
   */
  const commitTextItemPatch = (id: string, patch: Partial<NoteOverlayItem>) => {
    if (patch.x === undefined || patch.y === undefined) {
      persist(id, patch);
      return;
    }
    const cur = itemsRef.current.find((x) => x.id === id);
    if (!cur) return;
    // 縮放/旋轉的 commit 也帶 x/y 但值可能沒變（rotation=0 的 resize）→ 沒真的移動就不重錨（省一次定位）。
    const anchorObj = rawDataObj(cur).anchor;
    if (isOverlayAnchor(anchorObj) && Math.abs(patch.x - cur.x) < 0.5 && Math.abs(patch.y - cur.y) < 0.5) {
      persist(id, patch);
      return;
    }
    const anchor = anchorAtContainerPoint(patch.x, patch.y);
    const obj = { ...rawDataObj({ ...cur, ...patch }) } as Record<string, unknown>;
    if (anchor) obj.anchor = anchor;
    else delete obj.anchor;
    const json = JSON.stringify(obj);
    patchLocal(id, { dataJson: json });
    persist(id, { ...patch, dataJson: json });
  };

  // 文字框「滾輪調整大小」（調整中狀態的 T 版本）：等比縮放字級與框尺寸。
  // 滾輪連發 → 本地即時、持久化尾端去抖。
  const textWheelPersistTimer = useRef<number | null>(null);
  const adjustTextByWheel = (id: string, deltaY: number) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it || it.kind !== 'text') return;
    const factor = deltaY < 0 ? 1.06 : 1 / 1.06;
    const extra = parseTextExtra(it.dataJson);
    const fontSize = Math.min(120, Math.max(8, Math.round(extra.fontSize * factor)));
    const width = Math.max(40, Math.round(it.width * factor));
    const height = Math.max(24, Math.round(it.height * factor));
    // 合併寫入（保留 anchor 等其他欄位）。
    patchLocal(id, { dataJson: JSON.stringify({ ...rawDataObj(it), fontSize }), width, height });
    if (textWheelPersistTimer.current != null) window.clearTimeout(textWheelPersistTimer.current);
    textWheelPersistTimer.current = window.setTimeout(() => {
      textWheelPersistTimer.current = null;
      const cur = itemsRef.current.find((x) => x.id === id);
      if (cur) persist(id, { dataJson: cur.dataJson, width: cur.width, height: cur.height });
    }, 500);
  };

  // 點文字框與其屬性面板 / 色盤以外的地方 → 取消選取（空框順手刪除）。
  useEffect(() => {
    if (!selectedTextId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t?.closest('[data-testid="anno-text"]') ||
        t?.closest('[data-draw-textprops]') ||
        t?.closest('[data-draw-textpop]')
      ) return;
      const id = selectedTextId;
      setSelectedTextId(null);
      setEditingTextId(null);
      deleteIfEmpty(id);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTextId]);

  // 換選取對象 / 取消選取時，把展開的色盤收起來。
  useEffect(() => {
    setShowTextFontPop(false);
    setShowTextBgPop(false);
  }, [selectedTextId]);

  // 點色盤與球球以外的地方 → 收起展開中的文字色盤。
  useEffect(() => {
    if (!showTextFontPop && !showTextBgPop) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-draw-textpop]') || t?.closest('[data-draw-textcolorbtn]')) return;
      setShowTextFontPop(false);
      setShowTextBgPop(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showTextFontPop, showTextBgPop]);

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
  const confirmRemove = async (item: NoteOverlayItem) => {
    const label = item.kind === 'sticky' ? '便利貼' : '圖片板';
    if (await confirm({ message: `刪除這張${label}？（之後可在「垃圾桶 → 便利貼」還原）`, danger: true })) remove(item.id);
  };

  // ── 圖片板 dataJson 結構 { title?, images, pinned? }：各欄共存，改一欄不動其他欄 ──
  /**
   * 讀取項目 dataJson 的「物件形式」並保留所有欄位；舊的純陣列（圖片板）視為 `{ images }`。
   * 供泛用地讀/寫共同欄位（如 pinned），不會把便利貼的 highlights 或圖片板的 images 弄丟。
   */
  const rawDataObj = (item: NoteOverlayItem): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(item.dataJson || '');
      if (Array.isArray(parsed)) return { images: parsed };
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch { /* 空/壞 → {} */ }
    return {};
  };
  /** 讀圖片板標題（相容舊的純陣列格式，見 parseSlideData）。 */
  const slideTitle = (item: NoteOverlayItem): string => parseSlideData(item.dataJson).title;
  /** 合併寫入圖片板 dataJson（保留既有所有欄位——含 pinned；並把舊的純陣列格式一併升級為物件格式）。 */
  const writeSlideData = (item: NoteOverlayItem, patch: Record<string, unknown>) => {
    const json = JSON.stringify({ ...rawDataObj(item), ...patch });
    patchLocal(item.id, { dataJson: json });
    persist(item.id, { dataJson: json });
  };
  /** 寫入 pinned 旗標（便利貼、圖片板皆可；各自保留其他欄位）。 */
  const setPinnedFlag = (item: NoteOverlayItem, pinned: boolean) => {
    if (item.kind === 'slide') writeSlideData(item, { pinned });
    else writeStickyData(item, { pinned });
  };

  // ── 標題（便利貼/圖片板通用）：兩者的標題都存在各自的 dataJson，讀/寫走各自的合併函式 ──
  /** 讀取項目標題（便利貼、圖片板皆可）。 */
  const itemTitle = (item: NoteOverlayItem): string =>
    item.kind === 'slide' ? slideTitle(item) : stickyTitle(item);
  /** 寫入項目標題（便利貼、圖片板皆可；各自保留另一欄資料）。 */
  const setItemTitle = (item: NoteOverlayItem, title: string) => {
    if (item.kind === 'slide') writeSlideData(item, { title });
    else writeStickyData(item, { title });
  };

  // ── 「釘住浮動 / 跟著內文」切換（#5）──
  // pinned=true：position:fixed、portal 到 body、可拖到整個畫面（含側欄），但不隨內文捲動（像章節目錄表）。
  // pinned=false（預設）：position:absolute 疊在內文上，隨內文捲動、被內文區裁切（原本的便利貼行為）。
  // x/y 的意義隨 pinned 改變（fixed＝視窗座標、absolute＝相對內文座標），切換時換算座標讓它停在原地。
  const isPinned = (item: NoteOverlayItem): boolean => rawDataObj(item).pinned === true;
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
    setPinnedFlag(item, pinned);
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
        // 歸位＝移到內文左上角 → 內容錨點已不代表它的位置，一併重建（左上角多半無文字 → 移除錨點）。
        const anchor = anchorAtContainerPoint(x, y);
        const obj = { ...rawDataObj(item) } as Record<string, unknown>;
        if (anchor) obj.anchor = anchor;
        else delete obj.anchor;
        if (isPinned(item)) obj.pinned = false;
        const json = JSON.stringify(obj);
        patchLocal(item.id, { x, y, dataJson: json });
        persist(item.id, { x, y, dataJson: json });
      });
  };

  // ── 便利貼/圖片板/文字框/手繪形狀「跟著所在的 toggle 一起收合」（使用者需求）──
  // 規格：非釘住（position:absolute、貼在內文上隨捲動）的便利貼/圖片板/文字框，以及每一個手繪形狀，
  // 若其錨定點下的內容所在的 <details class="md-toggle">（或其任一祖先 details）被收合，就一起「隱藏」；
  // 再展開就恢復（可逆）。釘住（fixed）者不受影響（它不貼著任何文字）。
  //
  // 【雙軌機制】
  // (A) 持久化「內容錨點」（新資料，建立當下寫入）：畫記建立時把「壓在哪段文字上」存成文字錨點
  //     （lib/overlayAnchor.ts），之後一律以文字重新定位——文字被收合（Range 無 rects）→ 隱藏；
  //     文字可見但位置改變（收合/展開其他段落造成位移、甚至重載後版面不同）→ 把畫記座標「跟著位移量」
  //     rebase 搬移。如此畫記永遠貼著它的文字，判定是純函式（同版面 → 同結果），且不依賴視窗可見性。
  //     【為什麼不能只用絕對座標＋點錨定】絕對座標只在「畫記當下的展開狀態」的版面正確；多層 toggle 下
  //     展開別的段落就會讓文字整段位移，畫記視覺上跑到別段文字上，點錨定也會在重抓時綁錯內容
  //     （2026-07-08 使用者於 reamde 筆記實測重現）。
  // (B) 點錨定 session 機制（舊資料回退，無持久化錨點者）：以錨定點下的 DOM 元素判定收合隱藏，
  //     行為與先前版本一致（絕對座標、不跟隨位移）。舊畫記重畫一次即自動升級為 (A)。
  const stickyAnchorRef = useRef<Map<string, Element>>(new Map());
  const [collapsedByToggle, setCollapsedByToggle] = useState<Set<string>>(new Set());
  const shapeAnchorsRef = useRef<Map<string, Element>>(new Map());
  const [hiddenShapeKeys, setHiddenShapeKeys] = useState<Set<string>>(new Set());
  // 最新 recompute 的 ref：供「items/shapes 變動」的去抖 effect 呼叫（函式本體定義於下方 effect 內）。
  const recomputeAnchorsRef = useRef<() => void>(() => {});
  // rebase 後待持久化的項目 id 與 drawing 髒旗標（rebase 高頻觸發 → 尾端去抖批次寫回後端）。
  const rebaseDirtyItemIdsRef = useRef<Set<string>>(new Set());
  const rebaseDrawingDirtyRef = useRef(false);
  const rebasePersistTimer = useRef<number | null>(null);
  /** 排程把 rebase 結果批次持久化（800ms 尾端去抖；讀 itemsRef/shapesRef 的最新值）。 */
  const scheduleRebasePersist = useCallback(() => {
    if (rebasePersistTimer.current != null) window.clearTimeout(rebasePersistTimer.current);
    rebasePersistTimer.current = window.setTimeout(() => {
      rebasePersistTimer.current = null;
      const ids = Array.from(rebaseDirtyItemIdsRef.current);
      rebaseDirtyItemIdsRef.current.clear();
      for (const id of ids) {
        const it = itemsRef.current.find((x) => x.id === id);
        if (it) persist(id, { x: it.x, y: it.y, dataJson: it.dataJson });
      }
      if (rebaseDrawingDirtyRef.current) {
        rebaseDrawingDirtyRef.current = false;
        const d = drawingRef.current;
        if (d) persist(d.id, { dataJson: JSON.stringify(shapesRef.current) });
      }
    }, 800);
  }, [persist]);
  /** 讀取項目的持久化內容錨點（無/壞 → null＝走舊點錨定回退）。 */
  const itemAnchor = (item: NoteOverlayItem): OverlayAnchor | null => {
    const a = rawDataObj(item).anchor;
    return isOverlayAnchor(a) ? a : null;
  };
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** 元素是否位於某個「收合中」的 <details.md-toggle> 內（純 DOM 祖先判斷，不依賴任何版面量測）。 */
    const inClosedToggle = (el: Element): boolean => {
      let p: Element | null = el;
      while (p && p !== container) {
        if (p instanceof HTMLDetailsElement && p.classList.contains('md-toggle') && !p.open) return true;
        p = p.parentElement;
      }
      return false;
    };

    /** 找錨定螢幕點下方「真正可見的內容元素」（在內文容器內、非 overlay、非 summary、不在收合 details 內）。 */
    const contentElAt = (px: number, py: number): Element | null => {
      if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return null; // 視窗外 → elementsFromPoint 無效
      for (const el of document.elementsFromPoint(px, py)) {
        if (el === container || !container.contains(el)) continue; // 跳過 overlay 與外部元素
        if (el.tagName === 'SUMMARY') continue;                    // 摘要列即使收合也可見，不當內容錨點
        if (inClosedToggle(el)) continue;                          // 只認可見內容
        return el;
      }
      return null;
    };

    /**
     * 通用的「錨定→判定隱藏」流程（項目級與形狀級共用同一套規則）。
     * @param anchors 錨點表（key → 內容元素）。
     * @param entries 待判定的 key 與其錨定螢幕點（pt 為 null＝點無法計算）。
     * @returns 目前應隱藏的 key 集合。
     */
    const computeHidden = (
      anchors: Map<string, Element>,
      entries: { key: string; pt: [number, number] | null }[],
    ): Set<string> => {
      const liveKeys = new Set(entries.map((e) => e.key));
      for (const k of Array.from(anchors.keys())) if (!liveKeys.has(k)) anchors.delete(k); // 清掉已不存在者

      const hidden = new Set<string>();
      for (const { key, pt } of entries) {
        const cur = anchors.get(key);
        const curHidden = !!cur && cur.isConnected && inClosedToggle(cur);
        if (!curHidden) {
          // 目前可見/未建立/已脫離 DOM → 依錨定點重抓錨點；已被收合藏起者則保留錨點、不重抓。
          const el = pt ? contentElAt(pt[0], pt[1]) : null;
          if (el) anchors.set(key, el);
          else if (!cur || !cur.isConnected) anchors.delete(key); // 點上無可用內容 → 無錨點（永遠顯示）
        }
        const a = anchors.get(key);
        if (a && a.isConnected && inClosedToggle(a)) hidden.add(key);
      }
      return hidden;
    };

    const recompute = () => {
      const origin = overlayRef.current?.getBoundingClientRect();
      if (!origin) return;
      // 一輪只序列化一次容器純文字，供本輪所有錨點重定位共用（大筆記×多畫記的成本控制）。
      const containerText = container.textContent ?? '';

      // ── (1) 項目級：便利貼/圖片板/文字框（非釘住者） ──
      const nonPinned = itemsRef.current.filter(
        (i) => (i.kind === 'sticky' || i.kind === 'slide' || i.kind === 'text') && !isPinned(i),
      );
      const hiddenItems = new Set<string>();
      const legacyItems: typeof nonPinned = [];
      for (const it of nonPinned) {
        const a = itemAnchor(it);
        if (!a) {
          legacyItems.push(it); // 無持久化錨點 → 舊點錨定回退
          continue;
        }
        const loc = locateAnchor(container, a, containerText);
        if (!loc) continue; // 錨定文字已不存在（內容被編輯掉）→ 絕對座標、永遠顯示
        if (!loc.visible) {
          hiddenItems.add(it.id); // 文字在收合的 toggle 內 → 一起隱藏
          continue;
        }
        if (it.id === draggingItemIdRef.current) continue; // 拖曳中 → 不與使用者搶位置
        // 文字可見但位置改變 → 座標跟著位移（rebase），並更新錨點基準位置。
        const dx = loc.x - a.ex;
        const dy = loc.y - a.ey;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const json = JSON.stringify({ ...rawDataObj(it), anchor: { ...a, ex: loc.x, ey: loc.y } });
          patchLocal(it.id, { x: it.x + dx, y: it.y + dy, dataJson: json });
          rebaseDirtyItemIdsRef.current.add(it.id);
        }
      }
      // 舊資料回退：點錨定 session 機制（絕對座標、只做隱藏判定）。
      const hiddenLegacy = computeHidden(
        stickyAnchorRef.current,
        legacyItems.map((it) => ({ key: it.id, pt: [origin.left + it.x, origin.top + it.y] as [number, number] })),
      );
      hiddenLegacy.forEach((id) => hiddenItems.add(id));
      setCollapsedByToggle((prev) => (sameStringSet(prev, hiddenItems) ? prev : hiddenItems));

      // ── (2) 形狀級 ──
      const hiddenShapes = new Set<string>();
      const legacyShapeEntries: { key: string; pt: [number, number] | null }[] = [];
      // 互動進行中（畫到一半/擦除中/建立空窗）不做位移 rebase，避免與暫存陣列打架；隱藏判定照算。
      const interacting =
        curShape.current !== null || eraseWork.current !== null || eraseBox.current !== null || creatingRef.current !== null;
      let shifted = false;
      const nextShapes = shapesRef.current.map((s) => {
        if (!s.anchor) {
          const pt = shapeAnchorPoint(s);
          legacyShapeEntries.push({
            key: JSON.stringify(s),
            pt: pt ? ([origin.left + pt[0], origin.top + pt[1]] as [number, number]) : null,
          });
          return s;
        }
        const loc = locateAnchor(container, s.anchor, containerText);
        if (!loc) return s; // 錨定文字不存在 → 絕對座標、永遠顯示
        if (!loc.visible) {
          hiddenShapes.add(JSON.stringify(s));
          return s;
        }
        const dx = loc.x - s.anchor.ex;
        const dy = loc.y - s.anchor.ey;
        if (interacting || (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5)) return s;
        shifted = true;
        return {
          ...s,
          points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
          anchor: { ...s.anchor, ex: loc.x, ey: loc.y },
        };
      });
      if (shifted && drawingRef.current) {
        shapesRef.current = nextShapes;
        patchLocal(drawingRef.current.id, { dataJson: JSON.stringify(nextShapes) });
        rebaseDrawingDirtyRef.current = true;
      }
      // 舊資料形狀：點錨定回退。
      const hiddenLegacyShapes = computeHidden(shapeAnchorsRef.current, legacyShapeEntries);
      hiddenLegacyShapes.forEach((k) => hiddenShapes.add(k));
      setHiddenShapeKeys((prev) => (sameStringSet(prev, hiddenShapes) ? prev : hiddenShapes));

      if (rebaseDirtyItemIdsRef.current.size > 0 || rebaseDrawingDirtyRef.current) scheduleRebasePersist();
    };
    recomputeAnchorsRef.current = recompute;

    // toggle 事件不冒泡 → 於容器用 capture 監聽，可涵蓋事後才注入的 details；開合當下立即重算。
    const onToggle = (e: Event) => {
      const d = e.target;
      if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('md-toggle')) return;
      recompute();
    };

    // 捲動/視窗改變 → 節流重算：讓「捲進視野」的既有畫記/便利貼漸進建立錨點。
    // 已建立且仍有效的錨點不會被此舉破壞（可見時重抓＝當下正確；隱藏時保留不動）。
    let throttleTimer: number | null = null;
    const scheduleRecompute = () => {
      if (throttleTimer != null) return;
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        recompute();
      }, 200);
    };

    container.addEventListener('toggle', onToggle, true);
    window.addEventListener('scroll', scheduleRecompute, true);
    window.addEventListener('resize', scheduleRecompute);
    recompute();
    return () => {
      container.removeEventListener('toggle', onToggle, true);
      window.removeEventListener('scroll', scheduleRecompute, true);
      window.removeEventListener('resize', scheduleRecompute);
      if (throttleTimer != null) window.clearTimeout(throttleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // 項目/形狀變動（畫完一筆、新增便利貼/文字框、載入完成…）→ 去抖重算錨點，
  // 讓「畫完當下（必在視野內）」就建立錨點；拖曳中每幀的 patchLocal 也會觸發，60ms 去抖合併。
  useEffect(() => {
    const id = window.setTimeout(() => recomputeAnchorsRef.current(), 60);
    return () => window.clearTimeout(id);
  }, [items]);

  // ── 拖曳 / 縮放 ──
  // 拖曳中的項目 id：rebase 不得動它（避免背景重算與使用者手動拖曳互相覆寫，對抗式復審 MEDIUM）。
  const draggingItemIdRef = useRef<string | null>(null);
  const startDrag = (e: React.PointerEvent, item: NoteOverlayItem, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    draggingItemIdRef.current = item.id;
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
      draggingItemIdRef.current = null;
      if (mode === 'move' && !isPinned(item)) {
        // 拖曳＝使用者把它放到新的文字上 → 重建內容錨點一併持久化（拖到無文字處則移除錨點、回絕對座標）。
        const anchor = anchorAtContainerPoint(next.x, next.y);
        const cur = itemsRef.current.find((x) => x.id === item.id) ?? item;
        const obj = { ...rawDataObj(cur) } as Record<string, unknown>;
        if (anchor) obj.anchor = anchor;
        else delete obj.anchor;
        const json = JSON.stringify(obj);
        patchLocal(item.id, { dataJson: json });
        persist(item.id, { x: next.x, y: next.y, dataJson: json });
      } else {
        persist(item.id, mode === 'move' ? { x: next.x, y: next.y } : { width: next.width, height: next.height });
      }
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

  const drawingRef = useRef<NoteOverlayItem | null>(drawing);
  drawingRef.current = drawing;
  // 建立 drawing 項目的 in-flight 守衛：避免「第一筆畫完、建立 POST 尚未回來時就 Ctrl+Z」
  // 導致重複建立第二個 drawing 項目。後續呼叫會等同一個建立完成、再更新同一項目。
  const creatingRef = useRef<Promise<void> | null>(null);

  // 以 ref 持有最新狀態，避免復原 / 重做的閉包鎖死過時物件（例如尚未建立的繪圖項目）。
  // 【對抗式復審修正】drawing 項目「建立中」（第一筆的 POST 往返空窗）時不要用 items 派生的
  // shapes（此刻仍是空陣列）蓋掉 setDrawingShapes 樂觀寫入的最新值——否則空窗期間第一筆會
  // 短暫消失、滾輪縮放/調色短路、甚至連畫第二筆會把第一筆蓋掉。
  const shapesRef = useRef<Shape[]>(shapes);
  if (!creatingRef.current) shapesRef.current = shapes;
  /** 畫面與互動實際採用的形狀來源（建立空窗期走樂觀值，其餘走 items 派生值）。 */
  const shapesForUi: Shape[] = creatingRef.current ? shapesRef.current : shapes;

  /** 把手繪寫入（local + 後端）；一律透過 drawingRef 取得「當前」繪圖項目，故供復原閉包安全沿用。 */
  const setDrawingShapes = async (next: Shape[]) => {
    shapesRef.current = next; // 立即同步，連續復原 / 重做不必等重繪
    // 復原/重做可能把形狀設回「rebase 前」的舊座標快照（rebase 不進 undo 堆疊）——
    // 明確排程一次錨點重算，讓有錨點的形狀立刻被 rebase 回目前版面的正確位置（對抗式復審 HIGH）。
    window.setTimeout(() => recomputeAnchorsRef.current(), 0);
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
        // POST 往返期間形狀可能又被更新（例如剛畫完立刻滾輪縮放）→ 以最新樂觀值回填，
        // 避免建立回應的初始 json 蓋掉空窗期的變更。
        const latest = JSON.stringify(shapesRef.current);
        if (latest !== created.dataJson) {
          setItems((prev) => [...prev, { ...created, dataJson: latest }]);
          persist(created.id, { dataJson: latest });
        } else {
          setItems((prev) => [...prev, created]);
        }
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
  // 含螢光筆的「會畫出形狀」工具（顏色/線寬可即時套到剛畫的圖形）。
  const isDrawShapeTool = isPenTool || tool === 'highlight';
  // 線寬滑桿目前控制的值：螢光筆用自己的較粗線寬，其餘用一般筆寬。
  const activeWidth = tool === 'highlight' ? highlightWidth : penWidth;

  // 「調整中」：剛畫完的幾何形狀（直線/矩形/橢圓/螢光直線）→ 滾輪調粗細、Del 刪除、左鍵點一下完成、
  // 完成後維持原工具模式可直接畫下一個。自由筆（free）不進調整中——手寫（如「坑」字）
  // 是連續多筆劃，若每一筆的起筆都被「完成上一筆」吃掉會完全無法書寫。
  const selectedShape =
    selectedShapeIdx !== null && selectedShapeIdx >= 0 && selectedShapeIdx < shapesForUi.length
      ? shapesForUi[selectedShapeIdx]
      : null;
  const adjustingShape = selectedShape !== null && selectedShape.type !== 'free' && isDrawShapeTool;

  /** 形狀目前是否因 toggle 收合而隱藏（隱藏者不得被擦除、不渲染）。 */
  const isHiddenShape = (s: Shape): boolean => hiddenShapeKeys.has(JSON.stringify(s));

  const relPoint = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onSvgDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // 只有左鍵作畫/擦除（右鍵留給「取消模式」，見 contextmenu 監聽）
    if (!tool || tool === 'erase-stroke') return; // 整筆刪除由各形狀自行接收點擊
    // 幾何形狀「調整中」→ 左鍵點一下＝完成（只結束調整、不開新的一筆），維持目前工具模式。
    if (adjustingShape) {
      setSelectedShapeIdx(null);
      return;
    }
    // 開始新的一筆 / 擦除 → 取消「可調整上一個形狀」的選取。
    setSelectedShapeIdx(null);
    const p = relPoint(e);
    // 抓住指標，跨出 SVG 仍持續繪圖 / 擦除；合成事件或無作用指標時可能拋錯，忽略即可。
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (tool === 'erase-area') {
      // 被收合隱藏的形狀不可被看不見地誤擦 → 只擦可見形狀。
      eraseWork.current = eraseVisibleOnly(shapesForUi, isHiddenShape, (sub) => eraseAt(sub, p[0], p[1], eraseRadius));
      forceRerender((n) => n + 1);
      return;
    }
    if (tool === 'erase-box') {
      eraseBox.current = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
      forceRerender((n) => n + 1);
      return;
    }
    if (tool === 'highlight' && highlightStraight) {
      // 螢光筆直線模式：筆直的半透明線（type:'line' + opacity），適合整行畫重點。
      curShape.current = {
        type: 'line', color: penColor, width: highlightWidth, dash: false,
        opacity: highlightOpacity, points: [p, p],
      };
    } else if (tool === 'pen' || tool === 'highlight') {
      // 螢光筆＝自由筆 + 較粗線寬 + 半透明（opacity）。
      curShape.current = {
        type: 'free', color: penColor,
        width: tool === 'highlight' ? highlightWidth : penWidth,
        dash: tool === 'highlight' ? false : penDash,
        ...(tool === 'highlight' ? { opacity: highlightOpacity } : {}),
        points: [p],
      };
    } else {
      curShape.current = { type: tool, color: penColor, width: penWidth, dash: penDash, points: [p, p] };
    }
    forceRerender((n) => n + 1);
  };
  const onSvgMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'erase-area' && eraseWork.current) {
      const p = relPoint(e);
      eraseWork.current = eraseVisibleOnly(eraseWork.current, isHiddenShape, (sub) => eraseAt(sub, p[0], p[1], eraseRadius));
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
      if (JSON.stringify(next) !== JSON.stringify(shapesForUi)) commitShapes(next);
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
      // 被收合隱藏的形狀不可被看不見地誤擦 → 只擦可見形狀。
      const next = eraseVisibleOnly(shapesForUi, isHiddenShape, (sub) => eraseInBox(sub, minX, minY, maxX, maxY));
      if (JSON.stringify(next) !== JSON.stringify(shapesForUi)) commitShapes(next);
      else forceRerender((n) => n + 1);
      return;
    }
    const s = curShape.current;
    curShape.current = null;
    if (!s) return;
    const ok = s.type === 'free' ? s.points.length > 1 : !samePoint(s.points[0], s.points[1]);
    if (ok) {
      // 建立內容錨點（畫記跟著文字走）：以形狀代表點下的文字為錨；無文字（空白區）→ 絕對座標。
      const pt = shapeAnchorPoint(s);
      if (pt) {
        const anchor = anchorAtContainerPoint(pt[0], pt[1]);
        if (anchor) s.anchor = anchor;
      }
      // 把剛畫好的形狀設為「可即時調整」對象（它會是陣列最後一個）。
      setSelectedShapeIdx(shapesForUi.length);
      commitShapes([...shapesForUi, s]);
    } else {
      forceRerender((n) => n + 1);
    }
  };
  const eraseShape = (idx: number) => {
    if (tool !== 'erase-stroke') return;
    setSelectedShapeIdx(null);
    commitShapes(shapesForUi.filter((_, i) => i !== idx));
  };
  const clearDrawing = async () => {
    if (!shapesForUi.length) return;
    if (!(await confirm({ message: '清除這張筆記上的所有手繪？（可用 Ctrl+Z 復原）', danger: true }))) return;
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
    // 螢光筆改它自己的線寬；其餘（含局部橡皮擦半徑）改一般筆寬。
    if (tool === 'highlight') setHighlightWidth(w);
    else setPenWidth(w);
    // 只有在繪圖形狀工具且有選取形狀時才回套到形狀。
    if (isDrawShapeTool) applyToSelected({ width: w });
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

  // ── 調整中形狀的「滾輪調粗細」（原生 wheel 監聽：React 合成事件是 passive，無法 preventDefault 擋捲動）──
  // 需求：滾輪調整的是「線條粗細」而非縮放範圍（範圍由拖曳兩端決定）。
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 以 ref 鏡像「調整中」的形狀索引，供原生監聽器取最新值（避免 stale closure）。
  const adjustingIdxRef = useRef<number | null>(null);
  adjustingIdxRef.current = adjustingShape ? selectedShapeIdx : null;
  // 滾輪連發 → 本地即時更新、持久化走尾端去抖（不能每一格都 PATCH 後端）。
  const wheelPersistTimer = useRef<number | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const idx = adjustingIdxRef.current;
      if (idx === null) return; // 非調整中 → 不攔截，頁面正常捲動
      e.preventDefault();
      const cur = shapesRef.current;
      if (idx < 0 || idx >= cur.length) return;
      const shape = cur[idx];
      // 螢光筆（半透明，opacity<1）線寬上限較粗（40），一般畫筆/形狀上限 20。
      const isHighlightShape = typeof shape.opacity === 'number' && shape.opacity < 1;
      const maxWidth = isHighlightShape ? 40 : 20;
      const step = e.deltaY < 0 ? 1 : -1; // 上滾變粗、下滾變細
      const nextWidth = Math.min(maxWidth, Math.max(1, shape.width + step));
      if (nextWidth === shape.width) return; // 已到上/下限：不動作、不排持久化
      const next = cur.map((s, i) => (i === idx ? { ...s, width: nextWidth } : s));
      shapesRef.current = next;
      // 讓工具列「線寬」滑桿同步反映（螢光筆用自己的線寬 state）。
      if (isHighlightShape) setHighlightWidth(nextWidth);
      else setPenWidth(nextWidth);
      const d = drawingRef.current;
      // drawing 項目建立中（第一筆的 POST 空窗）→ 沒有可 patch 的 item，改強制重繪
      //（畫面走 shapesForUi＝樂觀的 shapesRef，縮放仍即時可見）。
      if (d) patchLocal(d.id, { dataJson: JSON.stringify(next) });
      else forceRerender((n) => n + 1);
      if (wheelPersistTimer.current != null) window.clearTimeout(wheelPersistTimer.current);
      const schedulePersist = () => {
        wheelPersistTimer.current = window.setTimeout(() => {
          wheelPersistTimer.current = null;
          const dd = drawingRef.current;
          if (dd) persist(dd.id, { dataJson: JSON.stringify(shapesRef.current) });
          else if (creatingRef.current) schedulePersist(); // 建立還沒回來 → 稍後再試，勿丟失縮放結果
        }, 500);
      };
      schedulePersist();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 卸載時若滾輪調整尚未落地 → 立即持久化，避免遺失最後的縮放結果。
  useEffect(
    () => () => {
      if (wheelPersistTimer.current != null) {
        window.clearTimeout(wheelPersistTimer.current);
        const d = drawingRef.current;
        if (d) persist(d.id, { dataJson: JSON.stringify(shapesRef.current) });
      }
    },
    [persist],
  );

  // ── 右鍵＝取消目前的繪圖 / 文字模式（需求：右鍵點一下取消畫筆/形狀/螢光筆/文字）──
  // 僅在「有模式」時攔截（preventDefault 抑制該次右鍵選單）；平時右鍵完全不受影響。
  const toolRef = useRef<DrawTool>(tool);
  toolRef.current = tool;
  const selectedTextIdRef = useRef<string | null>(selectedTextId);
  selectedTextIdRef.current = selectedTextId;
  const deleteIfEmptyRef = useRef(deleteIfEmpty);
  deleteIfEmptyRef.current = deleteIfEmpty;
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const hasMode = toolRef.current !== null || selectedTextIdRef.current !== null;
      if (!hasMode) return;
      e.preventDefault();
      // 取消繪圖模式與調整中狀態；丟棄畫到一半的一筆與進行中的擦除。
      curShape.current = null;
      eraseWork.current = null;
      eraseBox.current = null;
      setSelectedShapeIdx(null);
      setTool(null);
      // 取消文字模式（選取/編輯中的文字框；空框順手刪除）。
      const textId = selectedTextIdRef.current;
      setSelectedTextId(null);
      setEditingTextId(null);
      if (textId) deleteIfEmptyRef.current(textId);
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  // ── Del＝刪除「調整中的形狀」或「已選取（非編輯中）的文字框」──（需求：調整狀態中的形狀/文字按 Del 刪除）
  // 以 ref 鏡像最新狀態與動作，讓全域 keydown 監聽器只掛一次、又不吃到過時閉包。
  const delRef = useRef<{
    selectedShapeIdx: number | null;
    adjustingShape: boolean;
    selectedTextId: string | null;
    editingTextId: string | null;
    deleteShapeAt: (i: number) => void;
    deleteSelectedText: () => void;
  }>(null!);
  delRef.current = {
    selectedShapeIdx,
    adjustingShape,
    selectedTextId,
    editingTextId,
    deleteShapeAt: (i: number) => {
      const cur = shapesRef.current;
      if (i >= 0 && i < cur.length) commitShapes(cur.filter((_, k) => k !== i)); // 可 Ctrl+Z 復原
      setSelectedShapeIdx(null);
    },
    deleteSelectedText,
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      // 在輸入框/可編輯區內打字時，Del 交給該元件刪字，不刪形狀/文字框。
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      const s = delRef.current;
      // 優先刪「調整中的形狀」；否則刪「已選取但非編輯中的文字框」。
      if (s.selectedShapeIdx !== null && s.adjustingShape) {
        e.preventDefault();
        s.deleteShapeAt(s.selectedShapeIdx);
        return;
      }
      if (s.selectedTextId && s.editingTextId === null) {
        e.preventDefault();
        s.deleteSelectedText();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 「剛畫完的形狀」缺少「點畫布外即取消」→ 選取可能一直殘留，之後一次無關的 Del 就會靜默刪掉它。
  // 比照文字框（見上方 selectedTextId 的 outside-pointerdown）：點在「繪圖 SVG／工具列／色盤」
  // 以外任何地方，即取消 selectedShapeIdx，把 Del 刪除的作用範圍收斂在「剛畫完、仍在畫布上操作」時。
  useEffect(() => {
    if (selectedShapeIdx === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (svgRef.current && svgRef.current.contains(t)) return; // SVG 內：交給 onSvgDown 處理（起新筆/完成）
      if (t.closest('[data-testid="overlay-toolbar"]') || t.closest('[data-draw-colorpop]')) return; // 工具列/色盤：調整中不取消
      setSelectedShapeIdx(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selectedShapeIdx]);

  const allShapes = eraseWork.current
    ? eraseWork.current
    : curShape.current
      ? [...shapesForUi, curShape.current]
      : shapesForUi;
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
          background: item.color || (isSticky ? STICKY_COLORS[0] : 'var(--bg-surface)'),
        }}
        onPointerDown={() => bringToFront(item)}
        data-testid={`overlay-item-${item.kind}`}
        data-overlay-id={item.id}
      >
        <div
          className="overlay-item-chrome"
          onPointerDown={(e) => startDrag(e, item, 'move')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px 2px 6px', cursor: 'move', background: 'rgba(0,0,0,0.06)', flexShrink: 0,
          }}
        >
          {/* 標題：便利貼與圖片板都可點擊自訂（各自存在自己的 dataJson）。 */}
          {editingTitleId === item.id ? (
            <input
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => { setItemTitle(item, titleDraft.trim()); setEditingTitleId(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditingTitleId(null);
              }}
              placeholder={isSticky ? '便利貼標題…' : '圖片板標題…'}
              style={{
                flex: 1, minWidth: 0, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 3,
                padding: '0 4px', fontSize: 'var(--text-xs)', background: 'rgba(255,255,255,0.8)', color: '#333', outline: 'none',
              }}
            />
          ) : (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setTitleDraft(itemTitle(item));
                setEditingTitleId(item.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="點擊修改標題"
              style={{
                flex: '0 1 auto', maxWidth: '50%', minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {itemTitle(item) || (isSticky ? '便利貼' : '圖片板')}
            </span>
          )}
          {/* 可拖曳的留白（標題與按鈕之間）：讓人好抓著拖曳整張便利貼。 */}
          {editingTitleId !== item.id && (
            <span aria-hidden="true" style={{ flex: 1, alignSelf: 'stretch', cursor: 'move' }} />
          )}
          {/* ❓ 設為問題 / 移除問題（僅便利貼；標記後會出現在「問題清單」中） */}
          {isSticky && (
            <button
              onClick={() => toggleQuestion(item)}
              onPointerDown={(e) => e.stopPropagation()}
              title={item.isQuestion ? '移除問題標記' : '設為問題'}
              data-testid="overlay-item-question"
              style={{
                ...chromeBtnStyle,
                opacity: item.isQuestion ? 1 : 0.5,
                color: item.isQuestion ? 'var(--action-primary-bg, #2563eb)' : 'var(--text-tertiary)',
              }}
            >
              ❓
            </button>
          )}
          {/* 📌 釘住浮動 / 跟著內文 切換（便利貼、圖片板皆可） */}
          <button
            onClick={() => togglePin(item)}
            onPointerDown={(e) => e.stopPropagation()}
            title={pinned ? '已釘住浮動（可拖到任何地方）；點擊改為跟著內文捲動' : '跟著內文捲動；點擊改為釘住浮動、可拖到任何地方'}
            data-testid="overlay-item-pin"
            style={{ ...chromeBtnStyle, opacity: pinned ? 1 : 0.5 }}
          >
            📌
          </button>
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
            onImagesChange={(imgs) => writeSlideData(item, { images: imgs })}
            onColor={(c) => { patchLocal(item.id, { color: c }); persist(item.id, { color: c }); }}
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
        ref={overlayRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, overflow: 'hidden' }}
        data-testid="note-overlay"
      >
        {/* 手繪 SVG（繪圖中捕捉指標；否則僅顯示、指標穿透）。高度含手動加高（extraHeight）。 */}
        <svg
          ref={svgRef}
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
          {allShapes.map((s, i) =>
            // 被 toggle 收合隱藏者不渲染，但「保留原始索引 i」（渲染 null、不可 filter 重排——
            // 整筆刪除 eraseShape(i) 依索引對應完整 shapes 陣列，位移會刪錯形狀）。
            // 進行中的一筆（curShape）永遠可見。
            s !== curShape.current && hiddenShapeKeys.has(JSON.stringify(s)) ? null : (
              <ShapeEl
                key={i}
                s={s}
                erasable={tool === 'erase-stroke'}
                onErase={() => eraseShape(i)}
              />
            )
          )}
          {/* 調整中的幾何形狀：虛線外接框提示（滾輪縮放、左鍵點一下完成）。 */}
          {adjustingShape && selectedShape && (() => {
            const xs = selectedShape.points.map((p) => p[0]);
            const ys = selectedShape.points.map((p) => p[1]);
            const pad = selectedShape.width / 2 + 4;
            const minX = Math.min(...xs) - pad;
            const minY = Math.min(...ys) - pad;
            return (
              <rect
                data-testid="overlay-adjusting"
                x={minX}
                y={minY}
                width={Math.max(...xs) + pad - minX}
                height={Math.max(...ys) + pad - minY}
                fill="none"
                stroke="var(--action-primary-bg, #2563eb)"
                strokeWidth={1}
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />
            );
          })()}
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
        {/* 非 pinned 便利貼/圖片板：position:absolute 疊在內文上、隨內文捲動、被內文區裁切（原本行為）。
            collapsedByToggle 內者＝其左上角所在的 toggle 目前收合中 → 一起隱藏（展開 toggle 即恢復）。 */}
        {items
          .filter((i) => (i.kind === 'sticky' || i.kind === 'slide') && !isPinned(i) && !collapsedByToggle.has(i.id))
          .map(renderOverlayItem)}
        {/* 純文字框（Snipaste 風格：可打字、設背景、旋轉縮放；與開問啦畫布共用元件）。
            繪圖中時設為不可互動，讓底下手繪 SVG 接管指標。
            collapsedByToggle 內者＝其所在的 toggle 目前收合中 → 一起隱藏（展開即恢復）。 */}
        {items.filter((i) => i.kind === 'text' && !collapsedByToggle.has(i.id)).map((item) => (
          <DrawingTextBox
            key={item.id}
            item={item}
            overlayId={item.id}
            zoomRef={noteZoomRef}
            toFlow={toFlow}
            selected={selectedTextId === item.id}
            editing={editingTextId === item.id}
            interactive={!drawingActive}
            onSelect={() => { bringToFront(item); setSelectedTextId(item.id); }}
            onStartEdit={() => { setSelectedTextId(item.id); setEditingTextId(item.id); }}
            onStopEdit={() => { setEditingTextId(null); deleteIfEmpty(item.id); }}
            onChange={(patch) => patchLocal(item.id, patch)}
            onCommit={(patch) => commitTextItemPatch(item.id, patch)}
            onAdjustWheel={(deltaY) => adjustTextByWheel(item.id, deltaY)}
            isQuestion={item.isQuestion}
            onToggleQuestion={() => toggleQuestion(item)}
          />
        ))}
      </div>

      {/* pinned 便利貼/圖片板：portal 至 body、position:fixed → 可自由拖到整個畫面（含側欄），不隨內文捲動。
          （只限 sticky/slide——文字框沒有釘住功能，誤入會走錯渲染分支。） */}
      {mounted && createPortal(
        <>{items.filter((i) => (i.kind === 'sticky' || i.kind === 'slide') && isPinned(i)).map(renderOverlayItem)}</>,
        document.body,
      )}

      {/* 工具列：portal 至 body 並 position:fixed → 捲動內文時固定不動。
          使用與開問啦畫布共用的 DrawingToolbar（三列版面）；筆記專屬的「歸位 / ＋高 / −高」放在情境控制列。 */}
      {mounted && createPortal(
        <DrawingToolbar
          testIdPrefix="overlay"
          position={{ bottom: 24, right: 24 }}
          maxWidth={380}
          leading={{
            label: '📖 目錄',
            title: tocOpen ? '關閉章節目錄表' : '開啟章節目錄表',
            onClick: () => onToggleToc?.(),
            active: tocOpen,
            testId: 'overlay-toggle-toc',
          }}
          onAddSticky={addSticky}
          onAddSlide={addSlide}
          onAddText={addTextBox}
          tool={tool}
          onSelectTool={selectTool}
          penColor={penColor}
          showPenColor={showPenColor}
          onTogglePenColor={() => setShowPenColor((v) => !v)}
          onPenColorChange={changePenColor}
          penWidth={activeWidth}
          onPenWidthChange={changePenWidth}
          penDash={penDash}
          onToggleDash={togglePenDash}
          highlightOpacity={highlightOpacity}
          onHighlightOpacityChange={setHighlightOpacity}
          highlightStraight={highlightStraight}
          onToggleHighlightStraight={() => setHighlightStraight((v) => !v)}
          adjustHint={adjustingShape ? '滾輪調粗細・Del 刪除・左鍵點一下完成' : undefined}
          eraseRadius={eraseRadius}
          selectedShapeIdx={selectedShapeIdx}
          hasShapes={shapesForUi.length > 0}
          onClear={clearDrawing}
          drawingActive={drawingActive}
          onDone={() => { setSelectedShapeIdx(null); setTool(null); }}
          extraControls={(items.some((i) => i.kind !== 'drawing') || drawingActive) ? (
            <>
              {items.some((i) => i.kind !== 'drawing') && (
                <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={gatherStrayItems} title="歸位：把所有便利貼/圖片板/文字框拉回左上角（救回被拖到看不見、抓不回來的）" data-testid="overlay-gather">↺ 歸位</button>
              )}
              {drawingActive && (
                <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={growCanvas} title="加高繪圖區（往下擴充，可放更多便利貼/塗鴉/輪播）" data-testid="overlay-grow">＋高</button>
              )}
              {drawingActive && extraHeight > 0 && (
                <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={shrinkCanvas} title="降低繪圖區高度" data-testid="overlay-shrink">−高</button>
              )}
            </>
          ) : undefined}
          topContent={selectedTextItem ? (
            <TextPropsPanel
              testIdPrefix="overlay"
              fontColor={selectedTextItem.color || '#ef4444'}
              dataJson={selectedTextItem.dataJson}
              onSetFontColor={setTextColor}
              onUpdateExtra={updateTextExtra}
              showFontPop={showTextFontPop}
              showBgPop={showTextBgPop}
              onToggleFontPop={() => { setShowTextBgPop(false); setShowTextFontPop((v) => !v); }}
              onToggleBgPop={() => { setShowTextFontPop(false); setShowTextBgPop((v) => !v); }}
              onDelete={deleteSelectedText}
            />
          ) : null}
        />,
        document.body,
      )}

      {/* 問題清單面板（由本元件渲染，因需存取 overlay items 與回答狀態；開關由頁面工具列鈕控制）。 */}
      {mounted && questionPanelOpen && (
        <NoteQuestionListPanel
          questions={questionItems}
          onLocate={handleLocateQuestion}
          onAnswer={(item) => openAnswerPopup(item.id)}
          onClose={() => onQuestionPanelOpenChange?.(false)}
        />
      )}

      {/* 答題彈窗（可多開；狀態只存 React、刷新即消失）。 */}
      {mounted && openAnswerItemIds.map((itemId, index) => {
        const item = items.find((i) => i.id === itemId);
        if (!item) return null;
        return (
          <QuestionAnswerPopup
            key={itemId}
            itemId={item.id}
            noteId={noteId}
            kind={item.kind === 'text' ? 'text' : 'sticky'}
            questionTitle={deriveQuestionTitle(item.kind, item.text, item.dataJson)}
            questionText={item.text ?? ''}
            initialAnswer={item.questionAnswer ?? ''}
            offsetIndex={index}
            onClose={() => closeAnswerPopup(itemId)}
            onSaved={(answer) => onAnswerSaved(itemId, answer)}
          />
        );
      })}
    </>
  );
}
