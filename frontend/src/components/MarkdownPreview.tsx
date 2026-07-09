"use client";

import { useMemo, useRef, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkHtmlLineBreak from "@/lib/remarkHtmlLineBreak";
import { parseToggleSegments } from "@/lib/toggleBlocks";
import { toAbsoluteAttachmentUrl } from "@/lib/attachmentUrl";
import { toggleTaskCheckbox } from "@/lib/markdownChecklist";
import { parseCodeMeta, setCodeFenceMeta } from "@/lib/codeBlockMeta";
import { CodeBlock } from "@/components/CodeBlock";

/**
 * 網址轉換：附件相對路徑（/api/attachments/{id}）先補成 API 絕對網址
 * （本地 dev 前後端跨埠，<img> 不補會 404），再交給 react-markdown 預設的安全過濾。
 * 其他網址（http(s)/data: 等）原樣進預設過濾——行為與未加此轉換前完全一致
 * （註：預設過濾本就會擋掉 data: 協定，所以舊 base64 圖在「編輯預覽」一直都不顯示，
 * 只在「閱讀檢視」（後端渲染 HTML）顯示；此為既有行為，非本次改動造成）。
 */
const attachmentUrlTransform = (url: string) => defaultUrlTransform(toAbsoluteAttachmentUrl(url));

/**
 * 互動式編輯的共享脈絡（遞迴時往下傳），供「待辦核取」與「程式碼區塊語言／檔名」回寫共用。
 * rootRef＝整棵渲染樹的根容器（供點擊/變更時就地數「這是第幾個 checkbox／程式碼區塊」）；
 * root＝完整 Markdown 原文；onRoot＝把變更後的完整原文回寫上層。
 *
 * 為何用「點擊/變更時查 DOM 的文件順序」而非「render 時遞增計數器」：
 * 在 render 過程中對共享可變物件自增是 impure render（React StrictMode 會 double-invoke
 * render，同一顆計數器被多算一次，導致索引錯位）。改在「事件」時，從已提交的 DOM 依文件順序
 * 算出目標是第幾個，與 render 次數無關，恆正確。
 */
interface InteractiveContext {
  rootRef: React.RefObject<HTMLElement | null>;
  root: string;
  onRoot: (next: string) => void;
}

/** 從 react-markdown 傳給 `pre` 的 props 取出內部 `<code>` 的原始文字與 className。 */
function extractCode(children: ReactNode): { text: string; className?: string } {
  const codeEl = children as ReactElement<{ className?: string; children?: ReactNode }> | undefined;
  const className = codeEl?.props?.className;
  const raw = codeEl?.props?.children;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : String(raw ?? "");
  return { text: text.replace(/\n$/, ""), className: className ?? undefined };
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
  __ctx?: InteractiveContext;
}) {
  // 只在 value 改變時重新解析（切換檢視等其他重繪不必重跑）。
  const segments = useMemo(() => parseToggleSegments(value), [value]);

  // 整棵渲染樹的根容器（只有頂層互動模式才掛在真正的容器上，供點擊/變更時算文件順序索引）。
  const rootRef = useRef<HTMLDivElement>(null);
  // 頂層依 onChange 建立脈絡；遞迴時沿用同一個 rootRef／root／onRoot（巢狀元素也回寫同一份原文）。
  const ctx: InteractiveContext | undefined =
    __ctx ?? (onChange ? { rootRef, root: value, onRoot: onChange } : undefined);

  // 程式碼區塊：一律用 CodeBlock 渲染（語法上色＋標題列）；互動模式（有 ctx）時檔名/語言可就地編輯，
  // 變更時查 DOM 算出「這是第幾個程式碼區塊」再回寫圍欄（StrictMode/concurrent 皆對齊）。
  const renderPre = (props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) => {
    const { text, className } = extractCode(props.children);
    const { lang, filename } = parseCodeMeta(className);
    return (
      <CodeBlock
        code={text}
        lang={lang}
        filename={filename}
        interactive={!!ctx}
        onMetaChange={
          ctx
            ? (newLang, newFile, self) => {
                const container = ctx.rootRef.current;
                if (!container || !self) return;
                const blocks = Array.from(container.querySelectorAll(".code-block"));
                const idx = blocks.indexOf(self);
                if (idx >= 0) ctx.onRoot(setCodeFenceMeta(ctx.root, idx, newLang, newFile));
              }
            : undefined
        }
      />
    );
  };

  // 互動模式才覆寫 input：把待辦核取方塊改成可點擊。點擊時從已提交 DOM 依文件順序算出
  // 「這是第幾個 checkbox」（不依賴 render 次數 → StrictMode/concurrent 皆正確），再切換原文對應項目。
  const components: Components = ctx
    ? {
        pre: renderPre,
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
    : { pre: renderPre };

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
        remarkPlugins={[remarkGfm, remarkHtmlLineBreak]}
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
