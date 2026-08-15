/**
 * 共用的語法上色核心（highlight.js）——編輯器預覽的 CodeBlock 與閱讀檢視的
 * enhanceReadingCodeBlocks 共用，確保兩邊上色一致、且 highlight.js 只設定一次。
 */
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

// common 包沒有、但使用者常用的語言（PowerShell／Dockerfile）另外註冊。冪等，模組只載一次。
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dockerfile', dockerfile);

/** 語言別名 → highlight.js 語言名（jsx/tsx 併入 js/ts；常見縮寫對應）。 */
const LANG_ALIAS: Record<string, string> = {
  jsx: 'javascript', tsx: 'typescript', js: 'javascript', ts: 'typescript',
  'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', sh: 'bash', shell: 'bash',
  yml: 'yaml', ps1: 'powershell', py: 'python',
};

/** HTML 轉義（純文字/上色失敗時用，避免把使用者程式碼當標記注入）。 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/**
 * 以 highlight.js 上色，回傳帶 hljs-* class 的 HTML 字串。
 * 純文字（text/plaintext）或未知語言或上色失敗時，回傳「轉義後的原文」（安全、不注入標記）。
 * @param code 程式碼原文。
 * @param lang 語言（可空）。
 */
export function highlightCode(code: string, lang: string): string {
  const resolved = LANG_ALIAS[(lang || '').toLowerCase()] ?? lang;
  if (resolved && resolved !== 'text' && resolved !== 'plaintext') {
    try {
      if (hljs.getLanguage(resolved)) {
        return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
      }
    } catch {
      /* 落到轉義原文 */
    }
  }
  return escapeHtml(code);
}
