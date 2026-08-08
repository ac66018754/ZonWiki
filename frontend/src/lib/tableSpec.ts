/**
 * 表格語法核心（互動表格功能的純函數層）。
 *
 * 對應設計文件《互動表格與讀模式直編設計》§1／§2：
 * - 表頭尾碼 `{radio:選項1,選項2,…}`／`{checkbox}` 宣告控件、儲存格只存純文字值；
 *   表格維持 100% 合法 GFM，非法尾碼一律降級為「無控件、原文照顯」（不炸不猜）。
 * - 「DOM ↔ Markdown 位置對應」的行號來自後端 Markdig 的 `data-md-line`（權威行號）；
 *   本模組只做「行內」的欄位切分與替換（處理 `\|` 跳脫與前後導管線），
 *   屬行為明確的純函數，不是「前端逐行正則近似 CommonMark」禁區。
 * - blockquote／縮排前綴照 codeBlockMeta.ts 的 BLOCKQUOTE_PREFIX 先例：
 *   剝除後處理、寫回時原樣重建；前綴不合法（縮排 ≥ 4 空白＝縮排程式碼區塊）→ 判為不可直編。
 * - CRLF：逐行剝 `\r` 處理、寫回時還原各行原本的行尾風格（v2 修訂第 9 條）。
 */

// ────────────────────────── 型別 ──────────────────────────

/**
 * 表頭控件描述。
 * null＝無控件（一般文字欄）；radio＝單選 chip 欄；checkbox＝勾選欄。
 */
export type HeaderControl =
  | null
  | { kind: 'radio'; options: string[] }
  | { kind: 'checkbox' };

/**
 * parseHeaderSpec 的解析結果。
 */
export type ParsedHeaderSpec = {
  /** 顯示用表頭文字（合法尾碼已剝除並 trim；非法尾碼時＝原文）。 */
  displayText: string;
  /** 控件描述；無控件（含非法尾碼降級）時為 null。 */
  control: HeaderControl;
};

/**
 * splitTableRowLine 的切分結果。
 */
export type SplitTableRow = {
  /** 行首前綴（縮排＋blockquote 標記，如 `> `），寫回時原樣重建。 */
  prefix: string;
  /** 各儲存格內容（已 trim、已把 `\|` 還原成 `|`）。 */
  cells: string[];
  /** 行尾空白（保留原樣，寫回時不遺失）。 */
  suffix: string;
  /** 是否為合法可處理的 GFM 表格列；false＝該列降級為不可直編。 */
  valid: boolean;
};

// ────────────────────────── 常數與內部工具 ──────────────────────────

/**
 * 行首前綴比對：縮排（空白／tab）＋可多層的 blockquote 標記。
 * 照 codeBlockMeta.ts 的 BLOCKQUOTE_PREFIX 先例，但限定空白類為 [ \t]（單行內不會有換行）。
 */
const LINE_PREFIX_PATTERN = /^([ \t]*)((?:>[ \t]*)*)/;

/**
 * 表頭尾碼比對：結尾處的單層 `{…}`（大括號內不得再含大括號，巢狀自然不匹配）。
 * 尾碼後只允許空白——後面還有其他文字就不是尾碼。
 */
const HEADER_SUFFIX_PATTERN = /^(.*)\{([^{}]*)\}\s*$/;

/** radio 尾碼內容的前導關鍵字（大小寫敏感，照設計文件寫法）。 */
const RADIO_KEYWORD_PREFIX = 'radio:';

/** checkbox 尾碼內容（大小寫敏感）。 */
const CHECKBOX_KEYWORD = 'checkbox';

/** CommonMark：行首縮排達 4 空白（tab 視同 4）＝縮排程式碼區塊，不可能是表格列。 */
const INDENTED_CODE_BLOCK_WIDTH = 4;

/**
 * 計算縮排的視覺寬度（tab 依 CommonMark 視同 4 格）。
 * @param indent 行首的空白／tab 字串。
 * @returns 縮排寬度（格）。
 */
function measureIndentWidth(indent: string): number {
  let width = 0;
  for (const char of indent) {
    width += char === '\t' ? INDENTED_CODE_BLOCK_WIDTH : 1;
  }
  return width;
}

/**
 * 把儲存格原始文字的跳脫還原：`\|` → `|`、`\\` → `\`；其他 `\x` 原樣保留
 * （其餘反斜線跳脫屬 Markdown 行內語法層，非表格切分的職責）。
 * @param rawCellText 未還原的原始儲存格文字。
 * @returns 還原後的儲存格值。
 */
