/**
 * 為「以 HTML 注入（dangerouslySetInnerHTML）」呈現的程式碼區塊加上「一鍵複製」按鈕。
 *
 * 用於筆記閱讀檢視：內容是後端預先轉好的 HTML，並非 React 渲染，
 * 故以 DOM 後處理的方式為每個 `<pre>` 注入複製鈕（樣式見 globals.css 的 .code-copy-btn）。
 * 已處理過的 `<pre>` 會標記 `data-cb`，避免重複注入。
 */

/**
 * 後備複製（navigator.clipboard 不可用時）：用暫時 textarea + execCommand。
 * @param text 要複製的文字。
 * @returns 是否成功。
 */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 複製文字到剪貼簿（優先用 Clipboard API，否則用後備方案）。
 * @param text 要複製的文字。
 * @returns 是否成功。
 */
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

/**
 * 在指定容器內，為尚未處理的每個 `<pre>` 程式碼區塊注入「複製」按鈕。
 * @param root 要掃描的容器元素。
 */
export function enhanceCodeBlocks(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLPreElement>("pre:not([data-cb])");
  blocks.forEach((pre) => {
    pre.dataset.cb = "1";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-btn";
    button.textContent = "複製";
    button.setAttribute("aria-label", "複製程式碼");

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 只取 <code> 的文字（排除複製鈕本身）；無 <code> 時退回整個 <pre>。
      const codeEl = pre.querySelector("code");
      const text = (codeEl ?? pre).textContent ?? "";
      const ok = await copyText(text);
      button.textContent = ok ? "已複製" : "複製失敗";
      button.classList.toggle("copied", ok);
      window.setTimeout(() => {
        button.textContent = "複製";
        button.classList.remove("copied");
      }, 1500);
    });

    pre.appendChild(button);
  });
}
