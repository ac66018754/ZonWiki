/**
 * Markdown 待辦清單（GFM task list）核取方塊的「就地切換」工具。
 *
 * 用途：讓預覽/渲染出來的 checkbox 可直接點擊勾選/取消，並把變更寫回原始 Markdown。
 * 以「文件順序索引」對應：第 N 個渲染出來的 checkbox ↔ 原文中第 N 個 task 標記
 *（`- [ ]` / `- [x]`）。渲染順序與原文順序一致（react-markdown 依原文順序渲染，
 * 且程式碼圍欄內的 `- [ ]` 不會被當成 checkbox），故索引可對齊。
 */

/** 程式碼圍欄起訖（``` 或 ~~~，至少 3 個）。 */
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
/**
 * 待辦清單項目行：行首（可含縮排、可含 blockquote 的 `>` 前綴，如 `> - [ ]`），之後為
 * `-`/`*`/`+` 或 `1.`/`1)` 標記，再接 `[ ]`/`[x]`/`[X]`，且 `]` 後須接空白或行尾
 *（對齊 GFM／remark-gfm 的判定）。
 * - `(?:>\s*)*`：容許 blockquote 內的待辦清單（remark-gfm 仍會渲染成 checkbox，掃描端也要算到，
 *   否則從該行起索引會與渲染端永久錯位）。前綴含在 $1，replace 時原樣保留。
 * - `(?=\s|$)`：避免把 `- [x]文字`（`]` 後無空白，不會被渲染成 checkbox）誤算。
 * 分三段擷取以便只替換中間的核取字元：$1＝前綴＋標記＋`[`、$2＝核取字元、$3＝`]`。
 */
const TASK_ITEM_PATTERN = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])(?=\s|$)/;

/**
 * 切換 Markdown 中「第 index 個」待辦項目的核取狀態（`[ ]` ⇄ `[x]`）。
 * 會略過程式碼圍欄（``` / ~~~）內的內容，避免把程式碼裡的 `- [ ]` 誤判成 checkbox。
 *
 * @param markdown 原始 Markdown 內容。
 * @param index 目標 checkbox 的文件順序索引（0 起算）。
 * @returns 切換後的新 Markdown；找不到對應項目時原樣回傳。
 */
export function toggleTaskCheckbox(markdown: string, index: number): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceChar = "";
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart();

    // 追蹤程式碼圍欄狀態：圍欄內一律略過。
    const fenceMatch = trimmed.match(FENCE_PATTERN);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
      } else if (trimmed.startsWith(fenceChar.repeat(3))) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const match = lines[i].match(TASK_ITEM_PATTERN);
    if (!match) continue;

    if (count === index) {
      const nextChar = match[2] === " " ? "x" : " ";
      lines[i] = lines[i].replace(TASK_ITEM_PATTERN, `$1${nextChar}$3`);
      return lines.join("\n");
    }
    count += 1;
  }

  return markdown;
}
