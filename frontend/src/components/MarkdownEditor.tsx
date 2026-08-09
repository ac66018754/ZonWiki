"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ToggleAwareMarkdown } from "@/components/MarkdownPreview";
import { TOGGLE_SNIPPET, PROTECT_SNIPPET } from "@/lib/toggleBlocks";
import { uploadAttachment } from "@/lib/api";
import { showToast } from "@/lib/toast";

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
    if (idx < 0) return;
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

  /** 以 before/after 包住選取（無選取時插入 placeholder 並選起來，方便直接覆寫）。 */
  const wrap = (before: string, after: string, placeholder: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.slice(s, e) || placeholder;
    onChange(value.slice(0, s) + before + sel + after + value.slice(e));
    restore(s + before.length, s + before.length + sel.length);
  };

  /** 在（選取範圍涵蓋的）每一行行首加上前綴（H1/清單/待辦/引用…）。 */
  const linePrefix = (prefix: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const segment = value.slice(lineStart, e);
    const prefixed = segment
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    onChange(value.slice(0, lineStart) + prefixed + value.slice(e));
    restore(lineStart, e + (prefixed.length - segment.length));
  };

  /** 建立程式碼區塊（把選取包進 ```，並確保前後換行）。 */
  const codeBlock = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.slice(s, e) || "程式碼";
    const before = value.slice(0, s);
    const after = value.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n");
    const nlAfter = after.length > 0 && !after.startsWith("\n");
    const fence = `${nlBefore ? "\n" : ""}\`\`\`\n${sel}\n\`\`\`${nlAfter ? "\n" : ""}`;
    onChange(before + fence + after);
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
  const insertImageFile = (file: File, pos: number) => {
    if (!file.type.startsWith("image/")) return;
    const token = Math.random().toString(36).slice(2, 8);
    const uploadingMark = `〔圖片上傳中 #${token}〕`;
    const current = valueRef.current;
    onChange(current.slice(0, pos) + uploadingMark + current.slice(pos));
    restore(pos + uploadingMark.length, pos + uploadingMark.length);

    bumpUploading(1);
    uploadAttachment(file)
      .then((uploaded) => {
        const md = `![圖片](${uploaded.url})`;
        const latest = valueRef.current;
        if (latest.includes(uploadingMark)) {
          onChange(latest.replace(uploadingMark, md));
        } else {
          // 佔位標記已被使用者（或 AI 重排）移除 → 視同取消，不強行插入；
          // 已上傳的孤兒附件會由後端定期掃描回收。
          showToast("圖片已上傳，但插入點已被移除；需要時請重新貼上", { type: "info" });
        }
      })
      .catch((error: unknown) => {
        const latest = valueRef.current;
        if (latest.includes(uploadingMark)) {
          onChange(latest.replace(uploadingMark, ""));
        }
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
    insertImageFile(file, ta ? ta.selectionStart : value.length);
  };

  /** 在游標處插入一段獨立區塊（前後自動補換行；如表格、分隔線）。 */
  const insertBlock = (block: string) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const nlAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const text = nlBefore + block + nlAfter;
    onChange(before + text + after);
    const pos = s + text.length;
    restore(pos, pos);
  };

  /** 把選取包成「保護區塊」`:::protect … :::`（AI 重排時會跳過）；沒選取則插入樣板。 */
  const wrapProtect = () => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.slice(s, e);
    if (!sel.trim()) { insertBlock(PROTECT_SNIPPET); return; }
    const before = value.slice(0, s);
    const after = value.slice(e);
    const nlBefore = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const nlAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const openTag = ":::protect\n";
    const block = `${nlBefore}${openTag}${sel}\n:::${nlAfter}`;
    onChange(before + block + after);
    const start = s + nlBefore.length + openTag.length;
    restore(start, start + sel.length);
  };

  /** 縮排單位（兩個空白，符合 Markdown 巢狀清單慣例）。 */
  const INDENT_UNIT = "  ";

  /** Tab 縮排 / Shift+Tab 退縮排（取代預設「跳離輸入框」）。單行則於游標處插入/移除；多行則整段行首增減。 */
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    const ta = ref.current;
    if (!ta) return;
    e.preventDefault();
    const s = ta.selectionStart;
    const en = ta.selectionEnd;

    // 無選取 + Tab：直接在游標處插入縮排。
    if (s === en && !e.shiftKey) {
      onChange(value.slice(0, s) + INDENT_UNIT + value.slice(en));
      restore(s + INDENT_UNIT.length, s + INDENT_UNIT.length);
      return;
    }

    // 有選取 或 Shift+Tab：對「選取涵蓋的每一行」行首增減縮排。
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    let lineEnd = value.indexOf("\n", en > s ? en - 1 : en);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split("\n");

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
      onChange(value.slice(0, lineStart) + out.join("\n") + value.slice(lineEnd));
      restore(Math.max(lineStart, s - removedFirst), Math.max(lineStart, en - removedTotal));
    } else {
      // 縮排：每行行首加縮排。
      const out = lines.map((line) => INDENT_UNIT + line);
      onChange(value.slice(0, lineStart) + out.join("\n") + value.slice(lineEnd));
      restore(s + INDENT_UNIT.length, en + INDENT_UNIT.length * lines.length);
    }
  };

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
          <textarea
            ref={ref}
            className={`mde-textarea ${textareaClassName || ""}`}
            style={{ minHeight }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onPaste={onPasteImage}
            onKeyDown={onEditorKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel}
          />
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
