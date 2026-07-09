"use client";

import { useMemo, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseToggleSegments } from "@/lib/toggleBlocks";
import { toAbsoluteAttachmentUrl } from "@/lib/attachmentUrl";
import { toggleTaskCheckbox } from "@/lib/markdownChecklist";

/**
 * 網址轉換：附件相對路徑（/api/attachments/{id}）先補成 API 絕對網址
 * （本地 dev 前後端跨埠，<img> 不補會 404），再交給 react-markdown 預設的安全過濾。
 * 其他網址（http(s)/data: 等）原樣進預設過濾——行為與未加此轉換前完全一致
 * （註：預設過濾本就會擋掉 data: 協定，所以舊 base64 圖在「編輯預覽」一直都不顯示，
 * 只在「閱讀檢視」（後端渲染 HTML）顯示；此為既有行為，非本次改動造成）。
 */
const attachmentUrlTransform = (url: string) => defaultUrlTransform(toAbsoluteAttachmentUrl(url));

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
 * 互動式待辦核取的共享脈絡（遞迴時往下傳）。
 * rootRef＝整棵渲染樹的根容器（供點擊時就地數「這是第幾個 checkbox」）；
 * root＝完整 Markdown 原文；onRoot＝把切換後的完整原文回寫上層。
 *
 * 為何用「點擊時查 DOM 的文件順序」而非「render 時遞增計數器」：
 * 在 render 過程中對共享可變物件自增是 impure render（React StrictMode 會 double-invoke
 * render，同一顆計數器被多算一次，導致索引錯位、勾錯 checkbox）。改在「點擊事件」時，
 * 從已提交的 DOM 依文件順序算出被點的是第幾個 checkbox，與 render 次數無關，恆正確。
 */
interface CheckboxToggleContext {
  rootRef: React.RefObject<HTMLElement | null>;
  root: string;
  onRoot: (next: string) => void;
}

/**
 * 摺疊區塊感知的 Markdown 預覽（編輯器並排預覽、彈出預覽視窗共用）。
 *
 * 把內容切成「一般 Markdown 段」「toggle 段」「protect 段」：一般段交給 react-markdown，
 * toggle 段渲染成真正的 <details>（原生摺疊），protect 段（`:::protect`）渲染成帶 🔒 標記的
 * 保護區塊（重排時會被跳過）；內文都再遞迴渲染以支援巢狀。
 * 安全性：標題為純文字（React 自動轉義）、內文走 react-markdown（未啟用 raw HTML），故無 XSS。
 * 與後端 Markdig 的 :::toggle / :::protect 渲染對齊，編輯預覽與實際閱讀檢視外觀一致。
 *
 * 互動式待辦核取（需求 #7）：傳入 onChange 時，待辦清單 `- [ ]` 的核取方塊變成「可點擊」，
 * 點一下即勾選/取消並把切換後的完整 Markdown 透過 onChange 回寫（供編輯器即時更新 + 保存）。
 * 未傳 onChange 則維持唯讀（disabled）行為。
 *
 * @param value 要渲染的 Markdown。
 * @param onChange 待辦核取被點擊時的回寫（提供才變成可互動）。
 * @param __ctx 內部遞迴用：共享核取脈絡（外部呼叫請勿傳）。
 */
export function ToggleAwareMarkdown({
  value,
  onChange,
  __ctx,
}: {
  value: string;
  onChange?: (next: string) => void;
  __ctx?: CheckboxToggleContext;
}) {
  // 只在 value 改變時重新解析（切換檢視等其他重繪不必重跑）。
  const segments = useMemo(() => parseToggleSegments(value), [value]);

  // 整棵渲染樹的根容器（只有頂層互動模式才掛在真正的容器上，供點擊時算文件順序索引）。
  const rootRef = useRef<HTMLDivElement>(null);
  // 頂層依 onChange 建立脈絡；遞迴時沿用同一個 rootRef／root／onRoot（巢狀 checkbox 也回寫同一份原文）。
  const ctx: CheckboxToggleContext | undefined =
    __ctx ?? (onChange ? { rootRef, root: value, onRoot: onChange } : undefined);

  // 互動模式才覆寫 input：把待辦核取方塊改成可點擊。點擊時從已提交 DOM 依文件順序算出
  // 「這是第幾個 checkbox」（不依賴 render 次數 → StrictMode/concurrent 皆正確），再切換原文對應項目。
  const components: Components = ctx
    ? {
        pre: PreWithCopy,
        input: (props) => {
          const { node: _node, type, checked, disabled: _disabled, ...rest } =
            props as ComponentPropsWithoutRef<"input"> & { node?: unknown };
          if (type !== "checkbox") return <input type={type} {...rest} />;
          return (
            <input
              {...rest}
              type="checkbox"
              checked={!!checked}
              onChange={(e) => {
                const container = ctx.rootRef.current;
                if (!container) return;
                const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
                const idx = boxes.indexOf(e.currentTarget);
                if (idx >= 0) ctx.onRoot(toggleTaskCheckbox(ctx.root, idx));
              }}
              style={{ cursor: "pointer", ...(rest.style ?? {}) }}
            />
          );
        },
      }
    : { pre: PreWithCopy };

  const body = segments.map((seg, i) => {
    // 以「型別＋位置＋內容前綴」當 key：內容變動（如重排 toggle）時會換 key →
    // 重新掛載並套用各自宣告的預設展開狀態，避免 index key 把舊 DOM 展開狀態錯位到新元素。
    const keyHint = (seg.type === "toggle" ? seg.title : seg.type === "protect" ? seg.body : seg.text).slice(0, 24);
    const key = `${seg.type}-${i}-${keyHint}`;
    if (seg.type === "toggle") {
      return (
        <details key={key} className="md-toggle" open={seg.open}>
          <summary className="md-toggle-summary">{seg.title || "詳細內容"}</summary>
          <div className="md-toggle-body">
            <ToggleAwareMarkdown value={seg.body} __ctx={ctx} />
          </div>
        </details>
      );
    }
    if (seg.type === "protect") {
      return (
        <div key={key} className="md-protect" title="保護區塊：AI 重排時會跳過、保持原樣">
          <ToggleAwareMarkdown value={seg.body} __ctx={ctx} />
        </div>
      );
    }
    return (
      <ReactMarkdown
        key={key}
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={attachmentUrlTransform}
      >
        {seg.text}
      </ReactMarkdown>
    );
  });

  // 頂層互動模式：包一層 display:contents 容器以取得 DOM 根（display:contents 不生成盒子、
  // 不影響版面；經確認 globals.css 對 .md-preview/.markdown-prose 沒有直接子選擇器，故安全）。
  // 遞迴（__ctx 存在）或非互動模式不包，維持原本 fragment 結構。
  if (ctx && !__ctx) {
    return <div ref={rootRef} style={{ display: "contents" }}>{body}</div>;
  }
  return <>{body}</>;
}
