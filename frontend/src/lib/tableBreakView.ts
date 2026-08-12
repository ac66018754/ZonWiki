/**
 * 表格 `<br>` 編輯視圖層（table break view）純邏輯。
 *
 * 設計（見 docs/design/測試計畫-Enter硬換行與表格br視圖層.md A4/A5 與 v2 修訂）：
 * - 儲存格換行的「儲存格式」永遠是單行＋正規形 `<br>`（合法 GFM，跨平台互通）；
 *   「編輯顯示」把表格列內的 `<br>` 展開成換行＋對齊墊片＋續行標記「↳ 」。
 * - 核心不變式：collapseTableRowBreaks(expandTableRowBreaks(x)) === x（無損可逆）。
 *   病態內容（原文本來就有「表格列＋次行行首 ↳」等）由 safeExpandTableRowBreaks 於
 *   初始化偵測，round-trip 不成立＝整個視圖層停用（display=原文；對抗式復審 C-2）。
 * - 「真表格脈絡」（對抗式復審 H-4/M-1）：只有「連續表格列區塊的第 2 列是分隔列」的
 *   區塊才展開/收斂；散文含管線、無分隔列的偽表格、分隔列本身、圍欄程式碼內一律不動。
 * - 只認「正規形 `<br>`」（小寫、無空白斜線）：變體（`<br/>` 等）展開後收斂會被正規化
 *   而產生「沒編輯卻整篇被改」的幽靈 diff；正規形是系統自己寫入的形（escapeCellText）。
 * - CRLF：行尾帶 `\r` 的表格列不展開、`\r` 結尾的續行不收斂（對稱拒收，`\r` 不卡進行中）。
 * - 已知顯示差異（可接受）：儲存格 inline code 內的正規形 `<br>` 也會展開顯示
 *   （讀模式顯示字面）；round-trip 不受損。
 */

import { FENCE_PATTERN } from './toggleBlocks';
import { splitTableRowLine } from './tableSpec';

/** 續行標記（顯示層專用字元；收斂時整段「\n＋墊片＋↳＋一個可選空白」還原成 `<br>`）。 */
export const CONTINUATION_MARK = '↳';

/** 正規形 `<br>`（展開白名單；變體維持字面，理由見檔頭）。 */
const BR_TOKEN = '<br>';

/**
 * 續行行樣式：行首空白墊片＋↳＋至多一個空白（空白可缺＝使用者刪到一半仍可收斂）。
 * 匯出供 MarkdownEditor 的工具列 linePrefix（前綴要落在續行「內容起點」，不可插在 ↳ 前）。
 */
export const CONTINUATION_LINE_PATTERN = /^( *)↳ ?/;

/** GFM 分隔列儲存格樣式（`---`／`:--`／`--:`／`:-:`）。 */
const DELIMITER_CELL_PATTERN = /^:?-+:?$/;

/** 一行的分類。 */
type LineKind = 'row' | 'cont' | 'other';

/** 逐行分析結果。 */
interface AnalyzedLine {
  /** 行首絕對位置。 */
  start: number;
  /** 行文字（含行尾 `\r`、不含 `\n`）。 */
  text: string;
  /** 分類：表格列／續行候選／其他。 */
  kind: LineKind;
  /** 是否位於圍欄程式碼內（圍欄行本身視為 other 且不屬圍欄內）。 */
  inFence: boolean;
  /** kind==='row'|'cont' 時：所屬「連續表格區塊」是否為真表格（第 2 列是分隔列）。 */
  inRealBlock: boolean;
  /** kind==='row' 時：是否為分隔列。 */
  isDelimiter: boolean;
  /** kind==='cont' 時：所附掛的表格列（同區塊往上最近的 row）之行索引；找不到＝-1。 */
  attachedRowIndex: number;
}

