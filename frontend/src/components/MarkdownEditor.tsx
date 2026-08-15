"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ToggleAwareMarkdown } from "@/components/MarkdownPreview";
import { TOGGLE_SNIPPET, PROTECT_SNIPPET } from "@/lib/toggleBlocks";
import {
  emptyFoldState,
  expandDisplay,
  findBadgeAt,
  foldAll,
  foldBlockAt,
  listToggleBlocks,
  mapDisplayRangeToFull,
  unfoldAll,
  unfoldBlock,
  validateEdit,
  type FoldState,
} from "@/lib/editorFolding";
import {
  CONTINUATION_LINE_PATTERN,
  collapseTableRowBreaks,
  continuationInsertFor,
  listJoinRegions,
  listTableLineFlags,
  mapExpandedRangeToCollapsed,
  safeExpandTableRowBreaks,
  unescapedPipePositions,
  type JoinRegion,
} from "@/lib/tableBreakView";
import { uploadAttachment } from "@/lib/api";
import { showToast } from "@/lib/toast";

/**
 * 編輯模式摺疊（editor folding）對外 API：
 * 供 NoteAiActions（局部排版）等「直接讀 textarea 選取座標」的外部元件，
 * 把「顯示座標」映射回「完整文字座標」——摺疊啟用時兩者不相等，直接切字串會毀損內容。
 */
export interface EditorFoldApi {
  /** 把 textarea 顯示座標範圍映射回完整文字座標；範圍與摺疊徽章嚴格相交時回 null。 */
  mapSelectionToFull: (start: number, end: number) => { start: number; end: number } | null;
  /** 目前是否有任何摺疊中的區塊。 */
  hasFolds: () => boolean;
  /** 展開全部摺疊。 */
  unfoldAll: () => void;
}

/** 摺疊視圖快照：顯示文字＋摺疊狀態＋表格視圖層旗標（單一 state，確保永遠一致更新）。 */
interface FoldSnapshot {
  /** textarea 顯示的文字（＝完整文字，但摺疊區塊只剩標頭＋徽章、表格列 <br> 展開成 ↳ 續行）。 */
  display: string;
  /** 摺疊狀態（隱藏內文與墓碑）。 */
  state: FoldState;
  /**
   * 表格 <br> 視圖層是否啟用。safeExpandTableRowBreaks round-trip 驗證失敗（病態內容，
   * 如原文本來就有「表格列＋次行行首 ↳」）＝停用：applyEdit 不做 collapse、Shift+Enter
   * 不攔、複製不轉換——安全網涵蓋整個編輯生命週期，不只初始化（對抗式復審 C-2）。
   */
  tableViewOn: boolean;
}

/**
 * 以「完整文字」建立視圖快照：表格列 <br> 展開成續行顯示形（round-trip 驗證失敗＝停用
 * 視圖層、display=原文），摺疊一律歸零（外部變更後徽章對不上內容）。
 * 分層順序：full →（表格展開）→ expanded →（摺疊收合）→ display；摺疊是外層。
 * @param full 完整文字（onChange 對外的形）。
 * @returns 新的視圖快照。
 */
function makeViewSnapshot(full: string): FoldSnapshot {
  const { display, enabled } = safeExpandTableRowBreaks(full);
  return { display, state: emptyFoldState, tableViewOn: enabled };
}

/**
 * 把選取範圍擴張到「完整覆蓋」所有相交的 join 區（換行＋墊片＋↳＋可選空白），
 * 避免選取式編輯（刪除/取代/剪下）留下半殘標記外漏進完整文字（對抗式復審 H-2）。
 * @param regions display 的 join 區清單。
 * @param start 選取起點。
 * @param end 選取終點。
 * @returns 擴張後的範圍（未相交＝原樣）。
 */
function extendRangeOverJoins(
  regions: JoinRegion[],
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  let e = end;
  for (const region of regions) {
    if (s > region.start && s < region.contentStart) s = region.start;
    if (e > region.start && e < region.contentStart) e = region.contentStart;
  }
  return { start: s, end: e };
}

/** 摺疊 gutter 的單一按鈕位置資訊。 */
interface GutterMark {
  /** 對應區塊的標頭行行首（display 座標）。 */
  headerStart: number;
  /** 按鈕在內容座標的 Y 位置（px，含 padding-top）。 */
  y: number;
  /** 該區塊是否已摺疊。 */
  folded: boolean;
  /** 已摺疊時的紀錄 id。 */
  foldId?: string;
}

/** 彈出預覽視窗與編輯器之間的即時同步頻道名稱（同源 BroadcastChannel）。 */
export const PREVIEW_CHANNEL = "zonwiki:note-preview";

/**
 * 「表格」按鈕插入的範例——展示互動表格控件語法，讓使用者照著改、不必背語法。
 * 表頭尾碼 {radio:選項…} → 該欄渲染成單選 chip；選項可加 =顏色（如 未看=red）讓 chip 帶色；
 * {checkbox} → 勾選框；存檔後在讀模式可直接點選、欄排序、欄篩選、雙擊右鍵改儲存格內容。
 * 備註欄把「怎麼寫」直接寫進範例，使用者刪掉說明即成自己的表格。
 */
const INTERACTIVE_TABLE_SNIPPET = [
  "| 狀態{radio:未看=red,考慮中=amber,已投遞=green,已婉拒=gray,暫不考慮=slate} | 項目 | 完成{checkbox} | 備註 |",
  "| --- | --- | --- | --- |",
  "| 未看 | 範例一 | [ ] | 表頭 {radio:選項=顏色,…} → 單選 chip 帶色；顏色可用 red/orange/amber/green/teal/blue/purple/pink/gray/slate 或 #16a34a |",
  "| 已投遞 | 範例二 | [x] | 不寫 =顏色就用預設色；{checkbox} → 勾選框；存檔後讀模式可直接點選、排序、篩選、雙擊右鍵改格 |",
].join("\n");

/**
 * 「快速連點兩下右鍵」判定的間隔上限（毫秒）。
 * 間隔判定 pin 在 Date.now()（不可改用 event.timeStamp / performance.now()——
 * 單元測試以 vi.spyOn(Date, 'now') 控制間隔，換來源會讓測試控不到時間）。
 */
const DOUBLE_RIGHT_CLICK_MS = 500;

/** PiP 置頂預覽視窗的預設尺寸（px；與既有 window.open 彈出預覽相同）。 */
const PIP_WIDTH = 780;
const PIP_HEIGHT = 920;

/** 摺疊 gutter 量測的 debounce（毫秒）：停止輸入這麼久後才重量測（大筆記每鍵重量測會拖慢輸入）。 */
const GUTTER_MEASURE_DEBOUNCE_MS = 120;

/** 右鍵定位時，往上找到的「區塊級」元素標籤（與 /notes/preview-popout 頁的清單一致）。 */
const PIP_BLOCK_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "SUMMARY", "TD", "TH", "PRE", "BLOCKQUOTE"]);

/**
 * Document Picture-in-Picture 的最小型別（lib.dom 尚未內建；僅 Chromium 系支援）。
 * requestWindow 回傳的 Window 由瀏覽器保證「永遠置頂（always-on-top）」。
 */
