/**
 * 為「以 HTML 注入（dangerouslySetInnerHTML）」呈現的程式碼區塊加上「一鍵複製」按鈕。
 *
 * 用於筆記閱讀檢視：內容是後端預先轉好的 HTML（並非 React 渲染），
 * 故以 DOM 後處理的方式為每個 `<pre>` 注入複製鈕。
 *
 * 按鈕樣式一律用 **inline style** 直接設定（不依賴 CSS class 是否載入 / 是否被覆寫），
 * 確保只要這段程式有跑到、按鈕就一定看得到。已處理過的 `<pre>` 標記 `data-cb` 避免重複注入。
 */

/** 後備複製（navigator.clipboard 不可用時）：用暫時 textarea + execCommand。 */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** 複製文字到剪貼簿（優先 Clipboard API，否則後備）。 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopy(text);
    }
  }
  return fallbackCopy(text);
}

/** 套用按鈕的基礎樣式（綠底白字、定位於右上角）。 */
function styleButton(button: HTMLButtonElement, copied: boolean): void {
  button.style.position = 'absolute';
  button.style.top = '6px';
  button.style.right = '6px';
  button.style.padding = '2px 10px';
  button.style.background = copied ? 'var(--status-success-fg, #2e7d32)' : 'var(--action-primary-bg, #2d5016)';
  button.style.color = copied ? '#fff' : 'var(--action-primary-fg, #fff)';
  button.style.border = 'none';
  button.style.borderRadius = 'var(--radius-sm, 4px)';
  button.style.fontSize = 'var(--text-xs, 12px)';
  button.style.fontWeight = '600';
  button.style.fontFamily = 'var(--font-sans, sans-serif)';
  button.style.cursor = 'pointer';
  button.style.opacity = '0.92';
  button.style.zIndex = '5';
}

/**
 * 在指定容器內，為尚未處理的每個 `<pre>` 程式碼區塊注入「複製」按鈕。
 * @param root 要掃描的容器元素。
 */
export function enhanceCodeBlocks(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLPreElement>('pre:not([data-cb])');
  blocks.forEach((pre) => {
    pre.dataset.cb = '1';
    // 按鈕用絕對定位，需要 <pre> 是定位祖先；直接 inline 設定，不依賴外部 CSS。
    if (getComputedStyle(pre).position === 'static') {
      pre.style.position = 'relative';
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy-btn';
    button.textContent = '複製';
    button.setAttribute('aria-label', '複製程式碼');
    styleButton(button, false);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 只取 <code> 的文字（排除複製鈕本身）；無 <code> 時退回整個 <pre>。
      const codeEl = pre.querySelector('code');
      const text = (codeEl ?? pre).textContent ?? '';
      const ok = await copyText(text);
      button.textContent = ok ? '已複製' : '複製失敗';
      styleButton(button, ok);
      window.setTimeout(() => {
        button.textContent = '複製';
        styleButton(button, false);
      }, 1500);
    });

    pre.appendChild(button);
  });
}
