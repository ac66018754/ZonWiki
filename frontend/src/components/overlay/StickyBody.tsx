'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { STICKY_COLORS, type OverlayItemView } from './overlayShared';
import { PRESET_COLORS, resolveColor } from '@/lib/highlightColor';
import { ColorPickerInline } from '@/components/ColorPicker';

/**
 * 便利貼內的「畫重點」標記：以「字元位移」記錄要上色的範圍。
 * 存在 NoteOverlayItem.dataJson（與便利貼自訂標題一起，結構為 `{ title?, highlights? }`）。
 */
export interface StickyHighlight {
  /** 起始字元位移（含）。 */
  start: number;
  /** 結束字元位移（不含）。 */
  end: number;
  /** 顏色（hex）。 */
  color: string;
}

/** 從 dataJson 安全解析重點陣列（相容舊的「純陣列」格式與新的 `{highlights}` 物件格式）。 */
export function parseStickyHighlights(dataJson: string | null | undefined): StickyHighlight[] {
  if (!dataJson) return [];
  try {
    const parsed = JSON.parse(dataJson);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.highlights) ? parsed.highlights : [];
    return arr
      .filter(
        (h: unknown): h is StickyHighlight =>
          !!h && typeof (h as StickyHighlight).start === 'number' &&
          typeof (h as StickyHighlight).end === 'number' &&
          typeof (h as StickyHighlight).color === 'string',
      )
      .filter((h: StickyHighlight) => h.end > h.start);
  } catch {
    return [];
  }
}

/** 把全文依重點切成「一般／上色」段落（重疊者以先到者為準）。 */
function toSegments(text: string, highlights: StickyHighlight[]): { text: string; color?: string }[] {
  const sorted = highlights
    .map((h) => ({ start: Math.max(0, h.start), end: Math.min(text.length, h.end), color: h.color }))
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start);

  const segments: { text: string; color?: string }[] = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.start < cursor) continue; // 跳過重疊
    if (h.start > cursor) segments.push({ text: text.slice(cursor, h.start) });
    segments.push({ text: text.slice(h.start, h.end), color: h.color });
    cursor = h.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** 文字框與其下方「重點底圖」共用的排版樣式（必須完全一致，文字與重點才會對齊）。 */
const BODY_TEXT_STYLE: React.CSSProperties = {
  margin: 0,
  padding: '6px',
  border: 'none',
  fontSize: 'var(--text-sm)',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  boxSizing: 'border-box',
  letterSpacing: 'normal',
};

/**
 * 便利貼內容：始終可編輯的文字框 ＋「畫重點（標記）」＋「背景顏色」＋「繼續問 AI」。
 *
 * - **永遠是編輯模式**：文字框可直接打字；其下疊一層「重點底圖」顯示已標記的顏色（透明文字框疊在上面、
 *   游標可見），所以可以邊打字邊看到重點。
 * - **標重點**：先在文字框反白一段，按「標重點」即用「目前小球顏色」上色；小球可點開換色。
 * - **移除重點**：移除反白範圍的重點（沒反白則清掉全部重點）。
 * - **背景顏色**：點開色盤改便利貼底色。
 * - **繼續問**：以「筆記內容＋前一張便利貼＋本便利貼」為脈絡向 AI 追問，答案變成新便利貼。
 */