/** 去掉行尾 `\r` 的檢視（分類判定用；原文字串不動）。 */
function stripCr(text: string): string {
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

/** 是否為 GFM 分隔列（cells 全部符合 `---` 樣式）。 */
function isDelimiterRow(lineWithoutCr: string): boolean {
  const split = splitTableRowLine(lineWithoutCr);
  if (!split.valid || split.cells.length === 0) return false;
  return split.cells.every((cell) => DELIMITER_CELL_PATTERN.test(cell));
}

/** analyzeLines 的單槽快取（同一次按鍵中手勢/插入/背景層會對同一份文字掃 2-3 次）。 */
let analyzeCacheText: string | null = null;
/** analyzeLines 的單槽快取結果（消費端一律唯讀，共用安全）。 */
let analyzeCacheResult: AnalyzedLine[] = [];

/**
 * 逐行分析：圍欄狀態、表格列／續行分類、連續區塊的「真表格」判定。
 * 展開、收斂、Shift+Enter 插入、join 區掃描共用（單一事實來源，確保對稱）。
 * 帶單槽快取：同一份文字重複呼叫只掃一次（對抗式復審 MEDIUM-2 的每鍵多次 O(n) 重掃）。
 *
 * @param text 完整文字或顯示文字（兩者語法相同，續行只出現在顯示文字）。
 * @returns 帶分類與區塊資訊的行陣列（唯讀共用，呼叫端不可變異）。
 */
function analyzeLines(text: string): AnalyzedLine[] {
  if (text === analyzeCacheText) return analyzeCacheResult;
  const result = analyzeLinesUncached(text);
  analyzeCacheText = text;
  analyzeCacheResult = result;
  return result;
}

/** analyzeLines 的實際計算（無快取版）。 */
function analyzeLinesUncached(text: string): AnalyzedLine[] {
  const lines: AnalyzedLine[] = [];
  let start = 0;
  let inFence = false;
  let fenceChar = '';

  const rawLines = text.split('\n');
  for (const raw of rawLines) {
    const noCr = stripCr(raw);
    const trimmed = noCr.trimStart();

    let kind: LineKind = 'other';
    let lineInFence = inFence;

    // 圍欄行：優先於任何分類（與 editorFolding.listToggleBlocks 同語意），圍欄內不解析。
    const fenceMatch = trimmed.match(FENCE_PATTERN);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
      } else if (trimmed.startsWith(fenceChar.repeat(3))) {
        inFence = false;
      }
      lineInFence = false; // 圍欄行本身不屬圍欄內（也不是列/續行）
    } else if (!inFence) {
      // 續行候選優先於表格列（`↳ b |` 含管線也會被 splitTableRowLine 判 valid，
      // 但它的語意是「上一列的延續」；孤兒情境由 attachedRowIndex/inRealBlock 擋下）。
      if (CONTINUATION_LINE_PATTERN.test(noCr)) {
        kind = 'cont';
      } else if (splitTableRowLine(noCr).valid) {
        kind = 'row';
      }
    }

    lines.push({
      start,
      text: raw,
      kind,
      inFence: lineInFence,
      inRealBlock: false,
      isDelimiter: kind === 'row' && isDelimiterRow(noCr),
      attachedRowIndex: -1,
    });
    start += raw.length + 1; // +1 = '\n'
  }

  // 區塊掃描：連續的 row/cont 行構成一個區塊（cont 必須緊跟 row 或 cont，否則是孤兒）。
  let blockStart = -1; // 目前區塊第一行索引；-1＝不在區塊中
  const closeBlock = (endExclusive: number): void => {
    if (blockStart < 0) return;
    // 區塊的「列」＝其中 kind==='row' 的行；真表格＝至少兩列且第 2 列是分隔列。
    const rowIndexes: number[] = [];
    for (let i = blockStart; i < endExclusive; i += 1) {
      if (lines[i].kind === 'row') rowIndexes.push(i);
    }
    const isReal = rowIndexes.length >= 2 && lines[rowIndexes[1]].isDelimiter;
    for (let i = blockStart; i < endExclusive; i += 1) {
      lines[i].inRealBlock = isReal;
      if (lines[i].kind === 'cont') {
        // 附掛列＝區塊內往上最近的 row（中間可隔其他 cont）。
        let j = i - 1;
        while (j >= blockStart && lines[j].kind === 'cont') j -= 1;
        lines[i].attachedRowIndex = j >= blockStart && lines[j].kind === 'row' ? j : -1;
      }
    }
    blockStart = -1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.kind === 'row') {
      if (blockStart < 0) blockStart = i;
    } else if (line.kind === 'cont') {
      // 續行必須緊跟區塊（前一行是 row/cont）；孤兒續行不開新區塊、也切斷既有區塊。
      if (blockStart < 0 || (lines[i - 1].kind !== 'row' && lines[i - 1].kind !== 'cont')) {
        closeBlock(i);
      }
      // 孤兒（blockStart<0）維持 -1／false，於 closeBlock 之外不標記。
    } else {
      closeBlock(i);
    }
  }
  closeBlock(lines.length);

  return lines;
}

/** 視覺寬 heuristic：code point ≤ 0xFF 算 1 欄、其餘（CJK/全形等）算 2 欄（盡力對齊）。 */
function visualWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) <= 0xff ? 1 : 2;
  }
  return width;
}