interface DocumentPictureInPictureLike {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

/**
 * 共用 Markdown 編輯器：文字輸入框 + 格式工具列。
 *
 * 工具列同時支援兩種用法：
 * - 先框選文字，再按格式鍵 → 套用到選取範圍（粗體、H1、程式碼區塊…）。
 * - 不選文字直接按格式鍵 → 插入標記並把游標放到正確位置，接著打字即可。
 *
 * 不熟 Markdown 的人也能用按鈕快速產生格式；熟的人仍可直接打字。
 * 可選 withPreview：提供 編輯／並排／預覽 三種檢視，並可把預覽「彈出成獨立視窗」即時同步。
 * 可選 defaultView／rightClickTogglesEdit／popoutAlwaysOnTop：供答題彈窗這類「以閱讀為主」
 * 的呼叫端使用（打開就是預覽、雙右鍵切編輯、彈出預覽走 Document PiP 置頂視窗）。
 */
type ViewMode = "edit" | "split" | "preview";

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  minHeight = 200,
  withPreview = false,
  defaultView = "edit",
  rightClickTogglesEdit = false,
  popoutAlwaysOnTop = false,
  className,
  textareaClassName,
  ariaLabel = "Markdown 編輯器",
  taRef,
  foldApiRef,
  onUploadingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  /** textarea 失焦時觸發（例如即時存檔）。 */
  onBlur?: () => void;
  placeholder?: string;
  /** 編輯區最小高度（px）。 */
  minHeight?: number;
  /** 是否提供 編輯／並排／預覽 切換（以及「彈出預覽」）。 */
  withPreview?: boolean;
  /** 初始檢視模式（僅 withPreview 時有意義；答題彈窗要「打開就是預覽」）。 */
  defaultView?: ViewMode;
  /**
   * 「預覽」檢視中快速連點兩下右鍵＝切回編輯模式，並抑制瀏覽器右鍵選單
   * （只作用於預覽檢視的預覽窗格；並排/編輯檢視維持原生右鍵行為）。
   */
  rightClickTogglesEdit?: boolean;
  /**
   * 「⬈ 彈出預覽」優先使用 Document Picture-in-Picture 開「永遠置頂」的預覽視窗
   * （不會被主視窗或其他應用程式蓋掉；僅 Chromium 系支援）。
   * 不支援或開啟失敗時自動退回既有的 window.open 獨立視窗。
   */
  popoutAlwaysOnTop?: boolean;
  /** 外層額外 class（例如畫布需要 nodrag）。 */
  className?: string;
  /** textarea 額外 class（沿用既有樣式時）。 */
  textareaClassName?: string;
  ariaLabel?: string;
  /** 上層若需讀取目前選取範圍（如「局部排版」），可傳入 ref 取得 textarea 元素。 */
  taRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * 編輯模式摺疊 API（選配）：外部元件要用 textarea 選取座標切內容時，
   * 必須經由此 API 把顯示座標映射回完整文字座標（摺疊時兩者不相等）。
   */
  foldApiRef?: React.RefObject<EditorFoldApi | null>;
  /**
   * 圖片上傳進行中數量變動時回呼（0 = 全部完成）。
   * 上層應在數量 > 0 時 disable「保存」與 AI 重排等會覆寫內容的動作，
   * 避免把「〔圖片上傳中 #xxx〕」佔位文字永久存進資料庫。
   */
  onUploadingChange?: (count: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<ViewMode>(defaultView);
  // 「彈出預覽獨立視窗」狀態與同步頻道。
  const [poppedOut, setPoppedOut] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const popupRef = useRef<Window | null>(null);
  // Document PiP（置頂）彈出預覽：視窗參考＋portal 掛載容器（非 null＝PiP 模式進行中）。
  const pipWindowRef = useRef<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  // PiP 開啟請求進行中旗標：requestWindow 是非同步、resolve 前按鈕仍可按——
  // 防「連點兩下開出兩個 PiP、先開的失去參照變孤兒」（對抗式復審 HIGH）。
  const pipRequestInFlightRef = useRef(false);
  // 元件是否已卸載：PiP 請求 pending 期間彈窗被關（元件卸載）時，resolve 後必須
  // 直接關掉剛開出的視窗、不碰 state——否則留下使用者關不掉的孤兒置頂視窗（對抗式復審 HIGH）。
  const unmountedRef = useRef(false);
  // 「快速連點兩下右鍵」的上一次右鍵時間戳（Date.now()；0＝尚無前一擊）。
  const lastRightClickAtRef = useRef(0);

  // 以 ref 持有最新內容，供 openPopout 的非同步 onmessage 取用最新值（避免讀 ref.current 觸發編譯器規則）。
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // ─── 編輯模式視圖層（摺疊＋表格 <br> 展開）───────────────────────────
  // textarea 顯示「display 文字」（摺疊區塊只剩標頭＋徽章、表格列 <br> 展開成 ↳ 續行）；
  // 對外 onChange 永遠送「先展徽章、再收斂表格」後的完整文字。
  // 視圖操作（摺疊/展開）本身不改內容、不觸發 onChange。
  const [fold, setFold] = useState<FoldSnapshot>(() => makeViewSnapshot(value));
  // 最後一次「本編輯器發出（或同步過）」的完整文字：value prop 與它不同＝外部變更
  //（AI 重排、預覽勾核取方塊等）→ 重設視圖（摺疊歸零、表格重新展開），避免徽章對不上內容。
  // 用 state（非 ref）做 render 期間比較——React 官方「調整衍生 state」模式，立即以新值重繪不閃舊畫面。
  const [lastSyncedFull, setLastSyncedFull] = useState(value);
  if (value !== lastSyncedFull) {
    setLastSyncedFull(value);
    setFold(makeViewSnapshot(value));
  }
  // 非同步回呼（貼圖上傳完成等）需要最新摺疊快照（effect 於 commit 後同步；事件都在 commit 後發生）。
  const foldRef = useRef(fold);
  useEffect(() => {
    foldRef.current = fold;
  }, [fold]);
  const display = fold.display;
  // 最近一次已知良好的選取範圍（驗證拒絕還原時把游標放回原位）。
  const lastGoodSelRef = useRef<[number, number]>([0, 0]);

  /**
   * 套用一次「內容編輯」（使用者打字、工具列、貼圖佔位…都走這裡）：
   * 驗證徽章完整性 → 展開成完整文字 → onChange 對外。驗證失敗＝拒絕（還原顯示、toast）。
   */
  const applyEdit = (newDisplay: string) => {
    const f = foldRef.current;
    const v = validateEdit(newDisplay, f.state);
    if (!v.ok) {
      showToast(
        v.reason === "duplicated"
          ? "摺疊徽章被複製成多份，這次編輯已還原（請先展開再複製該區塊）"
          : "摺疊徽章被改壞，這次編輯已還原（點徽章可展開區塊）",
        { type: "error" },
      );
      // 受控 textarea：state 沒變 React 不會重繪 → 觸發一次重繪把 DOM 值拉回，游標回原位。
      setFold((prev) => ({ ...prev }));
      const [s, e] = lastGoodSelRef.current;
      restore(s, e);
      return;
    }
    if (v.deletedIds.length > 0) {
      showToast("已刪除摺疊區塊（含其隱藏內容）；Ctrl+Z 可復原", { type: "info" });
    }
    // 分層順序不可反（對抗式復審 C-1）：先展徽章（hiddenText 可能藏著展開形的表格列）、
    // 再收斂表格續行。視圖層停用（tableViewOn=false）＝不 collapse，保住使用者的字面 ↳ 行。
    const expanded = expandDisplay(newDisplay, v.state);
    const full = f.tableViewOn ? collapseTableRowBreaks(expanded) : expanded;
    setLastSyncedFull(full);
    setFold({ display: newDisplay, state: v.state, tableViewOn: f.tableViewOn });
    onChange(full);
  };

  // 目前 display 中的 toggle 區塊（含已摺疊者）；驅動 gutter 與工具列摺疊鈕。
  const toggleBlocks = useMemo(() => listToggleBlocks(fold.display, fold.state), [fold]);
  const hasToggleBlocks = toggleBlocks.length > 0;

  // 摺疊 gutter：各 toggle 標頭行的 Y 位置（鏡像量測），與 textarea 捲動同步。
  const [gutterMarks, setGutterMarks] = useState<GutterMark[]>([]);
  const [measureTick, setMeasureTick] = useState(0);
  const gutterInnerRef = useRef<HTMLDivElement>(null);
  // 表格管線標示背景層的內容容器（捲動時與 textarea 同步 translateY）。
  const pipeInnerRef = useRef<HTMLDivElement>(null);

  /** 摺疊/展開等「純視圖」變更（內容不變、不觸發 onChange；表格視圖旗標原樣保留）。 */
  const applyFoldView = (next: { display: string; state: FoldState }) =>
    setFold((prev) => ({ ...next, tableViewOn: prev.tableViewOn }));

  /** 展開全部（工具列鈕與 fold API 共用）。 */
  const unfoldAllView = () =>
    setFold((f) => ({ ...unfoldAll(f.display, f.state), tableViewOn: f.tableViewOn }));

  // 對外曝露摺疊 API（每次 render 更新，unmount 清空）。
  useEffect(() => {
    if (!foldApiRef) return;
    foldApiRef.current = {
      // 映射順序（對抗式復審 C-1）：先徽章映射（display → 徽章展開形），再 join 收斂映射
      //（徽章展開形 → 完整文字）——分層是 full →表格展開→ expanded →摺疊→ display。
      mapSelectionToFull: (s, e) => {
        const f = foldRef.current;
        const badgeMapped = mapDisplayRangeToFull(f.display, f.state, s, e);
        if (!badgeMapped || !f.tableViewOn) return badgeMapped;
        const expanded = expandDisplay(f.display, f.state);
        return mapExpandedRangeToCollapsed(expanded, badgeMapped.start, badgeMapped.end);
      },
      hasFolds: () => foldRef.current.state.records.length > 0,
      unfoldAll: unfoldAllView,
    };
    return () => {
      foldApiRef.current = null;
    };
  });

  // 把內部 textarea 元素同步到（可選的）外部 taRef，供上層讀取選取範圍（局部排版）。
  useEffect(() => {
    if (taRef) taRef.current = ref.current;
  });

  /** 關閉彈出預覽（釋放頻道、標記為未彈出）。 */
  const closePopout = () => {
    channelRef.current?.close();
    channelRef.current = null;
    setPoppedOut(false);
  };

  /**
   * 依「文字前綴」在編輯框找到來源行，把該行捲到編輯框頂端（供彈出預覽右鍵某行時定位）。
   * 用鏡像 div 量測「該字元位置之前的內容高度」＝該行 Y 位移，能正確處理自動換行。
   */
  const scrollEditorToText = (text: string) => {
    const ta = ref.current;
    const target = text.trim();
    if (!ta || !target) return;
    const idx = ta.value.indexOf(target);
    if (idx < 0) {
      // 目標可能藏在「已摺疊」區塊內：確認完整文字找得到才展開全部、下一幀重試一次
      //（展開後 records 清空，重試不會再走進這個分支——天然防遞迴）。
      const f = foldRef.current;
      if (f.state.records.length > 0 && expandDisplay(f.display, f.state).includes(target)) {
        unfoldAllView();
        requestAnimationFrame(() => scrollEditorToText(text));
      }
      return;
    }
    const cs = window.getComputedStyle(ta);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = "break-word";
    mirror.style.boxSizing = "content-box";
    mirror.style.width = `${Math.max(0, ta.clientWidth - padL - padR)}px`;
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.fontWeight = cs.fontWeight;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.textContent = ta.value.slice(0, idx) || " ";
    document.body.appendChild(mirror);
    const y = mirror.scrollHeight; // 該行之前的內容高度＝該行在內容座標的 Y
    document.body.removeChild(mirror);
    ta.focus();
    ta.setSelectionRange(idx, idx);
    ta.scrollTop = Math.max(0, y); // 讓該行落在可視內容頂端
  };

  /**
   * 關閉 Document PiP 置頂預覽並恢復內嵌預覽。
   * closeWindow=true＝使用者按「⇲ 收回預覽」主動關（要呼叫 close()）；
   * false＝視窗已被關（pagehide：使用者關窗、或同分頁開了另一個 PiP 被擠掉）只需復位狀態。
   * 兩條路徑可能連續發生（close() 會再觸發 pagehide），狀態復位為冪等、重跑無害。
   */
  const closePipPopout = (closeWindow: boolean) => {
    if (closeWindow) {
      try { pipWindowRef.current?.close(); } catch { /* 視窗已關閉時忽略 */ }
    }
    pipWindowRef.current = null;
    setPipContainer(null);
    setPoppedOut(false);
  };

  /**
   * 以 Document Picture-in-Picture 開「永遠置頂」的預覽視窗（Chromium 系）。
   * PiP 視窗是空白文件：複製主文件樣式與主題屬性後，用 React portal 把預覽渲染進去
   * （portal 直接吃 live state，內容即時同步，不需 BroadcastChannel）。
   */
  const openPipPopout = async (dpip: DocumentPictureInPictureLike) => {
    const pipWin = await dpip.requestWindow({ width: PIP_WIDTH, height: PIP_HEIGHT });
    if (unmountedRef.current) {
      // 等待期間彈窗已被關（元件卸載）→ 立刻關掉剛開出的視窗，不留孤兒、不碰 state。
      try { pipWin.close(); } catch { /* 視窗已關閉時忽略 */ }
      return;
    }
    const pipDoc = pipWin.document;
    pipDoc.title = "即時預覽（置頂） — ZonWiki";
    // 複製主文件樣式表（Tailwind／全站 CSS 變數），PiP 內外觀才與主視窗一致。
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const css = Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
        const style = pipDoc.createElement("style");
        style.textContent = css;
        pipDoc.head.appendChild(style);
      } catch {
        // 跨網域樣式表讀不到 cssRules → 改以 <link> 引用原網址。
        if (sheet.href) {
          const link = pipDoc.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          pipDoc.head.appendChild(link);
        }
      }
    }
    // 同步主題（全站 CSS 變數靠 <html data-theme> 解析；未設定時維持預設）。
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme) pipDoc.documentElement.setAttribute("data-theme", theme);
    pipDoc.body.style.margin = "0";
    pipDoc.body.style.background = "var(--bg-surface)";
    const container = pipDoc.createElement("div");
    pipDoc.body.appendChild(container);
    // 視窗被關（使用者關窗、或同分頁開了另一個 PiP 被自動擠掉）→ 恢復內嵌預覽。
    pipWin.addEventListener("pagehide", () => closePipPopout(false));
    pipWindowRef.current = pipWin;
    setPipContainer(container);
    setPoppedOut(true);
  };

  /**
   * PiP 預覽內右鍵某一行 → 編輯框捲到對應來源行（與 /notes/preview-popout 頁行為對等）。
   * 注意：PiP 內右鍵語意是「定位來源行」，與內嵌預覽的「雙右鍵切編輯」並存不衝突——
   * PiP 開啟時編輯器已強制顯示編輯區，沒有「切回編輯」的需求。
   */
  const onPipContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget && !PIP_BLOCK_TAGS.has(el.tagName)) {
      el = el.parentElement;
    }
    const text = (el?.textContent || "").trim().slice(0, 40);
    if (!text) return;
    e.preventDefault();
    scrollEditorToText(text);
  };

  /**
   * 「預覽」檢視的預覽窗格右鍵手勢（rightClickTogglesEdit 啟用時）：
   * 一律抑制瀏覽器右鍵選單；快速連點兩下（間隔 ≤ DOUBLE_RIGHT_CLICK_MS）切回編輯模式。
   * 只綁「預覽」檢視——並排（split）維持原生右鍵，行為單純可預期。
   */
  const onPreviewContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rightClickTogglesEdit || view !== "preview") return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastRightClickAtRef.current <= DOUBLE_RIGHT_CLICK_MS) {
      lastRightClickAtRef.current = 0;
      setView("edit");
      // 切回編輯後把焦點放進 textarea，接著就能直接打字（rAF 等 textarea 掛載完）。
      requestAnimationFrame(() => ref.current?.focus());
    } else {
      lastRightClickAtRef.current = now;
    }
  };

  /** 開啟「獨立預覽視窗」：優先 PiP 置頂（popoutAlwaysOnTop 且瀏覽器支援），否則走既有 window.open。 */
  const openPopout = () => {
    if (poppedOut) { (pipWindowRef.current ?? popupRef.current)?.focus(); return; }
    if (typeof window === "undefined") return;
    const dpip = popoutAlwaysOnTop
      ? (window as Window & { documentPictureInPicture?: DocumentPictureInPictureLike }).documentPictureInPicture
      : undefined;
    if (dpip) {
      // 防連點：requestWindow resolve 前按鈕仍可按，重複請求會開出多個 PiP 視窗。
      if (pipRequestInFlightRef.current) return;
      pipRequestInFlightRef.current = true;
      // PiP 開啟為非同步；失敗（權限、非使用者手勢…）就退回既有 window.open 流程。
      openPipPopout(dpip)
        .catch(() => { if (!unmountedRef.current) openLegacyPopout(); })
        .finally(() => { pipRequestInFlightRef.current = false; });
      return;
    }
    openLegacyPopout();
  };

  /** 既有的 window.open 獨立預覽視窗：以 BroadcastChannel 即時把編輯框最新 markdown 推給它渲染。 */
  const openLegacyPopout = () => {
    if (typeof BroadcastChannel === "undefined") return;
    const win = window.open(
      "/notes/preview-popout",
      "zonwiki-note-preview",
      "width=780,height=920,menubar=no,toolbar=no,location=no,status=no",
    );
    if (!win) {
      // 被瀏覽器彈窗攔截器擋下（常見於 PiP 失敗後的非同步 fallback——原始點擊手勢已被消耗）。
      // 不可仍 setPoppedOut(true)：那會變成「畫面說已彈出、實際沒有任何視窗」的假態。
      showToast("彈出預覽視窗被瀏覽器攔截，請允許本站的彈出式視窗後再試", { type: "error" });
      return;
    }
    const ch = new BroadcastChannel(PREVIEW_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; text?: string } | null;
      if (data?.type === "preview-ready") {
        // 預覽視窗載入完成 → 立刻補送目前內容（valueRef 持有最新值）。
        ch.postMessage({ type: "content", markdown: valueRef.current });
      } else if (data?.type === "preview-closing") {
        closePopout();
      } else if (data?.type === "reveal-source" && typeof data.text === "string") {
        // 彈出預覽右鍵某行 → 把該行捲到編輯框頂端。
        scrollEditorToText(data.text);
      }
    };
    channelRef.current = ch;
    popupRef.current = win;
    setPoppedOut(true);
  };

  // 彈出後：每次內容變動就把最新 markdown 推給獨立預覽視窗（即時渲染）。
  useEffect(() => {
    if (poppedOut) channelRef.current?.postMessage({ type: "content", markdown: value });
  }, [value, poppedOut]);

  // 彈出後：定時偵測獨立視窗是否已被使用者關閉（關了就恢復內嵌預覽）。
  useEffect(() => {
    if (!poppedOut) return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) closePopout();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [poppedOut]);

  // 卸載時關閉頻道與視窗（含 PiP 置頂視窗），避免殘留。
  // unmountedRef 在 setup 時重設為 false：StrictMode 開發模式會「模擬卸載再掛回」，
  // 只設不清會讓旗標永遠卡在 true、PiP 從此開不起來。
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      channelRef.current?.close();
      channelRef.current = null;
      try { popupRef.current?.close(); } catch { /* 跨視窗關閉可能受限，忽略 */ }
      try { pipWindowRef.current?.close(); } catch { /* 視窗已關閉時忽略 */ }
    };
  }, []);

  // PiP 開啟期間：主視窗切換主題（<html data-theme>）即時同步到 PiP 文件，
  // 避免 PiP 停留在建立當下的舊主題（對抗式復審 MEDIUM）。
  useEffect(() => {
    if (!pipContainer) return;
    const pipDoc = pipWindowRef.current?.document;
    if (!pipDoc || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute("data-theme");
      if (theme) pipDoc.documentElement.setAttribute("data-theme", theme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [pipContainer]);

  /** 還原 textarea 的選取狀態（在 onChange 觸發重繪後）。 */
  const restore = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = start;
      ta.selectionEnd = end;
    });
  };

  /** 以 before/after 包住選取（無選取時插入 placeholder 並選起來，方便直接覆寫）。
   *  註：所有工具列操作都在「display 文字」上運算（textarea 選取座標＝display 座標），
   *  再經 applyEdit 展開成完整文字對外——摺疊啟用時直接用 value 會座標錯位。 */
  const wrap = (before: string, after: string, placeholder: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = display.slice(s, e) || placeholder;
    applyEdit(display.slice(0, s) + before + sel + after + display.slice(e));
    restore(s + before.length, s + before.length + sel.length);
  };

  /** 在（選取範圍涵蓋的）每一行行首加上前綴（H1/清單/待辦/引用…）。 */
  const linePrefix = (prefix: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = display.lastIndexOf("\n", s - 1) + 1;
    const segment = display.slice(lineStart, e);
    const prefixed = segment
      .split("\n")
      .map((line) => {
        // 表格續行：前綴落在「內容起點」（↳ 之後）——插在 ↳ 前該行就不再是續行，
        // 標記會外漏進完整文字（對抗式復審 H-2）。
        const cont = foldRef.current.tableViewOn ? line.match(CONTINUATION_LINE_PATTERN) : null;
        return cont ? line.slice(0, cont[0].length) + prefix + line.slice(cont[0].length) : prefix + line;
      })
      .join("\n");
    applyEdit(display.slice(0, lineStart) + prefixed + display.slice(e));
    restore(lineStart, e + (prefixed.length - segment.length));
  };

  /** 建立程式碼區塊（把選取包進 ```，並確保前後換行）。 */
  const codeBlock = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = display.slice(s, e) || "程式碼";
    const before = display.slice(0, s);
    const after = display.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n");
    const nlAfter = after.length > 0 && !after.startsWith("\n");
    const fence = `${nlBefore ? "\n" : ""}\`\`\`\n${sel}\n\`\`\`${nlAfter ? "\n" : ""}`;
    applyEdit(before + fence + after);
    const start = s + (nlBefore ? 1 : 0) + 4; // 跳過（換行+）```\n
    restore(start, start + sel.length);
  };

  // 圖片插入：支援「貼上剪貼簿圖片」與「選檔上傳」。
  // 改走「上傳附件 API → 內文只放短網址」（取代舊的 base64 data URL 內嵌——
  // base64 會灌爆內文/搜尋索引/AI 重排 token，見 docs/DECISIONS.md 2026-07-08）。
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 進行中的上傳數：曝露給上層（保存鈕/AI 動作在上傳中必須 disable，
  // 否則會把佔位文字永久存進 DB）。用 ref 累計、每次變動即回呼。
  const uploadingCountRef = useRef(0);
  const bumpUploading = (delta: number) => {
    uploadingCountRef.current = Math.max(0, uploadingCountRef.current + delta);
    onUploadingChange?.(uploadingCountRef.current);
  };

  /**
   * 上傳圖片檔並插入 Markdown 短網址。
   * 流程：游標處先插入「純文字」佔位標記（非圖片語法，預覽自然顯示為文字；
   * 極端情況被存入也只是無害文字）→ 背景上傳 → 成功後在「最新內容」中把佔位換成
   * `![圖片](/api/attachments/{id})`；失敗則移除佔位並以 Toast 告知。
   */
  /**
   * 把佔位標記換成上傳結果（或移除）。佔位可能在 display、也可能已被摺進某個
   * hiddenText（使用者上傳期間摺疊了該區塊）——兩處都找；都沒有＝已被移除。
   * 一律以 split/join 代換（非 String.replace 樣板，$ 序列安全）。
   * @returns 是否有找到並替換。
   */
  const replaceUploadingMark = (uploadingMark: string, replacement: string): boolean => {
    const f = foldRef.current;
    if (f.display.includes(uploadingMark)) {
      applyEdit(f.display.split(uploadingMark).join(replacement));
      return true;
    }
    const recIdx = f.state.records.findIndex((r) => r.hiddenText.includes(uploadingMark));
    if (recIdx >= 0) {
      const rec = f.state.records[recIdx];
      const records = f.state.records.map((r, i) =>
        i === recIdx ? { ...r, hiddenText: rec.hiddenText.split(uploadingMark).join(replacement) } : r,
      );
      const nextState: FoldState = { records, graveyard: f.state.graveyard };
      const expanded = expandDisplay(f.display, nextState);
      const full = f.tableViewOn ? collapseTableRowBreaks(expanded) : expanded;
      setLastSyncedFull(full);
      setFold({ display: f.display, state: nextState, tableViewOn: f.tableViewOn });
      onChange(full);
      return true;
    }
    return false;
  };

  const insertImageFile = (file: File, pos: number) => {
    if (!file.type.startsWith("image/")) return;
    const token = Math.random().toString(36).slice(2, 8);
    const uploadingMark = `〔圖片上傳中 #${token}〕`;
    // pos 是 textarea（display）座標：在 display 上插佔位，applyEdit 展開後對外。
    const currentDisplay = foldRef.current.display;
    applyEdit(currentDisplay.slice(0, pos) + uploadingMark + currentDisplay.slice(pos));
    restore(pos + uploadingMark.length, pos + uploadingMark.length);

    bumpUploading(1);
    uploadAttachment(file)
      .then((uploaded) => {
        if (!replaceUploadingMark(uploadingMark, `![圖片](${uploaded.url})`)) {
          // 佔位標記已被使用者（或 AI 重排）移除 → 視同取消，不強行插入；
          // 已上傳的孤兒附件會由後端定期掃描回收。
          showToast("圖片已上傳，但插入點已被移除；需要時請重新貼上", { type: "info" });
        }
      })
      .catch((error: unknown) => {
        replaceUploadingMark(uploadingMark, "");
        const message = error instanceof Error ? error.message : "圖片上傳失敗";
        showToast(message, { type: "error" });
      })
      // 歸零延後一個 macrotask：保證上層收到「count=0」時，React 已把替換後的內容
      // 刷進 state（上層可安心以「歸零⇒內容為最終網址」做補存，如節點抽屜的 blur 存檔）。
      .finally(() => window.setTimeout(() => bumpUploading(-1), 0));
  };

  /** 貼上事件：剪貼簿含圖片時自動上傳成附件並插入短網址（貼上瞬間先顯示佔位文字）。 */
  const onPasteImage = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find((it) => it.type.startsWith("image/"));
    if (!imgItem) return; // 不是圖片就讓預設貼上（文字）正常進行
    const file = imgItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    const ta = ref.current;
    insertImageFile(file, ta ? ta.selectionStart : display.length);
  };

  /** 在游標處插入一段獨立區塊（前後自動補換行；如表格、分隔線）。 */
  const insertBlock = (block: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const before = display.slice(0, s);
    const after = display.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const nlAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const text = nlBefore + block + nlAfter;
    applyEdit(before + text + after);
    const pos = s + text.length;
    restore(pos, pos);
  };

  /** 把選取包成「保護區塊」`:::protect … :::`（AI 重排時會跳過）；沒選取則插入樣板。 */
  const wrapProtect = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = display.slice(s, e);
    if (!sel.trim()) { insertBlock(PROTECT_SNIPPET); return; }
    const before = display.slice(0, s);
    const after = display.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const nlAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const openTag = ":::protect\n";
    const block = `${nlBefore}${openTag}${sel}\n:::${nlAfter}`;
    applyEdit(before + block + after);
    const start = s + nlBefore.length + openTag.length;
    restore(start, start + sel.length);
  };

  /** 縮排單位（兩個空白，符合 Markdown 巢狀清單慣例）。 */
  const INDENT_UNIT = "  ";

  /**
   * 在選取範圍插入文字，優先走 document.execCommand('insertText') 以保留瀏覽器原生
   * undo 堆疊（Ctrl+Z 可復原；對抗式復審 H-3）——execCommand 會改 DOM 值並發 input 事件，
   * React onChange → applyEdit 照常收斂。不支援（jsdom／舊瀏覽器）時退回 applyEdit 手動路徑。
   * @param ta 目標 textarea。
   * @param text 要插入的文字。
   * @param start 取代範圍起點（display 座標）。
   * @param end 取代範圍終點（display 座標）。
   */
  const insertTextPreservingUndo = (
    ta: HTMLTextAreaElement,
    text: string,
    start: number,
    end: number,
  ) => {
    ta.focus();
    ta.setSelectionRange(start, end);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      const d = foldRef.current.display;
      applyEdit(d.slice(0, start) + text + d.slice(end));
      restore(start + text.length, start + text.length);
    }
  };

  /**
   * 刪除指定範圍，優先走 execCommand('delete') 保留原生 undo；退路同上。
   * @param ta 目標 textarea。
   * @param start 刪除起點（display 座標）。
   * @param end 刪除終點（display 座標）。
   */
  const deleteRangePreservingUndo = (ta: HTMLTextAreaElement, start: number, end: number) => {
    ta.focus();
    ta.setSelectionRange(start, end);
    let deleted = false;
    try {
      deleted = document.execCommand("delete");
    } catch {
      deleted = false;
    }
    if (!deleted) {
      const d = foldRef.current.display;
      applyEdit(d.slice(0, start) + d.slice(end));
      restore(start, start);
    }
  };

  /**
   * 表格續行 join 原子區手勢（keydown 層；對抗式復審 H-2）：
   * ① 選取編輯鍵＋範圍與 join 區部分相交 → 選取擴張成完整覆蓋（不留半殘標記）；
   * ② 游標嚴格在 join 區內（墊片/標記）打字 → 先貼齊內容起點再讓字落下；
   * ③ Backspace 於區內或內容起點／Delete 於區內或區起點 → 整個 join 一次刪（＝移除該 <br>）。
   * @returns 是否已處理（true＝吃掉本次按鍵）。
   */
  const handleJoinGestureKeys = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    ta: HTMLTextAreaElement,
  ): boolean => {
    const f = foldRef.current;
    if (!f.tableViewOn) return false;
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isEditKey = isPrintable || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete";
    if (!isEditKey) return false;
    const regions = listJoinRegions(f.display);
    if (regions.length === 0) return false;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;

    if (s !== en) {
      // 選取式編輯：擴張選取覆蓋整個 join 區，預設行為（刪除/取代）作用於擴張後範圍。
      const ext = extendRangeOverJoins(regions, s, en);
      if (ext.start !== s || ext.end !== en) ta.setSelectionRange(ext.start, ext.end);
      return false;
    }

    const inside = regions.find((r) => s > r.start && s < r.contentStart);
    if (e.key === "Backspace") {
      const target = inside ?? regions.find((r) => s === r.contentStart);
      if (!target) return false;
      e.preventDefault();
      deleteRangePreservingUndo(ta, target.start, target.contentStart);
      return true;
    }
    if (e.key === "Delete") {
      const target = inside ?? regions.find((r) => s === r.start);
      if (!target) return false;
      e.preventDefault();
      deleteRangePreservingUndo(ta, target.start, target.contentStart);
      return true;
    }
    // 可列印鍵／Enter 落在區內：貼齊內容起點（字不會插進墊片/標記），按鍵照常落下。
    if (inside) ta.setSelectionRange(inside.contentStart, inside.contentStart);
    return false;
  };

  /**
   * Shift+Enter（keydown 層）：游標在真表格的儲存格內 → 插入「\n＋墊片＋↳ 」
   * （對外收斂成該格的 <br>）；其餘情境放行預設換行（全域 Enter=硬換行已覆蓋）。
   * IME 組字中不攔（isComposing）；視圖層停用時不攔。
   * @returns 是否已處理。
   */
  const handleShiftEnterKey = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    ta: HTMLTextAreaElement,
  ): boolean => {
    if (e.key !== "Enter" || !e.shiftKey) return false;
    if (e.nativeEvent.isComposing) return false;
    const f = foldRef.current;
    if (!f.tableViewOn) return false;
    const s = ta.selectionStart;
    const insert = continuationInsertFor(f.display, s);
    if (!insert) return false;
    e.preventDefault();
    // 有選取＝取代：範圍先擴張覆蓋相交的 join 區，避免半殘標記。
    const ext = extendRangeOverJoins(listJoinRegions(f.display), s, ta.selectionEnd);
    insertTextPreservingUndo(ta, insert, Math.min(s, ext.start), ext.end);
    return true;
  };

  /**
   * 摺疊手勢（keydown 層）：在「會改動徽章」的輸入落地前先自動展開，
   * 讓使用者永遠不會被驗證拒絕纏住——
   * ① 選取範圍嚴格跨到徽章＋任何編輯鍵 → 展開所有相交的摺疊（本次輸入不執行）；
   * ② 游標嚴格在徽章內打字/Enter/Backspace/Delete → 展開該塊；
   * ③ 游標貼齊徽章後緣按 Backspace／前緣按 Delete → 展開該塊（不逐字啃徽章）。
   * @returns 是否已處理（true＝吃掉本次按鍵）。
   */
  const handleFoldGestureKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>, ta: HTMLTextAreaElement): boolean => {
    const f = foldRef.current;
    if (f.state.records.length === 0) return false;
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isEditKey = isPrintable || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete";
    if (!isEditKey) return false;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;

    if (s !== en) {
      // 選取嚴格跨入任一徽章 → 展開相交的摺疊
      const overlapping = f.state.records.filter((r) => {
        const idx = f.display.indexOf(r.badge);
        return idx !== -1 && s < idx + r.badge.length && en > idx;
      });
      if (overlapping.length > 0) {
        e.preventDefault();
        let cur: { display: string; state: FoldState } = { display: f.display, state: f.state };
        for (const r of overlapping) cur = unfoldBlock(cur.display, cur.state, r.id);
        applyFoldView(cur);
        return true;
      }
      return false;
    }

    const hit = findBadgeAt(f.display, f.state, s);
    if (!hit) return false;
    const shouldUnfold =
      hit.touching === "inside" ||
      (hit.touching === "atEnd" && e.key === "Backspace") ||
      (hit.touching === "atStart" && e.key === "Delete");
    if (!shouldUnfold) return false;
    e.preventDefault();
    applyFoldView(unfoldBlock(f.display, f.state, hit.foldId));
    restore(hit.badgeStart, hit.badgeStart);
    return true;
  };

  /** Tab 縮排 / Shift+Tab 退縮排（取代預設「跳離輸入框」）。單行則於游標處插入/移除；多行則整段行首增減。 */
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = ref.current;
    if (!ta) return;
    // 記住編輯前的選取（驗證拒絕還原時把游標放回原位）。
    lastGoodSelRef.current = [ta.selectionStart, ta.selectionEnd];
    if (handleFoldGestureKeys(e, ta)) return;
    if (handleJoinGestureKeys(e, ta)) return;
    if (handleShiftEnterKey(e, ta)) return;
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s = ta.selectionStart;
    const en = ta.selectionEnd;

    // 無選取 + Tab：直接在游標處插入縮排。
    if (s === en && !e.shiftKey) {
      applyEdit(display.slice(0, s) + INDENT_UNIT + display.slice(en));
      restore(s + INDENT_UNIT.length, s + INDENT_UNIT.length);
      return;
    }

    // 有選取 或 Shift+Tab：對「選取涵蓋的每一行」行首增減縮排。
    const lineStart = display.lastIndexOf("\n", s - 1) + 1;
    let lineEnd = display.indexOf("\n", en > s ? en - 1 : en);
    if (lineEnd === -1) lineEnd = display.length;
    const lines = display.slice(lineStart, lineEnd).split("\n");

    if (e.shiftKey) {
      // 退縮排：每行移除開頭最多 2 個空白（或 1 個 tab）。
      let removedFirst = 0;
      let removedTotal = 0;
      const out = lines.map((line, i) => {
        const m = line.match(/^( {1,2}|\t)/);
        const rm = m ? m[0].length : 0;
        if (i === 0) removedFirst = rm;
        removedTotal += rm;
        return line.slice(rm);
      });
      applyEdit(display.slice(0, lineStart) + out.join("\n") + display.slice(lineEnd));
      restore(Math.max(lineStart, s - removedFirst), Math.max(lineStart, en - removedTotal));
    } else {
      // 縮排：每行行首加縮排。
      const out = lines.map((line) => INDENT_UNIT + line);
      applyEdit(display.slice(0, lineStart) + out.join("\n") + display.slice(lineEnd));
      restore(s + INDENT_UNIT.length, en + INDENT_UNIT.length * lines.length);
    }
  };

  /** 點擊落在徽章內＝展開該摺疊區塊（點一下徽章即展開）。 */
  const onEditorClick = () => {
    const ta = ref.current;
    if (!ta) return;
    lastGoodSelRef.current = [ta.selectionStart, ta.selectionEnd];
    if (ta.selectionStart !== ta.selectionEnd) return;
    const f = foldRef.current;
    const hit = findBadgeAt(f.display, f.state, ta.selectionStart);
    if (hit && hit.touching === "inside") {
      applyFoldView(unfoldBlock(f.display, f.state, hit.foldId));
      restore(hit.badgeStart, hit.badgeStart);
    }
  };

  /** 追蹤最近一次已知良好的選取範圍（供驗證拒絕時還原游標）。 */
  const onEditorSelect = () => {
    const ta = ref.current;
    if (!ta) return;
    lastGoodSelRef.current = [ta.selectionStart, ta.selectionEnd];
  };

  /**
   * IME 組字開始：游標／選取落在徽章上時先自動展開（與 keydown 手勢同款防護）。
   * CJK 組字期間 keydown.key 是 "Process"（接不到可列印字元判斷），若放行到 onChange
   * 會走進驗證拒絕→受控 textarea 被程式化改值→打斷組字（對抗式復審 MEDIUM）；從源頭避免。
   */
  const onEditorCompositionStart = () => {
    const ta = ref.current;
    if (!ta) return;
    const f = foldRef.current;
    if (f.state.records.length === 0) return;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;
    if (s !== en) {
      const overlapping = f.state.records.filter((r) => {
        const idx = f.display.indexOf(r.badge);
        return idx !== -1 && s < idx + r.badge.length && en > idx;
      });
      if (overlapping.length > 0) {
        let cur: { display: string; state: FoldState } = { display: f.display, state: f.state };
        for (const r of overlapping) cur = unfoldBlock(cur.display, cur.state, r.id);
        applyFoldView(cur);
      }
      return;
    }
    const hit = findBadgeAt(f.display, f.state, s);
    if (hit && hit.touching === "inside") {
      applyFoldView(unfoldBlock(f.display, f.state, hit.foldId));
      restore(hit.badgeStart, hit.badgeStart);
    }
  };

  /**
   * 複製/剪下：選取跨到表格續行 join 區時，剪貼簿改放「收斂後完整文字」的切片
   * （單行 <br> 形＝合法 GFM，貼到外部平台表格不會壞）。座標映射走正確順序
   * （先徽章、再 join；對抗式復審 C-1/H-1——不用正則猜，跨徽章選取則放行原生複製）。
   */
  const transformClipboardForJoins = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const f = foldRef.current;
    if (!f.tableViewOn) return;
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;
    if (s === en) return;
    const regions = listJoinRegions(f.display);
    if (!regions.some((r) => s < r.contentStart && en > r.start)) return; // 未跨 join → 原生複製
    // 端點「各自」過徽章映射（(p,p) 空範圍只在 p 嚴格位於徽章內時回 null）——
    // 選取「完整包住」徽章不再整段放棄（對抗式復審 HIGH-1：Ctrl+A 全選複製的
    // 剪貼簿會外流 ↳ 字面與徽章原文）；被包住的徽章由 expandDisplay 正確展開成隱藏內文。
    const startMapped = mapDisplayRangeToFull(f.display, f.state, s, s);
    const endMapped = mapDisplayRangeToFull(f.display, f.state, en, en);
    if (!startMapped || !endMapped) return; // 端點嚴格在徽章內 → 放行原生（後續編輯由徽章驗證守門）
    const expanded = expandDisplay(f.display, f.state);
    const range = mapExpandedRangeToCollapsed(expanded, startMapped.start, endMapped.end);
    const full = collapseTableRowBreaks(expanded);
    e.preventDefault();
    e.clipboardData.setData("text/plain", full.slice(range.start, range.end));
  };

  /** 剪下＝複製轉換＋刪除選取（範圍擴張覆蓋 join 區，不留半殘標記）。 */
  const onEditorCut = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    transformClipboardForJoins(e);
    if (!e.defaultPrevented) return; // 未轉換 → 原生剪下
    const ta = ref.current;
    if (!ta) return;
    const ext = extendRangeOverJoins(
      listJoinRegions(foldRef.current.display),
      ta.selectionStart,
      ta.selectionEnd,
    );
    deleteRangePreservingUndo(ta, ext.start, ext.end);
  };

  /**
   * 拖放守門：拖進來的文字帶「續行標記」樣式（多半是從本編輯器拖移含 join 的選取）
   * 落點若不在表格脈絡會讓 ↳ 字面外漏入庫（對抗式復審 H-2 反例 2）→ 一律擋下並提示。
   */
  const onEditorDrop = (e: React.DragEvent<HTMLTextAreaElement>): void => {
    if (!foldRef.current.tableViewOn) return;
    let text = "";
    try {
      text = e.dataTransfer?.getData("text/plain") ?? "";
    } catch {
      text = "";
    }
    if (/(^|\n) *↳ ?/.test(text)) {
      e.preventDefault();
      showToast("拖放內容含表格續行標記，請改用複製貼上（複製會自動轉成 <br> 單行格式）", { type: "info" });
    }
  };

  /** textarea 捲動時同步 gutter 與管線標示背景層（直接動 DOM，不經 state，避免捲動掉幀）。 */
  const onEditorScroll = () => {
    const ta = ref.current;
    if (!ta) return;
    if (gutterInnerRef.current) {
      gutterInnerRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
    if (pipeInnerRef.current) {
      pipeInnerRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
  };

  // ─── 表格管線標示背景層（| 上色；使用者 2026-08-13 追加）──────────────
  // textarea 無法對單一字元上色 → 疊一層同字體/同排版的背景層（文字透明），
  // 只在「真表格行」的未跳脫 | 位置畫色塊；textarea 文字在其上，IME/選取不受影響
  //（同 StickyBody「重點底圖」先例）。
  const pipeBackdrop = useMemo(() => {
    if (!display.includes("|")) return null;
    const flags = listTableLineFlags(display);
    if (!flags.some(Boolean)) return null;
    const nodes: React.ReactNode[] = [];
    display.split("\n").forEach((line, lineIndex) => {
      if (lineIndex > 0) nodes.push("\n");
      if (!flags[lineIndex]) {
        nodes.push(line);
        return;
      }
      const noCr = line.endsWith("\r") ? line.slice(0, -1) : line;
      let cursor = 0;
      for (const pipePos of unescapedPipePositions(noCr)) {
        if (pipePos > cursor) nodes.push(line.slice(cursor, pipePos));
        nodes.push(
          <span key={`${lineIndex}-${pipePos}`} className="mde-pipe-mark">
            |
          </span>,
        );
        cursor = pipePos + 1;
      }
      nodes.push(line.slice(cursor));
    });
    return nodes;
  }, [display]);

  // 背景層排版寬度＝textarea 內容寬（clientWidth 已扣捲軸）——出現垂直捲軸時
  // 兩層的自動換行才會斷在同一處；捲動位置一併對齊。
  useEffect(() => {
    const ta = ref.current;
    const inner = pipeInnerRef.current;
    if (!ta || !inner) return;
    const cs = window.getComputedStyle(ta);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const width = Math.max(0, ta.clientWidth - padL - padR);
    inner.style.width = width > 0 ? `${width}px` : "";
    inner.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, [pipeBackdrop, measureTick, view, poppedOut, minHeight]);

  // 摺疊 gutter 量測：以鏡像 div（同字體/寬度/換行）搭配 Range 量各 toggle 標頭行的 Y。
  // jsdom 沒有真排版（回 0）也不會壞——按鈕仍渲染，只是疊在一起，不影響邏輯測試。
  // 節流：fold 每個按鍵都變動，鏡像量測（整篇 textContent＋每區塊一次 layout）不可
  // 每鍵同步重跑（大筆記會拖慢輸入，對抗式復審 MEDIUM）——debounce 至停止輸入後才量。
  useEffect(() => {
    const ta = ref.current;
    if (!ta || !hasToggleBlocks) {
      setGutterMarks((m) => (m.length ? [] : m));
      return;
    }
    const timer = window.setTimeout(() => measureGutter(ta), GUTTER_MEASURE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // 依賴 view/poppedOut（而非其後才宣告的 showEditor）：檢視切換會改變編輯區的顯示與寬度。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measureGutter 每次 render 重建，列入依賴會使 debounce 失效
  }, [fold, toggleBlocks, hasToggleBlocks, measureTick, view, poppedOut]);

  /** 實際執行 gutter 量測（由上方 debounce effect 呼叫）。 */
  const measureGutter = (ta: HTMLTextAreaElement) => {
    const cs = window.getComputedStyle(ta);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = "break-word";
    mirror.style.boxSizing = "content-box";
    mirror.style.width = `${Math.max(0, ta.clientWidth - padL - padR)}px`;
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.fontWeight = cs.fontWeight;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.textContent = fold.display.length > 0 ? fold.display : " ";
    document.body.appendChild(mirror);
    const marks: GutterMark[] = [];
    const textNode = mirror.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const mirrorTop = mirror.getBoundingClientRect().top;
      const range = document.createRange();
      const maxOffset = (textNode as Text).length;
      for (const b of toggleBlocks) {
        // 量測失敗（jsdom 未實作 Range.getBoundingClientRect 等）→ 退回 y=0：
        // 按鈕仍渲染、功能不缺，只是位置不準（真瀏覽器不會走到 fallback）。
        let y = padT;
        try {
          range.setStart(textNode, Math.min(b.headerStart, maxOffset));
          range.setEnd(textNode, Math.min(b.headerStart + 1, maxOffset));
          const rect = range.getBoundingClientRect();
          y = rect.top - mirrorTop + padT;
        } catch {
          // 保留 fallback y
        }
        marks.push({
          headerStart: b.headerStart,
          y,
          folded: b.folded,
          foldId: b.foldId,
        });
      }
    }
    document.body.removeChild(mirror);
    setGutterMarks(marks);
    // 捲動位置同步（初次量測與內容變動後）。
    if (gutterInnerRef.current) {
      gutterInnerRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
  };

  // 編輯區尺寸變化（拉高、視窗縮放改變換行）→ 重量測 gutter 位置。
  useEffect(() => {
    const ta = ref.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    observer.observe(ta);
    return () => observer.disconnect();
  }, [view, poppedOut]);

  // 工具列：常用的 Markdown 格式都備齊（標題 1~3、粗/斜/刪除線、清單/編號/待辦、引用、
  // 行內/區塊程式碼、表格、摺疊、保護、圖片、分隔線、連結）。
  const tools: { label: React.ReactNode; title: string; run: () => void }[] = [
    { label: "H1", title: "標題 1（行首 # ）", run: () => linePrefix("# ") },
    { label: "H2", title: "標題 2（行首 ## ）", run: () => linePrefix("## ") },
    { label: "H3", title: "標題 3（行首 ### ）", run: () => linePrefix("### ") },
    { label: <b>B</b>, title: "粗體", run: () => wrap("**", "**", "粗體") },
    { label: <i>I</i>, title: "斜體", run: () => wrap("*", "*", "斜體") },
    { label: <s>S</s>, title: "刪除線", run: () => wrap("~~", "~~", "刪除線") },
    { label: "•", title: "項目清單", run: () => linePrefix("- ") },
    { label: "1.", title: "編號清單", run: () => linePrefix("1. ") },
    { label: "☑", title: "待辦清單", run: () => linePrefix("- [ ] ") },
    { label: "❝", title: "引用", run: () => linePrefix("> ") },
    { label: "`", title: "行內程式碼", run: () => wrap("`", "`", "code") },
    { label: "</>", title: "程式碼區塊", run: codeBlock },
    { label: "⊞", title: "表格（含互動控件範例：radio 單選可帶色／checkbox 勾選）", run: () => insertBlock(INTERACTIVE_TABLE_SNIPPET) },
    { label: "▸", title: "摺疊區塊（Notion 式 toggle：點標題可摺疊／展開）", run: () => insertBlock(TOGGLE_SNIPPET) },
    { label: "🔒", title: "保護區塊（框住不想被 AI 重排的內容；重排時會原樣保留）", run: wrapProtect },
    { label: "🖼", title: "插入圖片（選檔上傳；也可直接貼上剪貼簿圖片）", run: () => fileInputRef.current?.click() },
    { label: "―", title: "分隔線", run: () => insertBlock("---") },
    { label: "🔗", title: "連結", run: () => wrap("[", "](url)", "文字") },
  ];

  // 彈出後：編輯區佔滿全寬、不顯示內嵌預覽（預覽在獨立視窗）。
  const showEditor = poppedOut || !withPreview || view !== "preview";
  const showPreview = !poppedOut && withPreview && view !== "edit";

  // 本瀏覽器是否支援 Document PiP（置頂視窗）：按鈕文案據此決定——
  // 不支援（Firefox/Safari）時不可承諾「置頂」（那會是假承諾，對抗式復審 HIGH）。
  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  return (
    <div className={`mde ${className || ""}`}>
      <div className="mde-toolbar">
        {tools.map((t, i) => (
          <button
            key={i}
            type="button"
            className="mde-btn"
            title={t.title}
            // 防止按鈕奪走焦點：保留 textarea 的選取範圍，也避免誤觸 onBlur 存檔。
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.run}
            tabIndex={-1}
          >
            {t.label}
          </button>
        ))}
        {hasToggleBlocks && (
          <>
            <button
              type="button"
              className="mde-btn"
              title="全部摺疊（把編輯區所有 toggle 區塊收起，僅影響編輯畫面、不改內容）"
              aria-label="全部摺疊"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFoldView(foldAll(fold.display, fold.state))}
              tabIndex={-1}
            >
              ▸▸
            </button>
            <button
              type="button"
              className="mde-btn"
              title="全部展開（還原編輯區所有已摺疊的 toggle 區塊）"
              aria-label="全部展開"
              onMouseDown={(e) => e.preventDefault()}
              onClick={unfoldAllView}
              tabIndex={-1}
            >
              ▾▾
            </button>
          </>
        )}
        {withPreview && (
          <div className="mde-views">
            {(["edit", "split", "preview"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`mde-view-btn ${view === m ? "mde-view-btn--on" : ""}`}
                onClick={() => {
                  // 手動切檢視時歸零右鍵計時：避免「右鍵一下→手動切走再切回→再右鍵一下」
                  // 被誤判成連續雙擊（對抗式復審 LOW）。
                  lastRightClickAtRef.current = 0;
                  setView(m);
                }}
                disabled={poppedOut && m !== "edit"}
                title={poppedOut ? "預覽已彈出成獨立視窗" : undefined}
                tabIndex={-1}
              >
                {m === "edit" ? "編輯" : m === "split" ? "並排" : "預覽"}
              </button>
            ))}
            <button
              type="button"
              className={`mde-view-btn ${poppedOut ? "mde-view-btn--on" : ""}`}
              onClick={poppedOut ? (pipContainer ? () => closePipPopout(true) : closePopout) : openPopout}
              title={
                poppedOut
                  ? "關閉獨立預覽視窗、恢復內嵌預覽"
                  : popoutAlwaysOnTop && pipSupported
                    ? "把預覽彈出成「永遠置頂」的獨立視窗（不會被其他視窗蓋掉，即時同步；同時僅能置頂一個）"
                    : popoutAlwaysOnTop
                      ? "把預覽彈出成獨立視窗（此瀏覽器不支援置頂，即時同步）"
                      : "把預覽彈出成獨立視窗（可拖到另一個螢幕，即時同步）"
              }
              tabIndex={-1}
            >
              {poppedOut ? "⇲ 收回預覽" : "⬈ 彈出預覽"}
            </button>
          </div>
        )}
      </div>

      {/* 隱藏的選檔輸入：🖼 鈕觸發，選圖後以 data URL 內嵌（不需網址）。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const ta = ref.current;
          if (file) insertImageFile(file, ta ? ta.selectionStart : value.length);
          e.target.value = ""; // 允許再次選同一檔
        }}
      />

      <div className={`mde-body ${showEditor && showPreview ? "mde-body--split" : ""}`}>
        {showEditor && (
          <div className="mde-editor-wrap">
            {hasToggleBlocks && (
              <div className="mde-fold-gutter">
                <div className="mde-fold-gutter-inner" ref={gutterInnerRef}>
                  {gutterMarks.map((m) => (
                    <button
                      // 已摺疊者用穩定的 foldId 當 key（headerStart 會隨前方編輯位移，避免整批 remount）
                      key={m.foldId ?? `h${m.headerStart}`}
                      type="button"
                      // 兩態不同配色（使用者裁示 2026-08-11：灰階小鈕看不清楚）：
                      // --open＝主色綠（點了摺疊）、--folded＝琥珀警示（提示這裡藏著內容，點了展開）
                      className={`mde-fold-btn ${m.folded ? "mde-fold-btn--folded" : "mde-fold-btn--open"}`}
                      style={{ top: m.y }}
                      title={m.folded ? "展開此摺疊區塊" : "摺疊此 toggle 區塊（僅編輯畫面，不改內容）"}
                      aria-label={m.folded ? "展開摺疊區塊" : "摺疊區塊"}
                      // 防止奪走焦點（同工具列按鈕）。
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (m.folded && m.foldId) {
                          applyFoldView(unfoldBlock(fold.display, fold.state, m.foldId));
                        } else {
                          const next = foldBlockAt(fold.display, fold.state, m.headerStart);
                          if (next) applyFoldView(next);
                        }
                      }}
                      tabIndex={-1}
                    >
                      {m.folded ? "▸" : "▾"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pipeBackdrop && (
              <div
                className={`mde-pipe-backdrop ${hasToggleBlocks ? "mde-pipe-backdrop--fold-gutter" : ""}`}
                aria-hidden="true"
              >
                <div className="mde-pipe-backdrop-inner" ref={pipeInnerRef}>
                  {pipeBackdrop}
                </div>
              </div>
            )}
            <textarea
              ref={ref}
              className={`mde-textarea ${hasToggleBlocks ? "mde-textarea--fold-gutter" : ""} ${textareaClassName || ""}`}
              style={{ minHeight }}
              value={display}
              onChange={(e) => applyEdit(e.target.value)}
              onBlur={onBlur}
              onPaste={onPasteImage}
              onCopy={transformClipboardForJoins}
              onCut={onEditorCut}
              onDrop={onEditorDrop}
              onKeyDown={onEditorKeyDown}
              onClick={onEditorClick}
              onSelect={onEditorSelect}
              onScroll={onEditorScroll}
              onCompositionStart={onEditorCompositionStart}
              placeholder={placeholder}
              aria-label={ariaLabel}
            />
          </div>
        )}
        {showPreview && (
          <div
            className="mde-preview md-preview"
            style={{ minHeight }}
            onContextMenu={onPreviewContextMenu}
            title={rightClickTogglesEdit && view === "preview" ? "快速連點兩下右鍵：切換為編輯模式" : undefined}
          >
            {value.trim() ? (
              // 傳入 onChange → 預覽/並排中的待辦核取方塊可直接點擊勾選，切換後即時寫回內容。
              <ToggleAwareMarkdown value={value} onChange={onChange} />
            ) : (
              <span className="mde-muted">
                {rightClickTogglesEdit && view === "preview"
                  ? "預覽會顯示在這裡…（快速連點兩下右鍵可切換為編輯）"
                  : "預覽會顯示在這裡…"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Document PiP 置頂預覽：portal 直接吃 live value，內容即時同步（不經 BroadcastChannel）。 */}
      {pipContainer &&
        createPortal(
          <div
            className="markdown-prose md-preview"
            style={{ padding: "20px 24px", maxWidth: 900, margin: "0 auto", boxSizing: "border-box" }}
            onContextMenu={onPipContextMenu}
            title="右鍵點某一行 → 編輯視窗會捲到該行"
          >
            {value.trim() ? (
              <ToggleAwareMarkdown value={value} />
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>（尚無內容；請在編輯器輸入 Markdown）</span>
            )}
          </div>,
          pipContainer
        )}

      {poppedOut && (
        <div className="mde-popout-hint">
          預覽已彈出成獨立視窗（即時同步中）。編輯區已切換全寬；關閉該視窗或按「⇲ 收回預覽」即可恢復內嵌預覽。
        </div>
      )}
    </div>
  );
}
