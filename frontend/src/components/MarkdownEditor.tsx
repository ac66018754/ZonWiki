"use client";

import { useMemo, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseToggleSegments, TOGGLE_SNIPPET } from "@/lib/toggleBlocks";

/**
 * 預覽中的程式碼區塊：包一層容器並加上「複製」按鈕。
 * react-markdown 會把 ```code``` 渲染成 <pre><code>…</code></pre>，
 * 這裡覆寫 pre 的渲染以加入複製鈕（醒目化與換行樣式見 globals.css 的 .md-preview pre）。
 * 複製時直接從 DOM 讀同層的 <pre> 文字（避免 useRef，與本檔其餘 React 風格一致）。
 */
function PreWithCopy(props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const { children, ...rest } = props;
  // 移除 react-markdown 注入的 node，避免被展開到 DOM。
  delete (rest as { node?: unknown }).node;

  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const pre = e.currentTarget.parentElement?.querySelector("pre");
    const text = pre?.textContent ?? "";
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch {
      /* 忽略複製失敗 */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block-wrap">
      <button
        type="button"
        className={`code-copy-btn${copied ? " copied" : ""}`}
        onClick={copy}
        aria-label="複製程式碼"
      >
        {copied ? "已複製" : "複製"}
      </button>
      <pre {...rest}>{children}</pre>
    </div>
  );
}

/**
 * 摺疊區塊感知的 Markdown 預覽。
 *
 * 把內容切成「一般 Markdown 段」與「toggle 段」：一般段交給 react-markdown，
 * toggle 段渲染成真正的 <details>（原生摺疊），內文再遞迴渲染以支援巢狀 toggle。
 * 安全性：標題為純文字（React 自動轉義）、內文走 react-markdown（未啟用 raw HTML），故無 XSS。
 * 與後端 Markdig 的 :::toggle 渲染對齊，編輯預覽與實際閱讀檢視外觀一致。
 */
function ToggleAwareMarkdown({ value }: { value: string }) {
  // 只在 value 改變時重新解析（切換檢視等其他重繪不必重跑）。
  const segments = useMemo(() => parseToggleSegments(value), [value]);
  return (
    <>
      {segments.map((seg, i) => {
        // 以「型別＋位置＋內容前綴」當 key：內容變動（如重排 toggle）時會換 key →
        // 重新掛載並套用各自宣告的預設展開狀態，避免 index key 把舊 DOM 展開狀態錯位到新元素。
        const keyHint = (seg.type === "toggle" ? seg.title : seg.text).slice(0, 24);
        const key = `${seg.type}-${i}-${keyHint}`;
        return seg.type === "toggle" ? (
          <details key={key} className="md-toggle" open={seg.open}>
            <summary className="md-toggle-summary">{seg.title || "詳細內容"}</summary>
            <div className="md-toggle-body">
              <ToggleAwareMarkdown value={seg.body} />
            </div>
          </details>
        ) : (
          <ReactMarkdown key={key} remarkPlugins={[remarkGfm]} components={{ pre: PreWithCopy }}>
            {seg.text}
          </ReactMarkdown>
        );
      })}
    </>
  );
}

/**
 * 共用 Markdown 編輯器：文字輸入框 + 格式工具列。
 *
 * 工具列同時支援兩種用法：
 * - 先框選文字，再按格式鍵 → 套用到選取範圍（粗體、H1、程式碼區塊…）。
 * - 不選文字直接按格式鍵 → 插入標記並把游標放到正確位置，接著打字即可。
 *
 * 不熟 Markdown 的人也能用按鈕快速產生格式；熟的人仍可直接打字。
 * 可選 withPreview：提供 編輯／並排／預覽 三種檢視。
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
}: {
  value: string;
  onChange: (value: string) => void;
  /** textarea 失焦時觸發（例如即時存檔）。 */
  onBlur?: () => void;
  placeholder?: string;
  /** 編輯區最小高度（px）。 */
  minHeight?: number;
  /** 是否提供 編輯／並排／預覽 切換。 */
  withPreview?: boolean;
  /** 外層額外 class（例如畫布需要 nodrag）。 */
  className?: string;
  /** textarea 額外 class（沿用既有樣式時）。 */
  textareaClassName?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<ViewMode>("edit");

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

  // 工具列：常用的 Markdown 格式都備齊（標題 1~3、粗/斜/刪除線、清單/編號/待辦、引用、
  // 行內/區塊程式碼、表格、圖片、分隔線、連結）。
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
    { label: "🖼", title: "插入圖片（選檔上傳；也可直接貼上剪貼簿圖片）", run: () => fileInputRef.current?.click() },
    { label: "―", title: "分隔線", run: () => insertBlock("---") },
    { label: "🔗", title: "連結", run: () => wrap("[", "](url)", "文字") },
  ];

  const showEditor = !withPreview || view !== "preview";
  const showPreview = withPreview && view !== "edit";

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
                tabIndex={-1}
              >
                {m === "edit" ? "編輯" : m === "split" ? "並排" : "預覽"}
              </button>
            ))}
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
    </div>
  );
}
