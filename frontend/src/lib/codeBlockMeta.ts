/**
 * 程式碼區塊的「語言＋檔名」中繼資料工具。
 *
 * 慣例：圍欄資訊字串寫成 `lang` 或 `lang:filename`（例：```js 或 ```js:app.js）。
 * 因為 react-markdown（remark）與後端 Markdig 都取「資訊字串的第一個詞」當語言 class，
 * 而 `js:app.js` 中間沒有空白 → 兩邊都會渲染成 `class="language-js:app.js"`，
 * 前端再統一由 class 解析出 lang 與 filename，達成「編輯預覽」與「閱讀檢視」一致。
 */

/** 語言下拉可選清單（涵蓋常用；text＝純文字不上色）。 */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'text', label: '純文字' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'tsx', label: 'TSX' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'python', label: 'Python' },
  { value: 'csharp', label: 'C#' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Shell / Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'diff', label: 'Diff' },
];

/** 語言別名 → 下拉可選值（例：js→javascript、cs/c#→csharp），供下拉正確反映既有圍欄語言。 */
const DROPDOWN_ALIAS: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
  cs: 'csharp', 'c#': 'csharp', 'c++': 'cpp', sh: 'bash', shell: 'bash',
  zsh: 'bash', yml: 'yaml', ps1: 'powershell', ps: 'powershell', htm: 'html', md: 'markdown',
};

/**
 * 把語言正規化成「語言下拉的可選值」；未知語言回 'text'（純文字）。
 * 讓 ```js 這種既有圍欄在下拉正確顯示為 JavaScript（而非落到純文字）。
 * @param lang 原始語言字串。
 */
export function canonicalLangValue(lang: string): string {
  const l = (lang || '').trim().toLowerCase();
  const mapped = DROPDOWN_ALIAS[l] ?? l;
  return CODE_LANGUAGES.some((x) => x.value === mapped) ? mapped : 'text';
}

/**
 * 從 `<code>` 的 className（如 `language-js:app.js`）解析出語言與檔名。
 * @param className react-markdown/Markdig 產生的 class 字串（可能為 undefined）。
 * @returns { lang, filename }；沒有語言時 lang＝''。
 */
