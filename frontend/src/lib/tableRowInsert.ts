/**
 * 讀模式表格「＋ 新增一行」的純文字運算（2026-08-13 使用者裁示）。
 *
 * 以 anchorMdLine（後端 data-md-line，1 起算）定位所屬的「真表格區塊」，
 * 在區塊最後一列之後插入空列（欄數以分隔列為準、儲存格預設全空），
 * 交給筆記頁既有的 applyReadingEdit 管線 PUT 寫回。
 *
 * 慣例對齊 tableSpec：行號 1 起算、`split('\n')` 切行、目標行剝 `\r` 處理、
 * 寫回還原（混合行尾也安全）；blockquote 前綴由 splitTableRowLine 的 prefix 重建。
 * 「真表格」判準（對抗復審 H4/M1 同款收緊）：區塊內必須有分隔列
 * （cells 全符合 `:?-+:?`）緊接在表頭之後——無分隔列的偽表格（散文管線行）不動作。
 */

import { splitTableRowLine } from './tableSpec';

/** 圍欄起訖行（語意同 editorFolding 的 FENCE_PATTERN：至多 3 空白＋``` 或 ~~~）。 */
const FENCE_PATTERN = /^ {0,3}(```|~~~)/;

/** GFM 分隔列的儲存格內容（`---`、`:---`、`---:`、`:---:`）。 */
const SEPARATOR_CELL_PATTERN = /^:?-+:?$/;

/** 剝除行尾 `\r`（CRLF 檔以 `\n` 切行後各行可能殘留）。 */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** 該行是否為合法表格列（含表頭/分隔/資料列）。 */
function isTableRowLine(line: string): boolean {
  return splitTableRowLine(stripCarriageReturn(line)).valid;
}

/** 該行是否為 GFM 分隔列。 */
function isSeparatorRowLine(line: string): boolean {
  const split = splitTableRowLine(stripCarriageReturn(line));
  return (
    split.valid &&
    split.cells.length > 0 &&
    split.cells.every((cell) => SEPARATOR_CELL_PATTERN.test(cell))
  );
}

/**
 * 在 anchorMdLine 所屬表格的最後一列之後插入一列空儲存格。
 *
 * @param content 筆記原始 Markdown 全文。
 * @param anchorMdLine 該表任一表頭/資料列的行號（1 起算，來自 data-md-line）。
 * @returns 插入後的全文；定位失敗（行號越界、非表格列、位於圍欄內、
 *          區塊無分隔列的偽表格）時回 null（呼叫端負責提示）。
 */
export function appendEmptyTableRow(content: string, anchorMdLine: number): string | null {
  const lines = content.split('\n');
  const anchorIndex = anchorMdLine - 1; // 1-based 行號 → 0-based 索引
  if (anchorIndex < 0 || anchorIndex >= lines.length) return null;
  if (!isTableRowLine(lines[anchorIndex])) return null;

  // 圍欄防護：data-md-line 理論上不會指進圍欄，但屬防禦性檢查（fence 內的管線行不是表格）。
  let insideFence = false;
  for (let i = 0; i < anchorIndex; i++) {
    if (FENCE_PATTERN.test(stripCarriageReturn(lines[i]))) insideFence = !insideFence;
  }
  if (insideFence) return null;

  // 連續表格列區塊（圍欄分隔行本身不是合法表格列，天然截斷區塊）。
  let blockStart = anchorIndex;
  while (blockStart > 0 && isTableRowLine(lines[blockStart - 1])) blockStart--;
  let blockEnd = anchorIndex;
  while (blockEnd < lines.length - 1 && isTableRowLine(lines[blockEnd + 1])) blockEnd++;

  // 真表格判準：區塊內找「表頭＋緊接分隔列」的組合；anchor 必須落在表頭（含）之後。
  let separatorIndex = -1;
  for (let i = blockStart + 1; i <= blockEnd; i++) {
    if (isSeparatorRowLine(lines[i]) && !isSeparatorRowLine(lines[i - 1])) {
      separatorIndex = i;
      break;
    }
  }
  if (separatorIndex === -1) return null; // 無分隔列＝偽表格（T9）
  if (anchorIndex < separatorIndex - 1) return null; // anchor 在表頭之前的散文管線行

  const separator = splitTableRowLine(stripCarriageReturn(lines[separatorIndex]));
  const columnCount = separator.cells.length;

  // 新列：沿用區塊最後一列的前綴（blockquote 表格 → `> |  |  |`），標準前後導管線。
  const lastLine = lines[blockEnd];
  const prefix = splitTableRowLine(stripCarriageReturn(lastLine)).prefix;
  const emptyRowBody = `|${'  |'.repeat(columnCount)}`;

  // CRLF：以區塊首行是否帶 `\r` 判定檔案行尾風格（檔尾行天然無 `\r`，不能只看最後一列）。
  const isCrlfStyle = lines[blockStart].endsWith('\r');
  if (isCrlfStyle && !lines[blockEnd].endsWith('\r')) {
    // 原最後一列在檔尾（無行尾）——插入後它不再是檔尾，補回 `\r` 維持 CRLF 一致。
    lines[blockEnd] = `${lines[blockEnd]}\r`;
  }
  // 新列僅在「非檔尾」時帶 `\r`（檔尾行無行尾字元）。
  const newRowCr = isCrlfStyle && blockEnd < lines.length - 1 ? '\r' : '';

  lines.splice(blockEnd + 1, 0, `${prefix}${emptyRowBody}${newRowCr}`);
  return lines.join('\n');
}