/**
 * 每一行是否屬於「真表格區塊」（表格列或其續行、非圍欄內）——供編輯器的
 * 「表格管線標示背景層」決定哪些行的 `|` 要畫色塊（視覺輔助，不改內容）。
 * @param text 顯示文字。
 * @returns 與 `text.split('\n')` 等長的布林陣列。
 */
export function listTableLineFlags(text: string): boolean[] {
  return analyzeLines(text).map(
    (line) => (line.kind === 'row' || line.kind === 'cont') && line.inRealBlock && !line.inFence,
  );
}

/**
 * 掃描一行的「未跳脫管線」位置（`\\`／`\|` 為跳脫對，不當分隔符）。
 * 匯出供編輯器背景層標示表格 `|`（跳脫管線是內容、不標）。
 * @param lineWithoutCr 不含 `\r` 的行文字。
 * @returns 由左至右的管線字元索引。
 */
export function unescapedPipePositions(lineWithoutCr: string): number[] {
  const prefix = splitTableRowLine(lineWithoutCr).prefix;
  const positions: number[] = [];
  for (let i = prefix.length; i < lineWithoutCr.length; i += 1) {
    const ch = lineWithoutCr[i];
    const next = lineWithoutCr[i + 1];
    if (ch === '\\' && (next === '\\' || next === '|')) {
      i += 1;
      continue;
    }
    if (ch === '|') positions.push(i);
  }
  return positions;
}

/**
 * 算出「在實體行 physLine 的 brCol 處斷行」時，續行要用的墊片（前導空白）。
 * 對齊目標＝該 `<br>` 所在儲存格的內容起始欄；「↳＋空白」約佔 2 欄，故空白數＝欄寬−2。
 *
 * @param physLine 目前實體行（斷行點之前的完整行文字）。
 * @param brCol 斷行點在實體行內的欄位（字元索引）。
 * @returns 墊片空白字串。
 */
function continuationPadFor(physLine: string, brCol: number): string {
  const contMatch = physLine.match(CONTINUATION_LINE_PATTERN);
  const pipes = unescapedPipePositions(physLine).filter((p) => p < brCol);

  // 續行上再斷、且斷點前沒有新的儲存格（無管線）＝同格再斷 → 沿用同一墊片對齊；
  // 續行上有管線＝已進入新儲存格 → 按該儲存格重新計算（走下方 lastPipe 分支）。
  if (contMatch && pipes.length === 0) return contMatch[1];

  let contentStart: number;
  if (pipes.length === 0) {
    // 無前導管線的第一格：對齊行首內容。
    contentStart = physLine.length - physLine.trimStart().length;
  } else {
    const lastPipe = pipes[pipes.length - 1];
    let i = lastPipe + 1;
    while (i < brCol && (physLine[i] === ' ' || physLine[i] === '\t')) i += 1;
    // 格內在斷行點前全是空白（如 `| <br>a |`）→ 用慣例「管線＋一空白」當內容起點。
    contentStart = i < brCol ? i : Math.min(lastPipe + 2, brCol);
  }
  return ' '.repeat(Math.max(0, visualWidth(physLine.slice(0, contentStart)) - 2));
}

/**
 * 把「完整文字」的表格列內正規形 `<br>` 展開成「換行＋墊片＋↳ 」的顯示文字。
 * 只處理真表格區塊內、非分隔列、行尾無 `\r` 的列；其餘一律原樣。
 *
 * @param full 完整文字（DB 儲存形）。
 * @returns 顯示文字。
 */
export function expandTableRowBreaks(full: string): string {
  if (!full.includes(BR_TOKEN)) return full;
  const lines = analyzeLines(full);

  const out: string[] = [];
  for (const line of lines) {
    const expandable =
      line.kind === 'row' &&
      line.inRealBlock &&
      !line.isDelimiter &&
      !line.inFence &&
      !line.text.endsWith('\r') &&
      line.text.includes(BR_TOKEN);
    if (!expandable) {
      out.push(line.text);
      continue;
    }

    // 由左至右重建：遇到 <br> 就斷行，墊片以「目前實體行」計算（同格第二個 <br>
    // 會落在續行上 → continuationPadFor 沿用續行墊片，與上一條續行對齊）。
    let phys = '';
    let rest = line.text;
    let firstSegment = true;
    for (;;) {
      const idx = rest.indexOf(BR_TOKEN);
      if (idx < 0) {
        out.push(phys + rest);
        break;
      }
      const candidate = phys + rest.slice(0, idx);
      rest = rest.slice(idx + BR_TOKEN.length);
      // 斷行守門（round-trip 保障）：斷點前的實體行必須仍可被收斂側正確分類——
      // 首段必須「仍是合法表格列」且「不長得像分隔列」（如 `| <br>a |` 的首段 `| `
      // 不是合法列、`| ---<br>x |` 的首段像分隔列，收斂側會拒絕附掛/拒絕 join，
      // round-trip 就壞了）；不符合＝這個 <br> 維持字面、繼續找下一個。
      // 續段（pad＋↳ 開頭）天然是續行分類，永遠可斷。
      const attachable =
        !firstSegment || (splitTableRowLine(candidate).valid && !isDelimiterRow(candidate));
      if (!attachable) {
        phys = candidate + BR_TOKEN;
        continue;
      }
      out.push(candidate);
      const pad = continuationPadFor(candidate, candidate.length);
      phys = `${pad}${CONTINUATION_MARK} `;
      firstSegment = false;
    }
  }
  return out.join('\n');
}

