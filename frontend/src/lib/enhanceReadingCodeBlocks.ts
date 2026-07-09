/**
 * 閱讀檢視（後端 Markdig 產生的 HTML）的程式碼區塊「就地美化」：
 * 把 `<pre><code class="language-xxx">…</code></pre>` 轉成與編輯器預覽一致的 `.code-block`
 * 外觀——VS Code Dark+ 語法上色 ＋ 標題列（左檔名、右語言、複製鈕）。閱讀檢視為唯讀，
 * 故檔名/語言僅顯示、不可編輯（要改請進編輯器）。
 *
 * 以純 DOM 操作進行（閱讀內文走 dangerouslySetInnerHTML，本就不由 React reconcile）：
 * 每次 previewHtml 變動、React 重新注入後再呼叫一次即可（見 notes 頁 useEffect）。
 * 以 data 屬性標記避免同一份 HTML 內重複包裝。
 */
import { parseCodeMeta } from './codeBlockMeta';
import { highlightCode } from './highlightCode';

/**
 * 美化容器內所有尚未處理的程式碼區塊。
 * @param container 閱讀內文的容器（.markdown-prose）；null 時不動作。
 */
export function enhanceReadingCodeBlocks(container: HTMLElement | null): void {
  if (!container) return;

  const pres = Array.from(container.querySelectorAll('pre'));
  for (const pre of pres) {
    // 已被包進 .code-block（本函式先前處理過）→ 跳過，避免重複包裝。
    if (pre.closest('.code-block')) continue;
    const code = pre.querySelector('code');
    if (!code) continue;

    const { lang, filename } = parseCodeMeta(code.className);
    const text = code.textContent ?? '';

    // 若此程式碼區塊內含畫記/備註/連結（NoteMarksLayer 的 [data-anno] 包裝）→ 不動內文（不 innerHTML 上色），
    // 否則會把剛套上的畫記清掉（畫記優先於上色）。仍照常包 .code-block＋標題列（搬移 <pre> 不會破壞其子節點）。
    if (!code.querySelector('[data-anno]')) {
      // 上色（highlightCode 已對純文字/未知語言做安全轉義）。
      code.innerHTML = highlightCode(text, lang);
      code.classList.add('hljs');
    }
    pre.classList.add('code-block-pre');

    // 包一層 .code-block，並在最前面插入標題列。
    const wrap = document.createElement('div');
    wrap.className = 'code-block';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const fnSpan = document.createElement('span');
    fnSpan.className = 'code-block-filename-ro' + (filename ? '' : ' code-block-muted');
    fnSpan.textContent = filename || '程式碼';

    const right = document.createElement('div');
    right.className = 'code-block-header-right';

    const langSpan = document.createElement('span');
    langSpan.className = 'code-block-lang-ro';
    langSpan.textContent = lang || 'text';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = '複製';
    copyBtn.addEventListener('click', () => {
      try {
        navigator.clipboard?.writeText(text);
      } catch {
        /* 忽略 */
      }
      copyBtn.textContent = '已複製';
      copyBtn.classList.add('copied');
      window.setTimeout(() => {
        copyBtn.textContent = '複製';
        copyBtn.classList.remove('copied');
      }, 1500);
    });

    right.appendChild(langSpan);
    right.appendChild(copyBtn);
    header.appendChild(fnSpan);
    header.appendChild(right);

    // 以 wrap 取代 pre 的位置，再把 header 與 pre 收進 wrap。
    pre.parentNode?.insertBefore(wrap, pre);
    wrap.appendChild(header);
    wrap.appendChild(pre);
  }
}
