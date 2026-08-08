/**
 * 圍欄程式碼區塊的「內文定位與替換」純函數層。
 *
 * 對應設計文件《互動表格與讀模式直編設計》§4（程式碼區塊直編＋儲存鈕）：
 * - 圍欄起始行號來自後端 Markdig 的 `data-fence-line`（權威行號），本模組由起始行掃描
 *   對應收尾圍欄——「圍欄掃描是良定義行為」，不屬前端逐行正則近似 CommonMark 的禁區。
 * - 收尾判定＝同前綴、同圍欄字元（``` 或 ~~~）、長度 ≥ 起始圍欄（CommonMark）；
 *   內文含 ``` 字樣但「字元／長度／尾隨文字」不符 → 當一般內文；
 *   「疑似收尾」（字元、長度、無尾隨文字都符）但**前綴不一致** → 有歧義，整塊回 null
 *   降級為不可直編——絕不跳過去繼續掃（可能誤配到後面不相干圍欄、吃掉中間真實內容）。
 * - blockquote／縮排前綴照 codeBlockMeta.ts／tableSpec.ts 同一套先例（v2 修訂第 8 條）。
 * - 找不到收尾（未閉合圍欄）→ 內文到文件最後一行。
 * - CRLF：逐行剝 `\r` 分析、寫回時還原行尾風格（v2 修訂第 9 條）。
 * - 縮排「程式碼區塊」（非圍欄）無 `data-fence-line`、不可直編——呼叫端不會給行號，
 *   不在本模組職責（v2 修訂第 17 條正名）。
 */

// ────────────────────────── 型別與常數 ──────────────────────────

/**
 * locateFenceBody 的定位結果。
 */
export type FenceBodyLocation = {
  /** 內文第一行的行索引（0 起算，對 `contentRaw.split('\n')`）。 */
  bodyStart: number;
  /** 內文最後一行的行索引（0 起算、含）；空內文時 bodyEnd = bodyStart - 1（空範圍）。 */
  bodyEnd: number;
  /** 圍欄的行首前綴（縮排＋blockquote 標記），內文各行寫回時逐行補回。 */
  prefix: string;
  /** 圍欄字元：'`' 或 '~'。 */
  fenceChar: string;
  /** 起始圍欄的字元數（≥ 3）；收尾長度必須 ≥ 此值。 */
  fenceLen: number;
};