export function parseCodeMeta(className?: string | null): { lang: string; filename: string } {
  const match = /language-([^\s"']+)/.exec(className || '');
  if (!match) return { lang: '', filename: '' };
  const token = match[1];
  const colon = token.indexOf(':');
  if (colon >= 0) {
    return { lang: token.slice(0, colon), filename: token.slice(colon + 1) };
  }
  return { lang: token, filename: '' };
}

/**
 * 由語言＋檔名組出圍欄資訊字串（`lang` 或 `lang:filename`）。
 * 有檔名一定要有語言佔位（避免 `:filename` 解析歧義）——語言空時補 text。
 *
 * 安全：資訊字串以空白斷詞、且**反引號會提早關閉 ``` 圍欄**（CommonMark 規定反引號圍欄的資訊
 * 字串不得含反引號，否則該區塊不再是程式碼區塊、還會吃掉後續內容）。故語言與檔名一律剝除
 * 反引號與換行；檔名再把空白換成底線。
 *
 * @param lang 語言（可空）。
 * @param filename 檔名（可空）。
 * @returns 圍欄資訊字串（可為空字串＝無語言無檔名）。
 */
export function buildFenceInfo(lang: string, filename: string): string {
  const clean = (value: string) => (value || '').trim().replace(/[`\r\n]/g, '');
  const l = clean(lang);
  const f = clean(filename).replace(/\s+/g, '_'); // 檔名不含空白（資訊字串以空白斷詞）
  if (f) return `${l || 'text'}:${f}`;
  return l;
}

/** 圍欄行比對：擷取開頭的 ``` / ~~~（至少 3 個）與其後的資訊字串。 */
const FENCE_LINE = /^([`~]{3,})(.*)$/;
/** blockquote 前綴（可多層 `>`）。 */
const BLOCKQUOTE_PREFIX = /^(>\s*)+/;

/**
 * 逐行掃描出所有「圍欄程式碼區塊」的開啟行號（1 起算），依文件順序。
 *
 * 只認 ``` / ~~~ 圍欄（可帶 blockquote `>` 前綴），**完全忽略 CommonMark 縮排程式碼區塊與其他
 * 縮排內容**——這正是「圍欄索引」的唯一定義。三處據此對齊：後端 Markdig 標在 &lt;code&gt; 上的
 * data-fence-index（只數 FencedCodeBlock）、本檔 setCodeFenceMeta、以及編輯預覽用 mdast code
 * 節點的來源行號（position.start.line）。關閉圍欄需同字元、長度 ≥ 開啟長度、其後只有空白。
 *
 * @param markdown 原始 Markdown。
 * @returns 各圍欄開啟行的行號（1 起算）陣列，長度＝圍欄區塊數。
 */
export function scanFenceStartLines(markdown: string): number[] {
  const lines = markdown.split('\n');
  const starts: number[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const afterQuote = lines[i].trimStart().replace(BLOCKQUOTE_PREFIX, '');
    const m = FENCE_LINE.exec(afterQuote);
    if (inFence) {
      if (m && m[1][0] === fenceChar && m[1].length >= fenceLen && m[2].trim() === '') inFence = false;
      continue;
    }
    if (m) {
      inFence = true;
      fenceChar = m[1][0];
      fenceLen = m[1].length;
      starts.push(i + 1); // 行號 1 起算，對齊 mdast position.start.line
    }
  }
  return starts;
}

/**
 * 重寫 Markdown 中「第 fenceIndex 個圍欄程式碼區塊」的資訊字串（語言＋檔名）。
 *
 * 索引語意＝「圍欄索引」：只數 ``` / ~~~ 圍欄（可帶 blockquote `>` 前綴），**跳過縮排程式碼區塊**，
 * 與 <see cref="scanFenceStartLines"/>、後端 data-fence-index、編輯預覽的來源行號一致。
 * 這是取代舊「數所有 &lt;pre&gt;（含縮排碼）」的修正——舊法用手寫正則判斷縮排碼、與 CommonMark
 * 不一致（例如把清單項下縮排 4 空白的續行段落誤判成區塊），會導致改到別的區塊、造成跨區塊資料損毀。
 * 關閉圍欄需同字元、且長度 ≥ 開啟長度（符合 CommonMark）。
 *
 * @param markdown 原始 Markdown。
 * @param fenceIndex 目標圍欄的文件順序索引（0 起算，只數圍欄碼）。
 * @param lang 新語言。
 * @param filename 新檔名。
 * @returns 重寫後的 Markdown；索引無對應圍欄時回原文。
 */
export function setCodeFenceMeta(
  markdown: string,
  fenceIndex: number,
  lang: string,
  filename: string
): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let count = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // 允許 blockquote 內的圍欄：先剝掉開頭的 `>`（保留前綴以便原樣寫回）。
    const afterQuote = trimmed.replace(BLOCKQUOTE_PREFIX, '');
    const m = FENCE_LINE.exec(afterQuote);

    if (inFence) {
      // 關閉圍欄＝同字元、長度 ≥ 開啟、其後只有空白。
      if (m && m[1][0] === fenceChar && m[1].length >= fenceLen && m[2].trim() === '') inFence = false;
      continue;
    }

    if (m) {
      // 開啟圍欄（縮排程式碼區塊與其他縮排內容一律不進此分支、不影響計數）。
      inFence = true;
      fenceChar = m[1][0];
      fenceLen = m[1].length;
      count += 1;
      if (count === fenceIndex) {
        const indent = line.slice(0, line.length - trimmed.length);
        const quotePrefix = trimmed.slice(0, trimmed.length - afterQuote.length);
        lines[i] = `${indent}${quotePrefix}${m[1]}${buildFenceInfo(lang, filename)}`;
        return lines.join('\n');
      }
    }
  }
  return markdown;
}

/**
 * 改寫 Markdown「第 line 行（1 起算）」的圍欄資訊字串（語言＋檔名）。
 *
 * 行號由後端 Markdig（依循 CommonMark、知道每個圍欄確切位置）標的 data-fence-line 給定，據此
 * 直接定位改寫那一行——不靠前端逐行重數圍欄。因為逐行正則拿不到 CommonMark 的容器縮排基準：
 * 頂層縮排 ≥4 空白的字面 ``` 是縮排碼（非圍欄），但清單／引用內縮排 ≥4 的 ``` 卻是合法圍欄，
 * 兩者絕對縮排相同、無法用逐行正則區分，會與後端計數分歧而改到別的區塊（跨區塊資料損毀）。
 * 若該行不是圍欄開啟行（後端行號與原文不符時的防呆）則原樣回傳。
 *
 * @param markdown 原始 Markdown。
 * @param line 目標圍欄開啟行的行號（1 起算）。
 * @param lang 新語言。
 * @param filename 新檔名。
 * @returns 重寫後的 Markdown；行號超界或該行非圍欄開啟行時回原文。
 */
export function setFenceMetaAtLine(
  markdown: string,
  line: number,
  lang: string,
  filename: string
): string {
  const lines = markdown.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return markdown;
  const raw = lines[index];
  const trimmed = raw.trimStart();
  const afterQuote = trimmed.replace(BLOCKQUOTE_PREFIX, '');
  const m = FENCE_LINE.exec(afterQuote);
  if (!m) return markdown;
  const indent = raw.slice(0, raw.length - trimmed.length);
  const quotePrefix = trimmed.slice(0, trimmed.length - afterQuote.length);
  lines[index] = `${indent}${quotePrefix}${m[1]}${buildFenceInfo(lang, filename)}`;
  return lines.join('\n');
}
