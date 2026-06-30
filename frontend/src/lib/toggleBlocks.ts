/**
 * 摺疊區塊（Notion 式 toggle）解析工具。
 *
 * 語法（與後端 Markdig 擴充 ToggleContainerExtension 一致）：
 *   :::toggle 我的標題
 *   內文（可含任意 Markdown，甚至巢狀 toggle）
 *   :::
 *
 * - `:::toggle`：預設收合；`:::toggle-open`：預設展開。
 * - 此解析器供「編輯器預覽」使用：把字串切成「一般 Markdown 段」與「toggle 段」，
 *   讓預覽以真正的 React <details> 渲染（安全：標題為純文字、內文走 react-markdown，
 *   不啟用 raw HTML，故無 XSS 風險）。
 * - 會略過 ``` / ~~~ 程式碼圍欄內的 `:::`，避免把程式碼誤判成 toggle。
 * - 以「冒號區塊」深度計數支援巢狀 toggle（內文原樣保留，渲染時可再遞迴解析）。
 *
 * 註：這是「預覽用」的輕量近似解析；真正落地的 HTML 由後端 Markdig 產生。
 */

/** 一般 Markdown 段。 */
export interface MarkdownSegment {
  /** 段別。 */
  type: "markdown";
  /** 原始 Markdown 文字。 */
  text: string;
}

/** 摺疊區塊段。 */
export interface ToggleSegment {
  /** 段別。 */
  type: "toggle";
  /** 摘要標題（純文字）。 */
  title: string;
  /** 是否預設展開。 */
  open: boolean;
  /** 內文（原始 Markdown，可能含巢狀 toggle）。 */
  body: string;
}

/** 預覽用的內容段落。 */
export type ContentSegment = MarkdownSegment | ToggleSegment;

/** 比對程式碼圍欄起訖（``` 或 ~~~，至少 3 個）。 */
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
/** 比對 toggle 起始行：`:::toggle` 或 `:::toggle-open`，其後為可選標題。 */
const TOGGLE_OPEN_PATTERN = /^:::\s*(toggle-open|toggle)\b[ \t]*(.*)$/;
/** 比對任一自訂容器起始行（`:::名稱…`），用於巢狀深度計數。 */
const CONTAINER_OPEN_PATTERN = /^:::\s*\S/;
/** 比對自訂容器結束行（單獨的 `:::`）。 */
const CONTAINER_CLOSE_PATTERN = /^:::\s*$/;

/**
 * 把 Markdown 內容切成「一般段」與「toggle 段」。
 * @param markdown 原始 Markdown 內容。
 * @returns 依序排列的內容段落。
 */
export function parseToggleSegments(markdown: string): ContentSegment[] {
  const lines = markdown.split("\n");
  const segments: ContentSegment[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceChar = "";

  /** 把累積的一般 Markdown 行收成一段。 */
  const flushMarkdown = (): void => {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", text: buffer.join("\n") });
      buffer = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // 追蹤程式碼圍欄狀態：圍欄內的 ::: 一律當一般文字。
    const fenceMatch = trimmed.match(FENCE_PATTERN);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
      } else if (trimmed.startsWith(fenceChar.repeat(3))) {
        inFence = false;
      }
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }

    // toggle 起始 → 往下收集內文直到「對應」的結束 :::（支援巢狀）。
    const openMatch = trimmed.match(TOGGLE_OPEN_PATTERN);
    if (openMatch) {
      const isOpen = openMatch[1] === "toggle-open";
      const title = openMatch[2].trim();
      const bodyLines: string[] = [];
      let depth = 1;
      let innerFence = false;
      let innerFenceChar = "";
      let j = i + 1;

      for (; j < lines.length; j += 1) {
        const bodyLine = lines[j];
        const bodyTrimmed = bodyLine.trimStart();

        const innerFenceMatch = bodyTrimmed.match(FENCE_PATTERN);
        if (innerFenceMatch) {
          if (!innerFence) {
            innerFence = true;
            innerFenceChar = innerFenceMatch[1][0];
          } else if (bodyTrimmed.startsWith(innerFenceChar.repeat(3))) {
            innerFence = false;
          }
          bodyLines.push(bodyLine);
          continue;
        }
        if (!innerFence && CONTAINER_CLOSE_PATTERN.test(bodyTrimmed)) {
          depth -= 1;
          if (depth === 0) {
            break;
          }
          bodyLines.push(bodyLine);
          continue;
        }
        if (!innerFence && CONTAINER_OPEN_PATTERN.test(bodyTrimmed)) {
          depth += 1;
          bodyLines.push(bodyLine);
          continue;
        }
        bodyLines.push(bodyLine);
      }

      flushMarkdown();
      segments.push({ type: "toggle", title, open: isOpen, body: bodyLines.join("\n") });
      i = j; // 跳過結束的 :::（若未找到結束，j 已到結尾）
      continue;
    }

    buffer.push(line);
  }

  flushMarkdown();
  return segments;
}

/** toggle 起始行的整段樣板（供工具列「插入摺疊區塊」用）。 */
export const TOGGLE_SNIPPET = ":::toggle 標題\n內容\n:::";
