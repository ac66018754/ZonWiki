"use client";

import { useMemo, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseToggleSegments } from "@/lib/toggleBlocks";
import { toAbsoluteAttachmentUrl } from "@/lib/attachmentUrl";

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
 * 摺疊區塊感知的 Markdown 預覽（編輯器並排預覽、彈出預覽視窗共用）。
 *
 * 把內容切成「一般 Markdown 段」「toggle 段」「protect 段」：一般段交給 react-markdown，
 * toggle 段渲染成真正的 <details>（原生摺疊），protect 段（`:::protect`）渲染成帶 🔒 標記的
 * 保護區塊（重排時會被跳過）；內文都再遞迴渲染以支援巢狀。
 * 安全性：標題為純文字（React 自動轉義）、內文走 react-markdown（未啟用 raw HTML），故無 XSS。
 * 與後端 Markdig 的 :::toggle / :::protect 渲染對齊，編輯預覽與實際閱讀檢視外觀一致。
 */
export function ToggleAwareMarkdown({ value }: { value: string }) {
  // 只在 value 改變時重新解析（切換檢視等其他重繪不必重跑）。
  const segments = useMemo(() => parseToggleSegments(value), [value]);
  return (
    <>
      {segments.map((seg, i) => {
        // 以「型別＋位置＋內容前綴」當 key：內容變動（如重排 toggle）時會換 key →
        // 重新掛載並套用各自宣告的預設展開狀態，避免 index key 把舊 DOM 展開狀態錯位到新元素。
        const keyHint = (seg.type === "toggle" ? seg.title : seg.type === "protect" ? seg.body : seg.text).slice(0, 24);
        const key = `${seg.type}-${i}-${keyHint}`;
        if (seg.type === "toggle") {
          return (
            <details key={key} className="md-toggle" open={seg.open}>
              <summary className="md-toggle-summary">{seg.title || "詳細內容"}</summary>
              <div className="md-toggle-body">
                <ToggleAwareMarkdown value={seg.body} />
              </div>
            </details>
          );
        }
        if (seg.type === "protect") {
          return (
            <div key={key} className="md-protect" title="保護區塊：AI 重排時會跳過、保持原樣">
              <ToggleAwareMarkdown value={seg.body} />
            </div>
          );
        }
        return (
          <ReactMarkdown
            key={key}
            remarkPlugins={[remarkGfm]}
            components={{ pre: PreWithCopy }}
            urlTransform={attachmentUrlTransform}
          >
            {seg.text}
          </ReactMarkdown>
        );
      })}
    </>
  );
}
