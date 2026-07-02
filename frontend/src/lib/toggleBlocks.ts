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

/** 保護區塊段（`:::protect`）：AI 重排時會被跳過、保持原樣。 */
export interface ProtectSegment {
  /** 段別。 */
  type: "protect";
  /** 內文（原始 Markdown，可能含巢狀）。 */
  body: string;
}

/** 預覽用的內容段落。 */
export type ContentSegment = MarkdownSegment | ToggleSegment | ProtectSegment;

/** 比對程式碼圍欄起訖（``` 或 ~~~，至少 3 個）。 */
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
/** 比對 toggle 起始行：`:::toggle` 或 `:::toggle-open`，其後為可選標題。 */
const TOGGLE_OPEN_PATTERN = /^:::\s*(toggle-open|toggle)\b[ \t]*(.*)$/;
/** 比對 protect 起始行：`:::protect`（保護區塊，其後文字忽略）。 */
const PROTECT_OPEN_PATTERN = /^:::\s*protect\b[ \t]*.*$/;
/** 比對任一自訂容器起始行（`:::名稱…`），用於巢狀深度計數。 */
const CONTAINER_OPEN_PATTERN = /^:::\s*\S/;
/** 比對自訂容器結束行（單獨的 `:::`）。 */
const CONTAINER_CLOSE_PATTERN = /^:::\s*$/;

/**
 * 從容器起始行的「下一行」開始，收集容器內文直到「對應的」結束 `:::`（支援巢狀與程式碼圍欄）。
 * @param lines 全部行。
 * @param start 內文起始行索引（容器起始行的下一行）。
 * @returns body＝內文各行；end＝結束 `:::` 的行索引（若未閉合則為最後一行索引 lines.length）。
 */
function collectContainerBody(lines: string[], start: number): { body: string[]; end: number } {
  const bodyLines: string[] = [];
  let depth = 1;
  let innerFence = false;
  let innerFenceChar = "";
  let j = start;
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
      if (depth === 0) break;
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
  return { body: bodyLines, end: j };
}

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

    // protect 起始 → 收集內文直到對應結束 :::（保護區塊，重排時跳過）。先於 toggle 檢查（名稱不同、互斥）。
    if (PROTECT_OPEN_PATTERN.test(trimmed)) {
      const { body, end } = collectContainerBody(lines, i + 1);
      flushMarkdown();
      segments.push({ type: "protect", body: body.join("\n") });
      i = end; // 跳過結束的 :::（若未閉合，end 已到結尾）
      continue;
    }

    // toggle 起始 → 往下收集內文直到「對應」的結束 :::（支援巢狀）。
    const openMatch = trimmed.match(TOGGLE_OPEN_PATTERN);
    if (openMatch) {
      const isOpen = openMatch[1] === "toggle-open";
      const title = openMatch[2].trim();
      const { body, end } = collectContainerBody(lines, i + 1);
      flushMarkdown();
      segments.push({ type: "toggle", title, open: isOpen, body: body.join("\n") });
      i = end; // 跳過結束的 :::（若未找到結束，end 已到結尾）
      continue;
    }

    buffer.push(line);
  }

  flushMarkdown();
  return segments;
}

/** toggle 起始行的整段樣板（供工具列「插入摺疊區塊」用）。 */
export const TOGGLE_SNIPPET = ":::toggle 標題\n內容\n:::";

/** protect 區塊樣板（供工具列「保護區塊」在沒有選取時插入）。 */
export const PROTECT_SNIPPET = ":::protect\n（貼上不想被 AI 重排的內容）\n:::";

/** protect 切段的結果段落。 */
export interface ProtectSplitSegment {
  /** text＝可送 AI 重排的一般段；protect＝保護區塊（原樣保留、不送 AI）。 */
  type: "text" | "protect";
  /** 該段原始內容（protect 段含完整 `:::protect … :::` 圍欄）。 */
  content: string;
}

/**
 * 把 Markdown 依 `:::protect … :::` 區塊（含頂層與巢狀）切成有序段落（text／protect 交替）。
 *
 * 供「保護排版」用：只把 **text 段各自單獨** 送 AI 重排、protect 段原樣保留，再依序拼回。
 * 為何不用「占位符」：實測發現只要內容中夾入任何占位符標記行（如 `⟦PROTECTED-BLOCK-0⟧`、`<!--x-->`、
 * `［保留］`…），模型（在「不改變內容」的排版模式下）就會判定「內容已結構化 / 有特殊標記」而**整段原樣返回、
 * 完全不排版**——連該排的其餘內容也沒排。改成「把非保護段單獨送」可完全避開此問題（單獨的乾淨內容都排得好）。
 * @param markdown 原始 Markdown。
 * @returns 依序的段落；串接所有段的 content 即回到原文。
 */
export function splitByProtect(markdown: string): ProtectSplitSegment[] {
  const lines = markdown.split("\n");
  const segments: ProtectSplitSegment[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceChar = "";

  const flushText = (): void => {
    if (buffer.length > 0) {
      segments.push({ type: "text", content: buffer.join("\n") });
      buffer = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();

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
    if (!inFence && PROTECT_OPEN_PATTERN.test(trimmed)) {
      const { body, end } = collectContainerBody(lines, i + 1);
      const closeLine = end < lines.length ? lines[end] : ":::";
      flushText();
      segments.push({ type: "protect", content: [line, ...body, closeLine].join("\n") });
      i = end; // 跳過整個保護區塊
      continue;
    }
    buffer.push(line);
  }
  flushText();
  return segments;
}
