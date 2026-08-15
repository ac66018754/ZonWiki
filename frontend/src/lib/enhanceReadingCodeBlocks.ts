/**
 * 閱讀檢視（後端 Markdig 產生的 HTML）的程式碼區塊「就地美化」：
 * 把 `<pre><code class="language-xxx">…</code></pre>` 轉成與編輯器預覽一致的 `.code-block`
 * 外觀——VS Code Dark+ 語法上色 ＋ 標題列（左檔名、右語言、複製鈕）。
 *
 * 檔名／語言的可編輯性：
 * - 傳入 onMetaChange（查看模式）→ 檔名為可填輸入框（失焦寫回）、語言為下拉（變更即寫回），
 *   由上層算出「這是第幾個程式碼區塊」後改寫 Markdown 圍欄並即時存 DB，不必進編輯模式。
 * - 未傳 onMetaChange（如彈出預覽等唯讀情境）→ 檔名／語言為唯讀顯示。
 *
 * 以純 DOM 操作進行（閱讀內文走 dangerouslySetInnerHTML，本就不由 React reconcile）：
 * 每次 previewHtml 變動、React 重新注入後再呼叫一次即可（見 notes 頁 useEffect）。
 * 以 data 屬性標記避免同一份 HTML 內重複包裝。
 */
import { parseCodeMeta, canonicalLangValue, CODE_LANGUAGES } from './codeBlockMeta';
import { highlightCode } from './highlightCode';
import { createDoubleRightClickTracker } from './doubleRightClick';

/**
 * 美化容器內所有尚未處理的程式碼區塊。
 * @param container 閱讀內文的容器（.markdown-prose）；null 時不動作。
 * @param onMetaChange 可選；提供時「圍欄程式碼區塊」的檔名／語言變成可就地編輯，變更時以
 *   （圍欄來源行號 data-fence-line、新語言、新檔名）回呼。縮排程式碼區塊無此行號 → 維持唯讀。
 * @param onBodyEdit 可選；提供時「圍欄程式碼區塊」可雙右鍵進入內文直編（textarea 取代顯示、
 *   標題列 💾 儲存鈕啟用），儲存時以（圍欄來源行號、新內文）回呼並回傳是否成功——
 *   成功後上層以最新筆記重注入整段 HTML；失敗保留編輯內容。縮排程式碼區塊不可直編。
 */