/**
 * 把顯示文字的續行（`\n＋墊片＋↳＋至多一個空白`）收斂回正規形 `<br>`（完整文字）。
 * 收斂條件與展開側完全對稱：真表格區塊內、附掛列存在且非分隔列、附掛列與續行皆無 `\r`。
 * 不符合者（孤兒 ↳ 行、圍欄內、無分隔列脈絡…）維持字面，不吃使用者內容。
 *
 * @param display 顯示文字。
 * @returns 完整文字（DB 儲存形）。
 */
export function collapseTableRowBreaks(display: string): string {
  if (!display.includes(CONTINUATION_MARK)) return display;
  const lines = analyzeLines(display);

  const out: string[] = [];
  for (const line of lines) {
    if (joinableInto(lines, line) && out.length > 0) {
      const content = stripCr(line.text).replace(CONTINUATION_LINE_PATTERN, '');
      out[out.length - 1] += BR_TOKEN + content;
    } else {
      out.push(line.text);
    }
  }
  return out.join('\n');
}

/**
 * 判斷一條續行候選是否可收斂（join）。
 * @param lines analyzeLines 的結果。
 * @param line 目標行。
 * @returns 可收斂＝true。
 */
function joinableInto(lines: AnalyzedLine[], line: AnalyzedLine): boolean {
  if (line.kind !== 'cont' || !line.inRealBlock || line.inFence) return false;
  if (line.text.endsWith('\r')) return false; // CRLF 對稱拒收（\r 不卡進行中）
  if (line.attachedRowIndex < 0) return false; // 孤兒
  const row = lines[line.attachedRowIndex];
  // 不 join 進分隔列（使用者刪掉資料列遺留的續行：寧可字面外漏、不可毀掉分隔列）；
  // 附掛列行尾帶 \r 亦拒收（展開側跳過 \r 列，對稱）。
  if (row.isDelimiter || row.text.endsWith('\r')) return false;
  return true;
}

/**
 * 安全展開：展開後驗證無損可逆；round-trip 不成立（病態內容）＝停用視圖層。
 * 呼叫端（MarkdownEditor）於停用時不得再做 collapse／Shift+Enter 攔截／複製轉換
 * （對抗式復審 C-2：安全網必須涵蓋整個編輯生命週期，不只初始化）。
 *
 * @param full 完整文字。
 * @returns display＝顯示文字（停用時＝原文）；enabled＝視圖層是否啟用。
 */
export function safeExpandTableRowBreaks(full: string): { display: string; enabled: boolean } {
  const display = expandTableRowBreaks(full);
  if (collapseTableRowBreaks(display) === full) {
    return { display, enabled: true };
  }
  return { display: full, enabled: false };
}

/** 顯示文字中一個「join 區」：`[start, contentStart)`＝換行＋墊片＋↳＋可選空白（收斂成 `<br>`）。 */
export interface JoinRegion {
  /** 區起點＝續行前的 `\n` 位置。 */
  start: number;
  /** 續行「內容」起點（標記與可選空白之後）＝區終點（exclusive）。 */
  contentStart: number;
}

/**
 * 列出顯示文字中所有「可收斂」的 join 區（依位置排序）。
 * 供編輯器手勢（Backspace/Delete 原子刪除、打字貼齊）與座標映射使用。
 *
 * @param display 顯示文字。
 * @returns join 區清單。
 */
export function listJoinRegions(display: string): JoinRegion[] {
  if (!display.includes(CONTINUATION_MARK)) return [];
  const lines = analyzeLines(display);
  const regions: JoinRegion[] = [];
  for (const line of lines) {
    if (!joinableInto(lines, line) || line.start === 0) continue;
    const match = stripCr(line.text).match(CONTINUATION_LINE_PATTERN);
    if (!match) continue;
    regions.push({ start: line.start - 1, contentStart: line.start + match[0].length });
  }
  return regions;
}