export function StickyBody({
  item,
  onText,
  onTextCommit,
  onColor,
  onHighlightsChange,
  onAsk,
}: {
  item: OverlayItemView;
  onText: (t: string) => void;
  onTextCommit: (t: string) => void;
  onColor: (c: string) => void;
  /** 持久化重點（給上層併入 dataJson）。未提供＝不啟用「畫重點」（如開問啦畫布便利貼）。 */
  onHighlightsChange?: (highlights: StickyHighlight[]) => void;
  /** 以本便利貼為起點繼續向 AI 追問。未提供＝不顯示「繼續問」。 */
  onAsk?: (question: string) => Promise<void>;
}) {
  const text = item.text ?? '';
  const highlights = parseStickyHighlights(item.dataJson);
  const segments = toSegments(text, highlights);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // 目前畫重點要用的顏色（可點小球換色）。
  const [hlColor, setHlColor] = useState<string>(PRESET_COLORS[0]);
  const [showHlPalette, setShowHlPalette] = useState(false);
  const [showBgPalette, setShowBgPalette] = useState(false);
  // 預覽模式：把內文當 Markdown 渲染（唯讀）；關閉時為一般編輯（文字框＋畫重點）。
  const [preview, setPreview] = useState(false);

  // 「繼續問」輸入狀態。
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);

  // 色盤「選色不關閉、點空白才關閉」（與畫筆色盤一致）：點到色盤本身或其開關鈕以外才收起。
  useEffect(() => {
    if (!showHlPalette && !showBgPalette) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-sticky-pop]') || t?.closest('[data-sticky-popbtn]')) return;
      setShowHlPalette(false);
      setShowBgPalette(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showHlPalette, showBgPalette]);

  // 文字變更時，把超出新長度的重點裁掉/丟棄，避免位移錯亂。
  const commitText = (next: string) => {
    onTextCommit(next);
    if (!onHighlightsChange) return;
    const trimmed = highlights
      .map((h) => ({ ...h, end: Math.min(h.end, next.length), start: Math.min(h.start, next.length) }))
      .filter((h) => h.end > h.start);
    if (trimmed.length !== highlights.length) onHighlightsChange(trimmed);
  };

  /** 目前文字框的反白範圍（按鈕用 onMouseDown preventDefault 保住焦點，故仍讀得到）。 */
  const currentSelection = (): { start: number; end: number } => {
    const ta = taRef.current;
    return { start: ta?.selectionStart ?? 0, end: ta?.selectionEnd ?? 0 };
  };

  const applyHighlight = () => {
    if (!onHighlightsChange) return;
    const { start, end } = currentSelection();
    if (end <= start) return; // 沒反白就不動作
    const next = highlights
      .filter((h) => h.end <= start || h.start >= end) // 移除重疊後再加新的（等同覆寫該段顏色）
      .concat({ start, end, color: hlColor })
      .sort((a, b) => a.start - b.start);
    onHighlightsChange(next);
  };

  const removeHighlight = () => {
    if (!onHighlightsChange) return;
    const { start, end } = currentSelection();
    // 有反白→移除該範圍重疊的重點；沒反白→清掉全部。
    const next =
      end > start ? highlights.filter((h) => h.end <= start || h.start >= end) : [];
    onHighlightsChange(next);
  };

  const submitAsk = async () => {
    const q = question.trim();
    if (!q || sending || !onAsk) return;
    setSending(true);
    try {
      await onAsk(q);
      setQuestion('');
      setAsking(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* 預覽模式：把內文當 Markdown 渲染（唯讀）。
          刻意不綁「點內容切回編輯」——會誤觸；要編輯請按底部「✏️ 編輯」鈕。 */}
      {preview ? (
        <div
          className="sticky-markdown markdown-prose"
          data-testid="sticky-markdown"
          style={{
            flex: 1, minHeight: 0, overflow: 'auto', padding: '6px', cursor: 'auto',
            fontSize: 'var(--text-sm)', lineHeight: 1.5, color: '#333', wordBreak: 'break-word',
          }}
        >
          {text.trim()
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            : <span style={{ color: '#999' }}>（空白便利貼，按下方「編輯」開始輸入）</span>}
        </div>
      ) : (
      /* 編輯模式：文字框（永遠顯示清晰文字）＋ 其下「重點底圖」（只畫重點色塊、文字透明）。
          關鍵：底圖文字一律透明，只露出 <mark> 的底色方塊；真正可見的文字一律由上層文字框呈現，
          故不會出現「兩層文字錯位疊影」（之前 bug 的成因）。 */
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div
          ref={backdropRef}
          aria-hidden="true"
          data-testid="sticky-highlight-backdrop"
          style={{
            ...BODY_TEXT_STYLE,
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            color: 'transparent', // 底圖文字一律透明，只露出重點底色
          }}
        >
          {segments.map((seg, i) =>
            seg.color ? (
              <mark key={i} style={{ background: resolveColor(seg.color), color: 'transparent', borderRadius: 2 }}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
          {/* 結尾換行讓底圖高度與文字框一致 */}
          {'\n'}
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onScroll={(e) => {
            if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          placeholder="便利貼…"
          data-testid="sticky-text"
          className="sticky-textarea"
          style={{
            ...BODY_TEXT_STYLE,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            resize: 'none',
            outline: 'none',
            background: 'transparent',
            // 文字永遠清晰可見、疊在重點色塊之上；游標可見。
            color: '#333',
            caretColor: '#333',
          }}
        />
      </div>
      )}

      {/* 重點色盤（點小球展開）：完整色盤（react-colorful，無斷點）；選色不關閉，點空白才關閉。 */}
      {showHlPalette && onHighlightsChange && (
        <div style={palettePopStyle} data-testid="sticky-hl-palette" data-sticky-pop>
          <ColorPickerInline
            initial={hlColor}
            onChange={(hex) => setHlColor(hex)}
            onPick={(hex) => setHlColor(hex)}
          />
        </div>
      )}

      {/* 背景色盤（點「背景顏色」展開）：完整色盤；選色不關閉，點空白才關閉。 */}
      {showBgPalette && (
        <div style={palettePopStyle} data-testid="sticky-bg-palette" data-sticky-pop>
          <ColorPickerInline
            initial={item.color ?? STICKY_COLORS[0]}
            onPick={(hex) => onColor(hex)}
          />
        </div>
      )}

      {/* 繼續問：輸入追問問題（脈絡＝筆記＋前一便利貼＋本便利貼），答案變成新便利貼。 */}
      {asking && (
        <div style={{ padding: '4px 6px', borderTop: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} data-testid="sticky-ask-box">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="接著想問 AI 什麼？（會帶上筆記與前一張便利貼的內容）"
            rows={2}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitAsk(); }}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'none', border: '1px solid rgba(0,0,0,0.2)',
              borderRadius: 4, background: 'rgba(255,255,255,0.7)', padding: 4, fontSize: 'var(--text-xs)', color: '#333', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
            <button
              onClick={submitAsk}
              disabled={sending || !question.trim()}
              style={{ flex: 1, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '3px 0', opacity: sending || !question.trim() ? 0.6 : 1 }}
            >
              {sending ? '思考中…' : '送出'}
            </button>
            <button
              onClick={() => { setAsking(false); setQuestion(''); }}
              disabled={sending}
              style={{ border: 'none', borderRadius: 4, background: 'rgba(0,0,0,0.08)', color: '#333', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '3px 8px' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 底部工具列：預覽 ｜ 標重點 ｜ 顏色小球 ｜ 移除重點 ｜ 繼續問 ｜（空白）｜ 背景顏色 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', flexShrink: 0, flexWrap: 'wrap' }}>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPreview((v) => !v)}
          title={preview ? '回到編輯' : '預覽（把內文當 Markdown 渲染）'}
          data-testid="sticky-preview-toggle"
          style={{ ...toolBtnStyle, background: preview ? 'rgba(0,0,0,0.12)' : 'transparent' }}
        >
          {preview ? '✏️ 編輯' : '👁 預覽'}
        </button>
        {onHighlightsChange && !preview && (
          <>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyHighlight}
              title="把反白的文字標成重點（用右邊小球的顏色）"
              data-testid="sticky-highlight-btn"
              style={toolBtnStyle}
            >
              🖍 標重點
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setShowHlPalette((v) => !v); setShowBgPalette(false); }}
              title="重點顏色（點開換色）"
              data-testid="sticky-hl-ball"
              data-sticky-popbtn
              style={{ width: 16, height: 16, flexShrink: 0, borderRadius: '50%', background: hlColor, border: '1px solid rgba(0,0,0,0.35)', cursor: 'pointer' }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeHighlight}
              title="移除反白範圍的重點（未反白則清除全部）"
              data-testid="sticky-remove-highlight"
              style={toolBtnStyle}
            >
              移除重點
            </button>
          </>
        )}
        {onAsk && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAsking((v) => !v)}
            title="以本便利貼為起點，繼續向 AI 追問"
            data-testid="sticky-ask-toggle"
            style={{ ...toolBtnStyle, background: asking ? 'rgba(0,0,0,0.12)' : 'transparent' }}
          >
            💬 繼續問
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setShowBgPalette((v) => !v); setShowHlPalette(false); }}
          title="便利貼背景顏色（點開換色）"
          data-testid="sticky-bg-toggle"
          data-sticky-popbtn
          style={{ ...toolBtnStyle, background: showBgPalette ? 'rgba(0,0,0,0.12)' : 'transparent' }}
        >
          🎨 背景顏色
        </button>
      </div>
    </>
  );
}

/** 工具列文字按鈕樣式。 */
const toolBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
  borderRadius: 4,
  padding: '1px 4px',
  color: '#444',
  whiteSpace: 'nowrap',
};

/** 色盤彈出區樣式（裝完整色盤）。 */
const palettePopStyle: React.CSSProperties = {
  padding: '6px',
  borderTop: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(255,255,255,0.85)',
  flexShrink: 0,
  maxHeight: '60%',
  overflowY: 'auto',
};