function unescapeCellText(rawCellText: string): string {
  let result = '';
  for (let i = 0; i < rawCellText.length; i += 1) {
    const char = rawCellText[i];
    const next = rawCellText[i + 1];
    if (char === '\\' && (next === '\\' || next === '|')) {
      result += next;
      i += 1;
      continue;
    }
    result += char;
  }
  return result;
}

/**
 * 把新儲存格值跳脫成可安全寫進表格列的形式：
 * - 換行一律轉 `<br>`（GFM 儲存格不可含實體換行；與直編 Shift+Enter 的慣例一致）。
 * - `\` → `\\`（防止值以反斜線結尾時，與後面的 `|` 黏成假跳脫 `\|` 破壞 round-trip）。
 * - `|` → `\|`（不當分隔符）。
 * @param newValue 要寫入的儲存格值（純文字）。
 * @returns 跳脫後可直接嵌進列的文字。
 */
function escapeCellText(newValue: string): string {
  return newValue
    .replace(/\r\n|\r|\n/g, '<br>')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

/**
 * 行內切分的完整中間結果（splitTableRowLine 與 replaceCellInLine 共用，
 * 保留每段原始空白風格供寫回時重建）。
 */
type ParsedRowLine = {
  /** 是否為合法表格列。 */
  valid: boolean;
  /** 行首前綴（縮排＋blockquote）。 */
  prefix: string;
  /** 行尾空白。 */
  suffix: string;
  /** 是否有前導 `|`。 */
  hasLeadingPipe: boolean;
  /** 是否有後導 `|`。 */
  hasTrailingPipe: boolean;
  /** 各儲存格的「原始段」（未 trim、未還原跳脫），用來保留空白風格。 */
  rawCells: string[];
};

/**
 * 把一行表格列解析成可重建的中間結構（本模組的單一事實來源）。
 * @param line 原始行（不含行尾換行字元）。
 * @returns 解析結果；valid=false 時 rawCells 為空陣列。
 */
function parseTableRowLine(line: string): ParsedRowLine {
  const prefixMatch = LINE_PREFIX_PATTERN.exec(line);
  const indent = prefixMatch ? prefixMatch[1] : '';
  const quotePart = prefixMatch ? prefixMatch[2] : '';
  const prefix = indent + quotePart;
  const invalidResult: ParsedRowLine = {
    valid: false,
    prefix,
    suffix: '',
    hasLeadingPipe: false,
    hasTrailingPipe: false,
    rawCells: [],
  };

  // 前綴不合法：縮排 ≥ 4（tab 視同 4）＝縮排程式碼區塊層級 → 該列降級為不可直編（v2-8）。
  if (measureIndentWidth(indent) >= INDENTED_CODE_BLOCK_WIDTH) return invalidResult;

  const rest = line.slice(prefix.length);
  const bodyMatch = /^(.*?)([ \t]*)$/.exec(rest);
  const body = bodyMatch ? bodyMatch[1] : rest;
  const suffix = bodyMatch ? bodyMatch[2] : '';
  if (body === '') return { ...invalidResult, suffix };

  // 逐字掃描切段：`\|`／`\\` 為跳脫對（不當分隔符），未跳脫的 `|` 才是欄位分隔。
  const segments: string[] = [];
  let currentSegment = '';
  let unescapedPipeCount = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const next = body[i + 1];
    if (char === '\\' && (next === '\\' || next === '|')) {
      currentSegment += char + next;
      i += 1;
      continue;
    }
    if (char === '|') {
      unescapedPipeCount += 1;
      segments.push(currentSegment);
      currentSegment = '';
      continue;
    }
    currentSegment += char;
  }
  segments.push(currentSegment);

  // 整行沒有任何未跳脫管線＝不是表格列。
  if (unescapedPipeCount === 0) return { ...invalidResult, suffix };

  // 前導 `|`：切段後第一段必為空字串，丟掉；後導 `|` 同理丟掉最後一段。
  const hasLeadingPipe = body.startsWith('|');
  const hasTrailingPipe = segments[segments.length - 1] === '';
  const rawCells = segments.slice(
    hasLeadingPipe ? 1 : 0,
    hasTrailingPipe ? segments.length - 1 : segments.length
  );
  if (rawCells.length === 0) return { ...invalidResult, suffix };

  return { valid: true, prefix, suffix, hasLeadingPipe, hasTrailingPipe, rawCells };
}

