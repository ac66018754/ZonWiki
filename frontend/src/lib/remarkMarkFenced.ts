/**
 * remark 小外掛：判斷 mdast「程式碼區塊」是否為「圍欄程式碼區塊」（``` / ~~~），是則標
 * hProperties `data-fenced`，讓渲染出的 `<code>` 帶 `data-fenced` 屬性。
 *
 * 用途：編輯預覽要「只對圍欄碼可就地改語言／檔名、且以圍欄順序對應原文」，與後端 data-fence-index、
 * setCodeFenceMeta（只數圍欄碼）一致——否則含縮排程式碼區塊時，DOM 的第 N 個 .code-block 會與
 * 原文第 N 個圍欄對不上、改到別的區塊（跨區塊資料損毀）。
 *
 * 判定：縮排程式碼區塊在 mdast 與圍欄同為 `code` 節點、無法只靠型別區分，故看「該節點來源起始行是否
 * 為 ``` / ~~~ 開頭」（可帶 blockquote `>` 前綴）。
 *
 * 相依：本檔零外部 import（`unist-util-visit`／`mdast` 為間接相依、直接 import 會在 pnpm 嚴格模式下
 * 解析失敗），自帶最小型別與遞迴走訪。
 */

/** mdast 節點的最小結構（只取本外掛需要的欄位）。 */
interface MdastNode {
  type: string;
  position?: { start?: { line?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MdastNode[];
}

/** unified VFile 的最小結構（只取原始內容）。 */
interface VFileLike {
  value?: unknown;
}

/** 圍欄開啟行：可帶縮排與 blockquote `>` 前綴，接著至少 3 個 ` 或 ~。 */
const FENCE_OPEN_LINE = /^\s*(>\s*)*[`~]{3,}/;

/**
 * 遞迴走訪，對「來源起始行為圍欄」的 code 節點標上 data-fenced。
 * @param node 目前節點。
 * @param lines 原始 Markdown 的逐行陣列（供以行號判定圍欄）。
 */
function markFenced(node: MdastNode, lines: string[]): void {
  if (node.type === 'code' && node.position?.start?.line) {
    const lineText = lines[node.position.start.line - 1] ?? '';
    if (FENCE_OPEN_LINE.test(lineText)) {
      node.data = node.data ?? {};
      node.data.hProperties = { ...(node.data.hProperties ?? {}), 'data-fenced': '' };
    }
  }
  if (node.children) {
    for (const child of node.children) markFenced(child, lines);
  }
}

/**
 * remark 外掛工廠：回傳一個 mdast transformer，替圍欄程式碼區塊標 data-fenced。
 * @returns unified transformer。
 */
export default function remarkMarkFenced() {
  return (tree: MdastNode, file: VFileLike): void => {
    const lines = String(file.value ?? '').split('\n');
    markFenced(tree, lines);
  };
}
