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
 * @param lang 語言（可空）。
 * @param filename 檔名（可空）。
 * @returns 圍欄資訊字串（可為空字串＝無語言無檔名）。
 */
export function buildFenceInfo(lang: string, filename: string): string {
  const l = (lang || '').trim();
  const f = (filename || '').trim().replace(/\s+/g, '_'); // 檔名不含空白（資訊字串以空白斷詞）
  if (f) return `${l || 'text'}:${f}`;
  return l;
}

/** 圍欄行比對：擷取開頭的 ``` / ~~~（至少 3 個）與其後的資訊字串。 */
const FENCE_LINE = /^([`~]{3,})(.*)$/;
/** blockquote 前綴（可多層 `>`）。 */
const BLOCKQUOTE_PREFIX = /^(>\s*)+/;
/** 縮排程式碼區塊行（≥4 空白或 tab 開頭、且非全空白）。 */
const INDENTED_LINE = /^(\t| {4,})\S/;

/**
 * 重寫 Markdown 中「第 blockIndex 個」程式碼區塊的圍欄資訊字串（語言＋檔名）。
 *
 * 索引依「文件順序（0 起算）」對應：渲染端以「變更當下查 DOM 的 .code-block 順序」算出同一個索引。
 * 為了讓兩邊的「第 N 個」一致，本掃描器**必須把 react-markdown 會渲染成 `<pre>` 的所有程式碼區塊都算進去**——
 * 含 ``` / ~~~ 圍欄（可帶 blockquote `>` 前綴）與 CommonMark 的「縮排程式碼區塊」（≥4 空白，前為空行）。
 * 命中的若是「縮排區塊」（沒有圍欄可寫語言/檔名）→ 安全地原樣回傳（不誤寫別的圍欄）。
 * 關閉圍欄需同字元、且長度 ≥ 開啟長度（符合 CommonMark，避免較短的同字元被當成關閉）。
 *
 * @param markdown 原始 Markdown。
 * @param blockIndex 目標程式碼區塊的文件順序索引。
 * @param lang 新語言。
 * @param filename 新檔名。
 * @returns 重寫後的 Markdown；無對應圍欄區塊時回原文。
 */
export function setCodeFenceMeta(
  markdown: string,
  blockIndex: number,
  lang: string,
  filename: string
): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inIndented = false;
  let prevBlank = true; // 檔案開頭視同「前一行空白」，讓開頭就是縮排碼也算得到
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
      prevBlank = false;
      continue;
    }

    if (m) {
      // 開啟圍欄。
      inIndented = false;
      inFence = true;
      fenceChar = m[1][0];
      fenceLen = m[1].length;
      count += 1;
      if (count === blockIndex) {
        const indent = line.slice(0, line.length - trimmed.length);
        const quotePrefix = trimmed.slice(0, trimmed.length - afterQuote.length);
        lines[i] = `${indent}${quotePrefix}${m[1]}${buildFenceInfo(lang, filename)}`;
        return lines.join('\n');
      }
      prevBlank = false;
      continue;
    }

    // 非圍欄行：處理縮排程式碼區塊與空行。
    if (line.trim() === '') {
      prevBlank = true; // 縮排碼可含空行 → 不結束 inIndented，只記錄空行
      continue;
    }
    if (INDENTED_LINE.test(line)) {
      // 只有「前一行空白（或已在縮排碼內）」才視為縮排程式碼區塊；否則是段落續行等，不算。
      if (inIndented || prevBlank) {
        if (!inIndented) {
          inIndented = true;
          count += 1; // 縮排區塊沒有圍欄可改 → 命中時走到迴圈結尾回原文（安全 no-op）
          if (count === blockIndex) return markdown;
        }
      } else {
        inIndented = false;
      }
    } else {
      inIndented = false;
    }
    prevBlank = false;
  }
  return markdown;
}