/**
 * 由被替換儲存格的「原始段」推導新值的前後空白 padding（保留原欄的空白風格）。
 * 原始段全空白（空儲存格）時採標準 GFM 風格：長度 ≥ 2 → 前後各一空白；
 * 長度 1 → 前一空白；零寬（`||`）→ 不補 padding。
 * @param rawSegment 被替換儲存格的原始段。
 * @returns 新值要沿用的前後 padding。
 */
function derivePadding(rawSegment: string): { leading: string; trailing: string } {
  if (rawSegment.trim() === '') {
    if (rawSegment.length >= 2) return { leading: ' ', trailing: ' ' };
    if (rawSegment.length === 1) return { leading: ' ', trailing: '' };
    return { leading: '', trailing: '' };
  }
  const leadingMatch = /^[ \t]*/.exec(rawSegment);
  const trailingMatch = /[ \t]*$/.exec(rawSegment);
  return {
    leading: leadingMatch ? leadingMatch[0] : '',
    trailing: trailingMatch ? trailingMatch[0] : '',
  };
}

// ────────────────────────── 對外 API ──────────────────────────

/**
 * 解析表頭儲存格文字的控件尾碼（`{radio:…}`／`{checkbox}`）。
 *
 * 非法情況（巢狀大括號、radio 零選項或空選項、選項含 `|`、未知關鍵字、大小寫不符、
 * 尾碼不在結尾）一律降級：control=null、原文即 displayText——這同時是
 * 「GenericAttributes 移除後 `{…}` 以字面存活」的對應行為（v2 修訂第 1 條）。
 *
 * 多重（非巢狀）大括號如 `狀態{a}{checkbox}`：只認「最後一組」為尾碼，
 * 前組留在 displayText 當字面文字（貪婪 `.*` 的自然結果，已由測試鎖住）。
 *
 * @param rawHeaderText 表頭儲存格的原始文字（通常已 trim）。
 * @returns 顯示文字與控件描述。
 */
export function parseHeaderSpec(rawHeaderText: string): ParsedHeaderSpec {
  const noControl: ParsedHeaderSpec = { displayText: rawHeaderText, control: null };

  const suffixMatch = HEADER_SUFFIX_PATTERN.exec(rawHeaderText);
  if (!suffixMatch) return noControl;

  const displayText = suffixMatch[1].trim();
  const suffixBody = suffixMatch[2].trim();

  if (suffixBody === CHECKBOX_KEYWORD) {
    return { displayText, control: { kind: 'checkbox' } };
  }

  if (suffixBody.startsWith(RADIO_KEYWORD_PREFIX)) {
    const options = suffixBody
      .slice(RADIO_KEYWORD_PREFIX.length)
      .split(',')
      .map((option) => option.trim());
    // 選項規則：至少一個、不得為空、不得含禁用字元 `|`（`,`／`{`／`}` 已由切分與正則排除）。
    const isValidOptions =
      options.length > 0 && options.every((option) => option.length > 0 && !option.includes('|'));
    if (isValidOptions) {
      return { displayText, control: { kind: 'radio', options } };
    }
  }

  return noControl;
}

/**
 * 把一行 GFM 表格列切成儲存格。
 *
 * 處理：行首 blockquote／空白前綴（照 codeBlockMeta 先例）、前後導 `|`、
 * 跳脫 `\|`（不當分隔符、值還原成 `|`）、行尾空白保留於 suffix。
 * cell 內 `<br>`、連結等行內語法原樣保留（切分不解析行內層）。
 *
 * @param line 原始行（不含行尾換行字元）。
 * @returns 前綴／儲存格值（trim＋還原跳脫）／行尾空白／是否合法；
 *          非表格列或前綴不合法（縮排 ≥ 4）時 valid=false、cells 為空陣列。
 */
export function splitTableRowLine(line: string): SplitTableRow {
  const parsed = parseTableRowLine(line);
  return {
    prefix: parsed.prefix,
    cells: parsed.rawCells.map((rawCell) => unescapeCellText(rawCell.trim())),
    suffix: parsed.suffix,
    valid: parsed.valid,
  };
}

/**
 * 替換表格列中第 cellIndex 格（0 起算）的值，保留前綴、前後導管線與各欄空白風格。
 *
 * 寫入值會自動跳脫（`|` → `\|`、`\` → `\\`、換行 → `<br>`），
 * 保證 round-trip：split → replace → join → 再 split 得回一致的值。
 *
 * @param line 原始行（不含行尾換行字元）。
 * @param cellIndex 目標儲存格索引（0 起算）。
 * @param newValue 新的儲存格值（純文字，未跳脫）。
 * @returns 替換後的整行；該行非表格列或索引越界時回 null（不丟例外）。
 */