/** 圍欄行比對：開頭的 ``` / ~~~（至少 3 個）與其後的資訊字串（照 codeBlockMeta 同一套）。 */
const FENCE_LINE = /^([`~]{3,})(.*)$/;

/** 行首前綴比對：縮排（空白／tab）＋可多層的 blockquote 標記（與 tableSpec 同一套）。 */
const LINE_PREFIX_PATTERN = /^([ \t]*)((?:>[ \t]*)*)/;

/**
 * 剝掉行尾的 `\r`（CRLF 檔案以 `\n` 切行後每行會殘留）。
 * @param line 切行後的單行。
 * @returns 不含 `\r` 的行內容。
 */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

// ────────────────────────── 對外 API ──────────────────────────

/**
 * 由圍欄起始行號定位該圍欄的內文範圍。
 *
 * @param contentRaw 筆記原始 Markdown 全文。
 * @param fenceLine 圍欄起始行的行號（1 起算，來自後端 `data-fence-line`）。
 * @returns 內文行索引範圍與圍欄資訊；行號越界或該行不是圍欄起始行時回 null。
 */
export function locateFenceBody(contentRaw: string, fenceLine: number): FenceBodyLocation | null {
  const lines = contentRaw.split('\n');
  const openIndex = fenceLine - 1; // 1-based 行號 → 0-based split 索引
  if (openIndex < 0 || openIndex >= lines.length) return null;

  // 解析起始圍欄行：前綴（縮排＋blockquote）＋圍欄字元（資訊字串不影響定位）。
  const openLine = stripCarriageReturn(lines[openIndex]);
  const prefixMatch = LINE_PREFIX_PATTERN.exec(openLine);
  const prefix = prefixMatch ? prefixMatch[1] + prefixMatch[2] : '';
  const openFenceMatch = FENCE_LINE.exec(openLine.slice(prefix.length));
  if (!openFenceMatch) return null; // 該行不是圍欄起始行（後端行號與原文不符時的防呆）

  const fenceChar = openFenceMatch[1][0];
  const fenceLen = openFenceMatch[1].length;
  const bodyStart = openIndex + 1;

  // 由內文第一行往下掃描收尾圍欄：同前綴（完全一致）、同字元、長度 ≥ 起始、其後只有空白。
  //
  // 安全鐵則（對抗式復審 CRITICAL 的修正）：「疑似收尾」（同字元、長度夠、無尾隨文字）
  // 但前綴不一致的行，**不可**當一般內文跳過去繼續掃——繼續掃可能誤配到文件後面
  // 不相干圍欄，把中間的真實內容當內文改寫掉（資料遺失）。這種歧義一律回 null，
  // 整塊降級為不可直編（v2 修訂第 8 條：前綴樣式對不上 → 降級，不炸不寫壞）。
  // 代價：CommonMark 本來允許收尾縮排 0-3 格與起始不同、以及圍欄內文剛好含
  // 「別種前綴的圍欄字樣」（如示範 markdown 的程式碼區塊）——這些情況會變成不可直編
  // （安全降級，內容不受影響），文件已記載此取捨。
  let closeIndex = -1;
  for (let i = bodyStart; i < lines.length; i += 1) {
    const currentLine = stripCarriageReturn(lines[i]);
    // 用同一套規則解析「這一行自己的前綴」，再判斷是否為疑似收尾。
    const linePrefixMatch = LINE_PREFIX_PATTERN.exec(currentLine);
    const linePrefix = linePrefixMatch ? linePrefixMatch[1] + linePrefixMatch[2] : '';
    const closeFenceMatch = FENCE_LINE.exec(currentLine.slice(linePrefix.length));
    if (!closeFenceMatch) continue; // 不是圍欄樣的行 → 內文
    if (closeFenceMatch[1][0] !== fenceChar) continue; // 圍欄字元不同（``` 內的 ~~~）→ 內文
    if (closeFenceMatch[1].length < fenceLen) continue; // 長度不足（```` 內的 ```）→ 內文
    if (closeFenceMatch[2].trim() !== '') continue; // 帶尾隨文字（收尾不得有資訊字串）→ 內文
    if (linePrefix !== prefix) return null; // 疑似收尾但前綴不符 → 有歧義，整塊降級
    closeIndex = i;
    break;
  }

  // 未閉合圍欄（掃到文件末尾都沒有收尾）→ 內文到最後一行。
  const bodyEnd = closeIndex === -1 ? lines.length - 1 : closeIndex - 1;
  return { bodyStart, bodyEnd, prefix, fenceChar, fenceLen };
}

/**
 * 替換圍欄的內文行：新內文逐行補回前綴，其餘行（含起始／收尾圍欄與圍欄外內容）位元組不變。
 *
 * 行尾風格：取「起始圍欄那一行」的行尾為準（CRLF 檔案的新內文行也用 CRLF；
 * 混合行尾檔案以該區塊局部風格為準）。newBody 自帶的 CRLF 會先正規化，不外洩 `\r`。
 * newBody 為空字串＝內文清空（零行）。未閉合圍欄＝替換到文件末尾、不自行補收尾。
 *
 * @param contentRaw 筆記原始 Markdown 全文。
 * @param fenceLine 圍欄起始行的行號（1 起算，來自後端 `data-fence-line`）。
 * @param newBody 新的內文（多行以換行分隔、不含前綴；來自直編 textarea）。
 * @returns 改寫後的全文；行號越界或該行不是圍欄起始行時回 null（不改）。
 */
export function replaceFenceBody(
  contentRaw: string,
  fenceLine: number,
  newBody: string
): string | null {
  const location = locateFenceBody(contentRaw, fenceLine);
  if (!location) return null;

  const lines = contentRaw.split('\n');
  const openIndex = fenceLine - 1;
  const usesCRLF = lines[openIndex].endsWith('\r');
  const lineEnding = usesCRLF ? '\r' : ''; // join('\n') 時每行補 '\r' 即成 CRLF

  // 新內文逐行補回前綴與行尾風格；空字串＝零行（清空內文）。
  const newBodyLines =
    newBody === ''
      ? []
      : newBody
          .split(/\r\n|\r|\n/)
          .map((bodyLine) => `${location.prefix}${bodyLine}${lineEnding}`);

  const linesBeforeBody = lines.slice(0, location.bodyStart);
  const linesAfterBody = lines.slice(location.bodyEnd + 1); // 空內文時＝slice(bodyStart)，正好接收尾
  return [...linesBeforeBody, ...newBodyLines, ...linesAfterBody].join('\n');
}