export function enhanceReadingCodeBlocks(
  container: HTMLElement | null,
  onMetaChange?: (fenceLine: number, lang: string, filename: string) => void,
  onBodyEdit?: (fenceLine: number, newBody: string) => Promise<boolean>,
): void {
  if (!container) return;

  const pres = Array.from(container.querySelectorAll('pre'));
  for (const pre of pres) {
    // 已被包進 .code-block（本函式先前處理過）→ 跳過，避免重複包裝。
    if (pre.closest('.code-block')) continue;
    const code = pre.querySelector('code');
    if (!code) continue;

    const { lang, filename } = parseCodeMeta(code.className);
    const text = code.textContent ?? '';
    // 圍欄來源行號（後端 Markdig 只給圍欄程式碼區塊標的 data-fence-line，1 起算）：有它才可就地編輯、
    // 並據此直接定位改寫原文那一行圍欄；縮排程式碼區塊沒有此屬性 → 維持唯讀（本來就無圍欄可寫語言/檔名）。
    const fenceLineAttr = code.getAttribute('data-fence-line');
    const fenceLine = fenceLineAttr === null ? null : Number(fenceLineAttr);
    const canEditMeta = fenceLine !== null && Number.isInteger(fenceLine);

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

    // 檔名／語言：查看模式（有 onMetaChange）＝可就地編輯並即存；否則唯讀顯示。
    let fnEl: HTMLElement;
    let langEl: HTMLElement;
    if (onMetaChange && canEditMeta) {
      const fnInput = document.createElement('input');
      fnInput.className = 'code-block-filename';
      fnInput.value = filename;
      fnInput.placeholder = '檔名（可選）';
      fnInput.spellcheck = false;
      fnInput.setAttribute('aria-label', '程式碼區塊檔名');

      const langSelect = document.createElement('select');
      langSelect.className = 'code-block-lang';
      langSelect.setAttribute('aria-label', '程式碼區塊語言');
      for (const language of CODE_LANGUAGES) {
        const opt = document.createElement('option');
        opt.value = language.value;
        opt.textContent = language.label;
        langSelect.appendChild(opt);
      }
      langSelect.value = canonicalLangValue(lang);

      // 檔名失焦：有變更才寫回（帶當前下拉語言）；語言變更：立即寫回（帶當前檔名輸入）。
      // 上層以 wrap（本區塊根 DOM）算出文件順序索引、改寫圍欄資訊並即時存 DB。
      fnInput.addEventListener('blur', () => {
        if (fnInput.value !== filename) onMetaChange(fenceLine as number, langSelect.value, fnInput.value);
      });
      langSelect.addEventListener('change', () => {
        onMetaChange(fenceLine as number, langSelect.value, fnInput.value);
      });

      fnEl = fnInput;
      langEl = langSelect;
    } else {
      const fnSpan = document.createElement('span');
      fnSpan.className = 'code-block-filename-ro' + (filename ? '' : ' code-block-muted');
      fnSpan.textContent = filename || '程式碼';

      const langSpan = document.createElement('span');
      langSpan.className = 'code-block-lang-ro';
      langSpan.textContent = lang || 'text';

      fnEl = fnSpan;
      langEl = langSpan;
    }

    const right = document.createElement('div');
    right.className = 'code-block-header-right';

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

    right.appendChild(langEl);

    // ── 內文直編（雙右鍵進入；💾 儲存鈕平時停用、編輯且有變更時啟用）────────────────────
    // 只有「圍欄」程式碼區塊可直編（有 data-fence-line 才能定位原文改寫；縮排程式碼區塊維持唯讀）。
    const canEditBody = !!onBodyEdit && canEditMeta;
    if (canEditBody) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'zw-code-save-btn';
      saveBtn.textContent = '💾 儲存';
      saveBtn.title = '雙擊右鍵進入編輯後，按此儲存（Esc 取消）';
      saveBtn.disabled = true;
      right.appendChild(saveBtn);

      /** 目前的編輯器（null＝未在編輯）。 */
      let editor: HTMLTextAreaElement | null = null;

      /** 離開編輯態（還原顯示；不儲存）。 */
      const exitEditing = (): void => {
        if (!editor) return;
        editor.remove();
        editor = null;
        pre.style.display = '';
        saveBtn.disabled = true;
      };

      /** 進入編輯態：textarea 取代 pre 顯示，初值＝圍欄內文（textContent 即原始碼，Markdig 轉義已被 DOM 還原）。 */
      const enterEditing = (): void => {
        if (editor) return;
        editor = document.createElement('textarea');
        editor.className = 'zw-code-editor';
        editor.value = text;
        editor.rows = Math.min(40, Math.max(3, text.split('\n').length + 1));
        editor.spellcheck = false;
        editor.addEventListener('input', () => {
          saveBtn.disabled = !editor || editor.value === text;
        });
        editor.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            exitEditing();
          }
          // Enter＝換行（程式碼多行天性），儲存一律走 💾 鈕。
        });
        pre.style.display = 'none';
        wrap.appendChild(editor);
        editor.focus();
      };

      saveBtn.addEventListener('click', () => {
        if (!editor || editor.value === text) return;
        const pendingEditor = editor;
        pendingEditor.disabled = true;
        saveBtn.disabled = true;
        saveBtn.textContent = '儲存中…';
        onBodyEdit(fenceLine as number, pendingEditor.value).then((ok) => {
          if (ok) {
            // 成功也自行離開編輯態（還原顯示舊 pre）：渲染後 HTML 可能一字未變（極端情況）
            // → 不會有重注入；若真的變了，重注入隨後汰換整塊，這裡只是暫態（復審 HIGH）。
            saveBtn.textContent = '💾 儲存';
            exitEditing();
            return;
          }
          // 失敗：保留使用者輸入，可修正後再存或 Esc 放棄。
          pendingEditor.disabled = false;
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 儲存';
          pendingEditor.focus();
        });
      });

      const tracker = createDoubleRightClickTracker(() => enterEditing());
      wrap.addEventListener('contextmenu', (event) => {
        // 編輯中的 textarea 保留原生右鍵（貼上/拼字修正）。
        if (event.target instanceof Element && event.target.closest('textarea')) return;
        // 順序關鍵：先餵 tracker 再 preventDefault——tracker 會忽略「已被別人 preventDefault」的
        // 事件（NoteOverlay 繪圖取消那一下），若自己先 preventDefault 雙右鍵永遠不會觸發。
        tracker.handleContextMenu(event);
        event.preventDefault(); // 程式碼區塊內一律抑制原生選單（單次右鍵也抑制，與全站慣例一致）
      });
    }

    right.appendChild(copyBtn);
    header.appendChild(fnEl);
    header.appendChild(right);

    // 以 wrap 取代 pre 的位置，再把 header 與 pre 收進 wrap。
    pre.parentNode?.insertBefore(wrap, pre);
    wrap.appendChild(header);
    wrap.appendChild(pre);
  }
}