export function replaceCellInLine(line: string, cellIndex: number, newValue: string): string | null {
  const parsed = parseTableRowLine(line);
  if (!parsed.valid) return null;
  if (cellIndex < 0 || cellIndex >= parsed.rawCells.length) return null;

  const { leading, trailing } = derivePadding(parsed.rawCells[cellIndex]);
  const newRawCells = [...parsed.rawCells];
  newRawCells[cellIndex] = leading + escapeCellText(newValue) + trailing;

  const body =
    (parsed.hasLeadingPipe ? '|' : '') +
    newRawCells.join('|') +
    (parsed.hasTrailingPipe ? '|' : '');
  return parsed.prefix + body + parsed.suffix;
}

/**
 * 從整份筆記內容取出「第 mdLine 行（1 起算，來自後端 `data-md-line`）」表格列
 * 第 cellIndex 格的原始值（已 trim、已還原 `\|` 跳脫）——直編 textarea 的初始內容。
 *
 * 與 {@link setCellValueInContent} 成對：取出的值原封不動寫回＝內容位元組不變
 * （直編開了又存、沒改字＝無變更，不產生 Revision）。
 *
 * @param contentRaw 筆記原始 Markdown 全文。
 * @param mdLine 目標列的行號（1 起算）。
 * @param cellIndex 目標儲存格索引（0 起算）。
 * @returns 儲存格原始值（空儲存格＝空字串）；行號越界、該行非表格列或索引越界時回 null
 *          （該格降級為不可直編）。
 */
export function getCellRawFromContent(
  contentRaw: string,
  mdLine: number,
  cellIndex: number
): string | null {
  const lines = contentRaw.split('\n');
  const lineIndex = mdLine - 1; // 1-based 行號 → 0-based split 索引
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const originalLine = lines[lineIndex];
  const lineWithoutCR = originalLine.endsWith('\r') ? originalLine.slice(0, -1) : originalLine;

  const split = splitTableRowLine(lineWithoutCR);
  if (!split.valid) return null;
  if (cellIndex < 0 || cellIndex >= split.cells.length) return null;
  return split.cells[cellIndex];
}

/**
 * 在整份筆記內容中，把「第 mdLine 行（1 起算，來自後端 `data-md-line`）」表格列的
 * 第 cellIndex 格改成新值。
 *
 * CRLF 處理（v2 修訂第 9 條）：以 `\n` 切行後各行可能帶尾端 `\r`——
 * 目標行剝 `\r` 處理、寫回時還原；其他行位元組完全不動（混合行尾也安全）。
 *
 * @param contentRaw 筆記原始 Markdown 全文。
 * @param mdLine 目標列的行號（1 起算；`split('\n')` 索引＝mdLine - 1）。
 * @param cellIndex 目標儲存格索引（0 起算）。
 * @param newValue 新的儲存格值（純文字，未跳脫）。
 * @returns 改寫後的全文；行號越界、該行非表格列或索引越界時回 null（不改）。
 */
export function setCellValueInContent(
  contentRaw: string,
  mdLine: number,
  cellIndex: number,
  newValue: string
): string | null {
  const lines = contentRaw.split('\n');
  const lineIndex = mdLine - 1; // 1-based 行號 → 0-based split 索引（off-by-one 由測試鎖定）
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const originalLine = lines[lineIndex];
  const hasCarriageReturn = originalLine.endsWith('\r');
  const lineWithoutCR = hasCarriageReturn ? originalLine.slice(0, -1) : originalLine;

  const replacedLine = replaceCellInLine(lineWithoutCR, cellIndex, newValue);
  if (replacedLine === null) return null;

  lines[lineIndex] = hasCarriageReturn ? `${replacedLine}\r` : replacedLine;
  return lines.join('\n');
}

/**
 * 判斷 checkbox 欄儲存格值是否為「已勾選」。
 * 值域：`[x]`＝勾（大寫 `[X]` 與前後空白容錯）；`[ ]`、空儲存格與其他文字一律未勾
 * （設計文件 §1：空儲存格視同 `[ ]`）。
 * @param cellValue 儲存格的純文字值。
 * @returns 是否已勾選。
 */
export function isCheckedValue(cellValue: string): boolean {
  return cellValue.trim().toLowerCase() === '[x]';
}

/**
 * 把勾選狀態序列化成 checkbox 欄的標準儲存格值。
 * @param isChecked 是否勾選。
 * @returns `[x]`（勾）或 `[ ]`（未勾）。
 */
export function serializeCheckedValue(isChecked: boolean): string {
  return isChecked ? '[x]' : '[ ]';
}
