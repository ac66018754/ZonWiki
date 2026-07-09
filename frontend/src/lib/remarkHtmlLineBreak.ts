/**
 * remark 小外掛：把 mdast「純文字節點」內的字面 <br> 家族切成硬換行。
 *
 * 背景：編輯預覽（MarkdownPreview）走 react-markdown + remark-gfm，且刻意「不」啟用
 * rehype-raw（不開放任意 raw HTML，以維持 XSS 防線），因此表格格內／段落內手寫的
 * `<br>` 預設是「字面文字」而非換行。後端 Markdig 已用白名單把 `<br>` 家族轉成硬換行
 * （見 HtmlLineBreakInlineExtension），本外掛讓前端編輯預覽與閱讀檢視對齊。
 *
 * 白名單：只認 `<br>` / `<br/>` / `<br />`（大小寫不敏感、`br` 之後與 `/` 前後允許空白／Tab）。
 * 其餘任何標籤（`<div>`、`<script>`、甚至近似但不合法的 `<brs>`／`<br x>`）皆不比對，維持字面。
 *
 * 【關鍵】節點型別：remark-parse 在「解析階段」就會把字面 `<br>` 標記成獨立的 mdast
 * `html` 型別節點（value 是整串標籤，如 `"<br>"`），**不會**殘留在相鄰 `text` 節點的字串裡。
 * 因此本外掛的主力是攔截「整串完全等於 `<br>` 家族」的 `html` 節點、換成硬換行 `break` 節點；
 * 另保留對 `text` 節點的切割當防禦（少數情境 `<br>` 可能落在文字中），兩路並行。
 * 連續 `<br><br>` 會被 remark 切成兩個獨立 `html` 節點，故「逐節點整串比對」天然能正確處理。
 *
 * 安全性：只把「整串精確匹配 `<br>` 家族」的 html 節點換成固定的 `break` 節點（無使用者可控欄位）；
 * 其餘 html 節點原樣保留（未啟用 rehype-raw，仍被 react-markdown 當文字轉義）。inline code 與
 * 程式碼區塊在 mdast 是 `inlineCode` / `code` 節點（各自帶 value、沒有 children），遞迴只進到帶
 * `children` 的節點，故完全不觸及程式碼內容 → 其內 `<br>` 維持字面。
 * 產生的 `break` 節點由 react-markdown 渲染成 `<br />`，不經過 raw HTML，零注入面。
 *
 * 註（相依性）：本專案以 pnpm 嚴格安裝，`unist-util-visit`／`mdast` 僅為間接相依、未列入
 * package.json，直接 import 會解析失敗；故本檔刻意「零外部 import」，自帶最小型別與遞迴走訪。
 */

/**
 * mdast 節點的最小結構（只取本外掛需要的欄位）。
 * - `type`：節點型別（如 "text"、"break"、"paragraph"、"tableCell"…）。
 * - `value`：文字類節點（text／inlineCode／code）的內容。
 * - `children`：容器類節點的子節點。
 */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * 白名單：字面 `<br>` 家族。
 * `<br` 後允許空白／Tab、可選一個自結束 `/`（其前後亦允許空白／Tab），最後為 `>`。
 * 全域旗標供 String.prototype.split 一次切開全部（split 不受 lastIndex 影響）。
 */
const BR_PATTERN = /<br[ \t]*\/?[ \t]*>/gi;

/**
 * 白名單（錨定整串版）：判斷一個 `html` 節點的 value 是否「整串就是」`<br>` 家族。
 * 用 `^…$` 錨定，確保只有「乾淨的單一 `<br>` 標籤」才算數，`<br onmouseover=x>` 之類一律不匹配。
 */
const BR_EXACT_PATTERN = /^<br[ \t]*\/?[ \t]*>$/i;

/**
 * 把一段文字依 `<br>` 家族切開，回傳「文字 / break」交錯的 mdast 節點陣列。
 * 沒有任何 `<br>` 時回傳 null（表示此節點不需改動）。
 *
 * @param value 原始文字節點內容。
 * @returns 切開後的節點陣列；若不含 `<br>` 則為 null。
 */
function splitTextOnBreak(value: string): MdastNode[] | null {
  const pieces = value.split(BR_PATTERN);
  if (pieces.length <= 1) {
    return null;
  }

  const result: MdastNode[] = [];
  pieces.forEach((piece, index) => {
    // 每兩段文字之間插入一個硬換行節點。
    if (index > 0) {
      result.push({ type: "break" });
    }
    // 略過空字串片段（例如 `<br>` 開頭／結尾），避免產生無意義的空文字節點。
    if (piece.length > 0) {
      result.push({ type: "text", value: piece });
    }
  });
  return result;
}

/**
 * 遞迴走訪並就地重建含 `<br>` 的文字節點。
 * 只重新指派 `children` 參考（換成新陣列），不逐一變異既有節點物件。
 *
 * @param node 目前走訪的 mdast 節點。
 */
function transformNode(node: MdastNode): void {
  const children = node.children;
  if (!children || children.length === 0) {
    return;
  }

  const nextChildren: MdastNode[] = [];
  for (const child of children) {
    if (child.type === "html" && typeof child.value === "string" && BR_EXACT_PATTERN.test(child.value)) {
      // 主力路徑：remark-parse 把字面 <br> 家族解析成獨立的 html 節點；整串精確匹配就換成硬換行。
      nextChildren.push({ type: "break" });
    } else if (child.type === "text" && typeof child.value === "string") {
      // 防禦路徑：少數情境 <br> 可能落在純文字節點裡，仍切開處理。
      const split = splitTextOnBreak(child.value);
      if (split) {
        nextChildren.push(...split);
        continue;
      }
      nextChildren.push(child);
    } else {
      // 其他節點：先遞迴處理其子樹（inlineCode／code 無 children，會在上面提早 return）。
      transformNode(child);
      nextChildren.push(child);
    }
  }
  node.children = nextChildren;
}

/**
 * remark 外掛工廠：回傳一個 mdast transformer，將字面 `<br>` 家族轉成硬換行節點。
 *
 * @returns unified transformer（就地轉換 mdast 樹）。
 */
export default function remarkHtmlLineBreak() {
  return (tree: MdastNode): void => {
    transformNode(tree);
  };
}
