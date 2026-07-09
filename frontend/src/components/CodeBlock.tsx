'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CODE_LANGUAGES, canonicalLangValue } from '@/lib/codeBlockMeta';
import { highlightCode } from '@/lib/highlightCode';

/**
 * 程式碼區塊：標題列（左＝檔名、右＝語言＋複製）＋ 語法上色內文（VS Code Dark+ 配色見 globals.css）。
 *
 * - interactive＝true（編輯器預覽）：檔名為可填輸入框（失焦寫回）、語言為下拉（變更即寫回）→ 由 onMetaChange
 *   把新的「語言／檔名」寫回 Markdown 圍欄（```lang:filename）。
 * - interactive＝false（如彈出預覽）：檔名／語言為唯讀顯示。
 *
 * onMetaChange 會帶回本區塊的根 DOM（self），供上層以「文件順序」算出這是第幾個圍欄區塊、精準寫回。
 */
export function CodeBlock({
  code,
  lang,
  filename,
  interactive = false,
  onMetaChange,
}: {
  /** 程式碼原文（不含尾端多餘換行）。 */
  code: string;
  /** 語言（可空）。 */
  lang: string;
  /** 檔名（可空）。 */
  filename: string;
  /** 是否可就地編輯檔名／語言。 */
  interactive?: boolean;
  /** 檔名／語言變更時回寫（lang, filename, 本區塊根 DOM）。 */
  onMetaChange?: (lang: string, filename: string, self: HTMLElement | null) => void;
}) {
  const selfRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  // 檔名採「本地狀態、失焦才寫回」：避免每一鍵都重寫原文→重解析→游標亂跳。
  const [localFile, setLocalFile] = useState(filename);
  useEffect(() => setLocalFile(filename), [filename]);

  // 上色結果 memo 化（[code, lang] 不變就不重算），並記憶化 __html 物件避免每次 render 重注入。
  const html = useMemo(() => ({ __html: highlightCode(code, lang) }), [code, lang]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
    } catch {
      /* 忽略複製失敗 */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const langValue = canonicalLangValue(lang);

  return (
    <div className="code-block" ref={selfRef}>
      <div className="code-block-header">
        {interactive ? (
          <input
            className="code-block-filename"
            value={localFile}
            spellCheck={false}
            placeholder="檔名（可選）"
            aria-label="程式碼區塊檔名"
            onChange={(e) => setLocalFile(e.target.value)}
            onBlur={() => {
              if (localFile !== filename) onMetaChange?.(lang, localFile, selfRef.current);
            }}
          />
        ) : (
          <span className={`code-block-filename-ro${filename ? '' : ' code-block-muted'}`}>
            {filename || '程式碼'}
          </span>
        )}
        <div className="code-block-header-right">
          {interactive ? (
            <select
              className="code-block-lang"
              value={langValue}
              aria-label="程式碼區塊語言"
              onChange={(e) => onMetaChange?.(e.target.value, filename, selfRef.current)}
            >
              {CODE_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          ) : (
            <span className="code-block-lang-ro">{lang || 'text'}</span>
          )}
          <button
            type="button"
            className={`code-copy-btn${copied ? ' copied' : ''}`}
            onClick={copy}
            aria-label="複製程式碼"
          >
            {copied ? '已複製' : '複製'}
          </button>
        </div>
      </div>
      <pre className="hljs code-block-pre">
        <code dangerouslySetInnerHTML={html} />
      </pre>
    </div>
  );
}
