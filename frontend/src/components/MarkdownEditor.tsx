"use client";

import { useEffect, useRef, useState } from "react";
import { ToggleAwareMarkdown } from "@/components/MarkdownPreview";
import { TOGGLE_SNIPPET, PROTECT_SNIPPET } from "@/lib/toggleBlocks";

/** 彈出預覽視窗與編輯器之間的即時同步頻道名稱（同源 BroadcastChannel）。 */
export const PREVIEW_CHANNEL = "zonwiki:note-preview";

/**
 * 共用 Markdown 編輯器：文字輸入框 + 格式工具列。
 *
 * 工具列同時支援兩種用法：
 * - 先框選文字，再按格式鍵 → 套用到選取範圍（粗體、H1、程式碼區塊…）。
 * - 不選文字直接按格式鍵 → 插入標記並把游標放到正確位置，接著打字即可。
 *
 * 不熟 Markdown 的人也能用按鈕快速產生格式；熟的人仍可直接打字。
 * 可選 withPreview：提供 編輯／並排／預覽 三種檢視，並可把預覽「彈出成獨立視窗」即時同步。
 */
type ViewMode = "edit" | "split" | "preview";

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  minHeight = 200,
  withPreview = false,
  className,
  textareaClassName,
  ariaLabel = "Markdown 編輯器",
  taRef,
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
  /** 外層額外 class（例如畫布需要 nodrag）。 */
  className?: string;
  /** textarea 額外 class（沿用既有樣式時）。 */
  textareaClassName?: string;
  ariaLabel?: string;
  /** 上層若需讀取目前選取範圍（如「局部排版」），可傳入 ref 取得 textarea 元素。 */
  taRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<ViewMode>("edit");
  // 「彈出預覽獨立視窗」狀態與同步頻道。
  const [poppedOut, setPoppedOut] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const popupRef = useRef<Window | null>(null);

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

  /** 開啟／聚焦「獨立預覽視窗」：以 BroadcastChannel 即時把編輯框最新 markdown 推給它渲染。 */
  const openPopout = () => {
    if (poppedOut) { popupRef.current?.focus(); return; }
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
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
    popupRef.current = window.open(
      "/notes/preview-popout",
      "zonwiki-note-preview",
      "width=780,height=920,menubar=no,toolbar=no,location=no,status=no",
    );
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

  // 卸載時關閉頻道與視窗，避免殘留。
  useEffect(() => {
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
      try { popupRef.current?.close(); } catch { /* 跨視窗關閉可能受限，忽略 */ }
    };
  }, []);

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

  // 圖片插入：支援「貼上剪貼簿圖片」與「選檔上傳」，直接以 data URL 內嵌（不需網址）。
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 在指定位置插入圖片 Markdown（src 可為 data URL 或網址）。 */
  const insertImageAt = (src: string, pos: number, alt = "圖片") => {
    const md = `![${alt}](${src})`;
    onChange(value.slice(0, pos) + md + value.slice(pos));
    restore(pos + md.length, pos + md.length);
  };

  /** 讀取圖片檔成 data URL 後插入到 pos。 */
  const insertImageFile = (file: File, pos: number) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") insertImageAt(reader.result, pos);
    };
    reader.readAsDataURL(file);
  };

  /** 貼上事件：剪貼簿含圖片時直接內嵌（不需網址）。 */
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
    { label: "⊞", title: "表格", run: () => insertBlock("| 欄位 1 | 欄位 2 |\n| --- | --- |\n| 內容 | 內容 |") },
    { label: "▸", title: "摺疊區塊（Notion 式 toggle：點標題可摺疊／展開）", run: () => insertBlock(TOGGLE_SNIPPET) },
    { label: "🔒", title: "保護區塊（框住不想被 AI 重排的內容；重排時會原樣保留）", run: wrapProtect },
    { label: "🖼", title: "插入圖片（選檔上傳；也可直接貼上剪貼簿圖片）", run: () => fileInputRef.current?.click() },
    { label: "―", title: "分隔線", run: () => insertBlock("---") },
    { label: "🔗", title: "連結", run: () => wrap("[", "](url)", "文字") },
  ];

  // 彈出後：編輯區佔滿全寬、不顯示內嵌預覽（預覽在獨立視窗）。
  const showEditor = poppedOut || !withPreview || view !== "preview";
  const showPreview = !poppedOut && withPreview && view !== "edit";

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
                onClick={() => setView(m)}
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
              onClick={poppedOut ? closePopout : openPopout}
              title={poppedOut ? "關閉獨立預覽視窗、恢復內嵌預覽" : "把預覽彈出成獨立視窗（可拖到另一個螢幕，即時同步）"}
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
            placeholder={placeholder}
            aria-label={ariaLabel}
          />
        )}
        {showPreview && (
          <div className="mde-preview md-preview" style={{ minHeight }}>
            {value.trim() ? (
              <ToggleAwareMarkdown value={value} />
            ) : (
              <span className="mde-muted">預覽會顯示在這裡…</span>
            )}
          </div>
        )}
      </div>

      {poppedOut && (
        <div className="mde-popout-hint">
          預覽已彈出成獨立視窗（即時同步中）。編輯區已切換全寬；關閉該視窗或按「⇲ 收回預覽」即可恢復內嵌預覽。
        </div>
      )}
    </div>
  );
}