/**
 * 把「顯示文字」座標範圍映射到「收斂後完整文字」座標（join 區長度 ↔ `<br>` 4 字元）。
 * 端點落在 join 區內＝貼齊區起點（`<br>` 之前），不回 null——供局部排版／複製切片。
 *
 * 注意：此函式只處理表格 join 這一層；與摺疊徽章併用時，呼叫端必須「先」過
 * 徽章映射（display → 徽章展開形）「再」呼叫本函式（對抗式復審 C-1 的正確順序）。
 *
 * @param display 顯示文字（徽章已展開形）。
 * @param start 選取起點（display 座標）。
 * @param end 選取終點（display 座標）。
 * @returns 收斂後座標範圍。
 */
export function mapExpandedRangeToCollapsed(
  display: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const regions = listJoinRegions(display);
  const mapPoint = (pos: number): number => {
    let p = pos;
    let shift = 0;
    for (const region of regions) {
      if (p > region.start && p < region.contentStart) {
        p = region.start; // 貼齊 join 起點（<br> 之前）
        break;
      }
      if (region.contentStart <= p) {
        // join 區（長度 contentStart-start）在收斂後變成 4 字元的 <br>。
        shift += region.contentStart - region.start - BR_TOKEN.length;
      }
    }
    return p - shift;
  };
  return { start: mapPoint(start), end: mapPoint(end) };
}

/**
 * Shift+Enter 的插入內容：游標處可斷行時回傳「\n＋墊片＋↳ 」，否則 null（放行預設換行）。
 *
 * 可斷行＝游標位於真表格區塊的「資料/表頭列」儲存格內容範圍內，或續行上；
 * 分隔列、圍欄內、散文含管線（無分隔列脈絡）、行尾 `\r`、列首（第一格內容之前）、
 * 尾導管線之後（`<br>` 落在儲存格外會改變欄數）一律 null。
 *
 * @param display 顯示文字。
 * @param pos 游標位置（display 座標）。
 * @returns 插入字串或 null。
 */
export function continuationInsertFor(display: string, pos: number): string | null {
  const lines = analyzeLines(display);
  // 找游標所在行（start ≤ pos ≤ start+len；行尾位置歸本行）。
  let target: AnalyzedLine | null = null;
  for (const line of lines) {
    if (pos >= line.start && pos <= line.start + line.text.length) {
      target = line;
      break;
    }
  }
  if (!target || target.inFence || !target.inRealBlock) return null;
  if (target.text.endsWith('\r')) return null;

  if (target.kind === 'cont') {
    if (!joinableInto(lines, target)) return null;
    const match = target.text.match(CONTINUATION_LINE_PATTERN);
    return match ? `\n${match[1]}${CONTINUATION_MARK} ` : null;
  }
  if (target.kind !== 'row' || target.isDelimiter) return null;

  const line = target.text;
  const col = pos - target.start;
  const pipes = unescapedPipePositions(line);
  if (pipes.length === 0) return null;
  const pipesBefore = pipes.filter((p) => p < col);
  if (pipesBefore.length === 0) return null; // 列首／第一個管線之前 → 不可斷
  const lastPipe = pipesBefore[pipesBefore.length - 1];
  const { hasTrailingPipe } = trailingPipeInfo(line, pipes);
  if (hasTrailingPipe && lastPipe === pipes[pipes.length - 1]) {
    return null; // 游標在尾導管線之後 → <br> 會落在儲存格外
  }
  // 儲存格內容起點之前（如 `| ` 與內容之間）不可斷——與 continuationPadFor 的內容起點一致。
  let contentStart = lastPipe + 1;
  while (contentStart < line.length && (line[contentStart] === ' ' || line[contentStart] === '\t')) {
    contentStart += 1;
  }
  if (col < Math.min(contentStart, line.length)) return null;

  const pad = continuationPadFor(line.slice(0, col), col);
  return `\n${pad}${CONTINUATION_MARK} `;
}

/**
 * 尾導管線判定（與 parseTableRowLine 的語意一致：行尾空白之前的最後字元是未跳脫 `|`）。
 * @param lineWithoutCr 行文字。
 * @param pipes 未跳脫管線位置。
 * @returns 是否有尾導管線。
 */
function trailingPipeInfo(lineWithoutCr: string, pipes: number[]): { hasTrailingPipe: boolean } {
  if (pipes.length === 0) return { hasTrailingPipe: false };
  const lastPipe = pipes[pipes.length - 1];
  return { hasTrailingPipe: lineWithoutCr.slice(lastPipe + 1).trim() === '' };
}
