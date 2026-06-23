'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { captureSelection, reAnchor, type SelectionInfo } from '@/lib/textAnchor';
import {
  listNoteMarks,
  createNoteMark,
  updateNoteMark,
  deleteNoteMark,
  askNoteSelectionAnswer,
  searchLinkCandidates,
  type NoteMark,
  type CreateNoteMarkInput,
  type LinkCandidate,
} from '@/lib/api';
import { ColorPickerInline, resolveColor } from '@/components/ColorPicker';
import { pushUndo } from '@/lib/undoManager';
import { NOTE_ASK_STICKY_EVENT } from '@/components/NoteOverlay';

/** 目標型別 → 中文標籤（hover 浮窗顯示）。 */
const TARGET_LABEL: Record<string, string> = {
  note: '筆記',
  taskcard: '任務',
  node: '開問啦節點',
  url: '外部連結',
};

interface Props {
  /** 筆記 ID。 */
  noteId: string;
  /** 已渲染的內文容器（.markdown-prose）參考。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 內文 HTML（變更時重新套用標註）。 */
  contentHtml: string;
  /** 是否啟用（僅在預覽分頁可見時）。 */
  active: boolean;
}

/**
 * 筆記文字標註層：在已渲染的內文上套用「畫重點 / 做關聯 / 寫備註」，
 * 提供框選浮窗（建立標註）與滑鼠移上去的浮窗（檢視關聯目標 / 備註，可導航 / 移除）。
 *
 * 標註以 DOM 包裹方式覆蓋在 react 之外（容器用 dangerouslySetInnerHTML、內容不變時 react 不會重設），
 * 與開問啦節點的標註機制一致；錨點用「文字＋位移＋前後文」定位，內容編輯後可重新定位。
 */
export function NoteMarksLayer({ noteId, containerRef, contentHtml, active }: Props) {
  const router = useRouter();
  const [marks, setMarks] = useState<NoteMark[]>([]);
  const [sel, setSel] = useState<(SelectionInfo & { rect: DOMRect }) | null>(null);
  // 本次選取已建立的重點 mark id：再選色時改用「更新顏色」而非重複建立，
  // 讓使用者可反覆調色，工具面板不關閉（只在點外部空白處才關）。
  const [hlMarkId, setHlMarkId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ markIds: string[]; rect: DOMRect } | null>(null);
  const hideTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    setMarks(await listNoteMarks(noteId));
  }, [noteId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 套用標註到容器（DOM 包裹）。marks / 內容 / 啟用狀態變更時重套。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;
    applyMarks(el, marks);
    // 卸載 / 重套前先還原，避免殘留。
    return () => {
      if (el) unwrap(el);
    };
  }, [marks, contentHtml, active, containerRef]);

  // 框選（mouseup）與 hover（mouseover/out）事件委派到容器。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;

    const onMouseUp = () => {
      // 點到既有標註不視為新框選。
      const info = captureSelection(el);
      if (!info) return;
      const range = window.getSelection()?.getRangeAt(0);
      if (range) {
        setHlMarkId(null); // 新的一次選取 → 下次選色建立新的重點
        setSel({ ...info, rect: range.getBoundingClientRect() });
      }
    };

    const onOver = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest('[data-mark-id]') as HTMLElement | null;
      if (!target || !el.contains(target)) return;
      // 蒐集從該元素往上到容器、所有 data-mark-id（處理巢狀的連結＋備註）。
      const ids: string[] = [];
      let cur: HTMLElement | null = target;
      while (cur && cur !== el) {
        const id = cur.getAttribute('data-mark-id');
        if (id) ids.push(id);
        cur = cur.parentElement;
      }
      if (ids.length === 0) return;
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setHover({ markIds: ids, rect: target.getBoundingClientRect() });
    };

    const onOut = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related?.closest('[data-note-hover-popup]')) return; // 移入浮窗 → 不關
      scheduleHideHover();
    };

    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    return () => {
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, [active, containerRef]);

  const scheduleHideHover = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 220);
  };
  const cancelHideHover = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const clearSelection = () => {
    setSel(null);
    setHlMarkId(null);
    window.getSelection()?.removeAllRanges();
  };

  // ── 建立標註（皆登記到共用復原堆疊：Ctrl+Z 復原 / Ctrl+Y 重做） ──

  /**
   * 建立一筆標註並登記復原動作。
   * undo＝刪除剛建的標註；redo＝以同 payload 重建（id 會變，故用 ref 追蹤最新 id）。
   */
  const createMarkUndoable = async (payload: CreateNoteMarkInput): Promise<NoteMark | null> => {
    const created = await createNoteMark(noteId, payload);
    await reload();
    if (!created) return null;
    const ref = { id: created.id };
    pushUndo({
      undo: async () => { await deleteNoteMark(ref.id); await reload(); },
      redo: async () => { const m = await createNoteMark(noteId, payload); if (m) ref.id = m.id; await reload(); },
    });
    return created;
  };

  const addHighlight = async (color: string) => {
    if (!sel) return;
    // 已對本次選取畫過重點 → 改既有重點顏色（避免重複堆疊），且不關閉面板可繼續調色。
    if (hlMarkId) {
      await updateNoteMark(hlMarkId, { color });
      await reload();
      return;
    }
    const created = await createMarkUndoable({
      kind: 'highlight',
      anchorText: sel.text, anchorStart: sel.start, anchorEnd: sel.end,
      anchorPrefix: sel.prefix, anchorSuffix: sel.suffix,
      color,
    });
    if (created) setHlMarkId(created.id);
    // 不關閉面板（只在點外部空白處才關）；清掉瀏覽器選取，但保留 sel 供再次調色。
    window.getSelection()?.removeAllRanges();
  };

  const addLink = async (targetType: string, targetId?: string, targetUrl?: string) => {
    if (!sel) return;
    const payload: CreateNoteMarkInput = {
      kind: 'link',
      anchorText: sel.text, anchorStart: sel.start, anchorEnd: sel.end,
      anchorPrefix: sel.prefix, anchorSuffix: sel.suffix,
      targetType, targetId, targetUrl,
    };
    clearSelection();
    await createMarkUndoable(payload);
  };

  const addAnnotation = async (text: string) => {
    if (!sel || !text.trim()) return;
    const payload: CreateNoteMarkInput = {
      kind: 'annotation',
      anchorText: sel.text, anchorStart: sel.start, anchorEnd: sel.end,
      anchorPrefix: sel.prefix, anchorSuffix: sel.suffix,
      text: text.trim(),
    };
    clearSelection();
    await createMarkUndoable(payload);
  };

  /** 刪除標註（重點 / 關聯 / 備註皆可）；登記復原：undo＝重建、redo＝再刪。 */
  const removeMark = async (markId: string) => {
    const target = marks.find((x) => x.id === markId);
    await deleteNoteMark(markId);
    setHover(null);
    await reload();
    if (!target) return;
    const payload = markToInput(target);
    const ref = { id: markId };
    pushUndo({
      undo: async () => { const m = await createNoteMark(noteId, payload); if (m) ref.id = m.id; await reload(); },
      redo: async () => { await deleteNoteMark(ref.id); await reload(); },
    });
  };

  // 框選提問：以「整篇筆記 + 框選文字」為脈絡向 AI 提問，把答案放進「就在原處旁邊」的便利貼，
  // 不另開新筆記。便利貼由 NoteOverlay 接收事件後建立（座標相對於內文容器，放在選取段落下方）。
  const askSelection = async (question: string): Promise<boolean> => {
    if (!sel || !question.trim()) return false;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const x = containerRect ? Math.max(8, sel.rect.left - containerRect.left) : 24;
    const y = containerRect ? sel.rect.bottom - containerRect.top + 8 : 24;
    const selectedText = sel.text;
    const answer = await askNoteSelectionAnswer(noteId, {
      anchorText: sel.text,
      anchorStart: sel.start,
      anchorEnd: sel.end,
      anchorPrefix: sel.prefix,
      anchorSuffix: sel.suffix,
      question: question.trim(),
    });
    clearSelection();
    if (answer == null) return false;
    const stickyText = `Q：${question.trim()}\n（選取：「${selectedText.slice(0, 40)}${selectedText.length > 40 ? '…' : ''}」）\n\n${answer}`;
    window.dispatchEvent(
      new CustomEvent(NOTE_ASK_STICKY_EVENT, { detail: { x, y, text: stickyText } })
    );
    return true;
  };

  const navigate = (m: NoteMark) => {
    if (m.targetType === 'note' && m.targetSlug) {
      router.push(`/notes/${m.targetSlug.split('/').map(encodeURIComponent).join('/')}`);
    } else if (m.targetType === 'taskcard') {
      router.push(`/tasks`);
    } else if (m.targetType === 'node') {
      router.push(`/canvas`);
    } else if (m.targetType === 'url' && m.targetUrl) {
      window.open(m.targetUrl, '_blank', 'noopener');
    }
  };

  if (!active) return null;

  const hoveredMarks = hover
    ? marks.filter((m) => hover.markIds.includes(m.id))
    : [];

  return (
    <>
      {sel && (
        <NoteSelectionPopover
          rect={sel.rect}
          noteId={noteId}
          onHighlight={addHighlight}
          onLink={addLink}
          onAnnotate={addAnnotation}
          onAsk={askSelection}
          onClose={clearSelection}
        />
      )}
      {hover && hoveredMarks.length > 0 &&
        createPortal(
          <div
            data-note-hover-popup
            onMouseEnter={cancelHideHover}
            onMouseLeave={scheduleHideHover}
            style={{
              position: 'fixed',
              top: Math.min(window.innerHeight - 40, hover.rect.bottom + 6),
              left: Math.min(window.innerWidth - 300, Math.max(8, hover.rect.left)),
              zIndex: 3600,
              width: 280,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              padding: 'var(--spacing-2)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-2)',
            }}
          >
            {hoveredMarks.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-2)' }}>
                <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: 56, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {m.kind === 'highlight' && (
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: resolveColor(m.color), border: '1px solid var(--border-default)' }} />
                  )}
                  {m.kind === 'link' ? `🔗 ${TARGET_LABEL[m.targetType || ''] ?? '關聯'}` : m.kind === 'annotation' ? '📝 備註' : '🖍 重點'}
                </span>
                {m.kind === 'link' ? (
                  <button
                    onClick={() => navigate(m)}
                    title="點擊前往"
                    style={{
                      flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
                      background: 'transparent', border: 'none', color: 'var(--text-link, #2563eb)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0,
                    }}
                  >
                    {m.targetTitle || m.targetUrl || '(未命名)'}
                  </button>
                ) : m.kind === 'annotation' ? (
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </span>
                ) : (
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    「{m.anchorText}」
                  </span>
                )}
                <button
                  onClick={() => removeMark(m.id)}
                  title={m.kind === 'highlight' ? '移除重點' : '移除'}
                  data-testid="note-mark-remove"
                  style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ============================================================================
// 框選浮窗：畫重點 / 做關聯 / 寫備註
// ============================================================================

function NoteSelectionPopover({
  rect,
  noteId,
  onHighlight,
  onLink,
  onAnnotate,
  onAsk,
  onClose,
}: {
  rect: DOMRect;
  noteId: string;
  onHighlight: (color: string) => void;
  onLink: (targetType: string, targetId?: string, targetUrl?: string) => void;
  onAnnotate: (text: string) => void;
  onAsk: (question: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<null | 'hl' | 'link' | 'note' | 'ask'>(null);
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<LinkCandidate[]>([]);
  const [url, setUrl] = useState('');
  const [noteText, setNoteText] = useState('');
  const [askQ, setAskQ] = useState('');
  const [asking, setAsking] = useState(false);

  // 關聯：搜尋既有筆記/任務/節點。
  useEffect(() => {
    if (tab !== 'link') return;
    let alive = true;
    const id = window.setTimeout(async () => {
      const res = await searchLinkCandidates('note', noteId, q);
      if (alive) setCands(res);
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [tab, q, noteId]);

  // 點浮窗外關閉。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('[data-note-sel-popover]')) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const top = Math.min(window.innerHeight - 160, rect.bottom + 6);
  const left = Math.min(window.innerWidth - 300, Math.max(8, rect.left));

  return createPortal(
    <div
      data-note-sel-popover
      style={{
        position: 'fixed', top, left, zIndex: 3600, width: 280,
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        padding: 'var(--spacing-2)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)',
      }}
    >
      {/* 分頁切換：重點 / 關聯 / 備註 / 提問 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="tk-btn" style={{ flex: 1, cursor: 'pointer', padding: '2px 4px', fontWeight: tab === 'hl' ? 600 : 400 }}
          onClick={() => setTab(tab === 'hl' ? null : 'hl')} data-testid="note-hl-tab">🖍 重點</button>
        <button className="tk-btn" style={{ flex: 1, cursor: 'pointer', padding: '2px 4px', fontWeight: tab === 'link' ? 600 : 400 }}
          onClick={() => setTab(tab === 'link' ? null : 'link')} data-testid="note-link-tab">🔗 關聯</button>
        <button className="tk-btn" style={{ flex: 1, cursor: 'pointer', padding: '2px 4px', fontWeight: tab === 'note' ? 600 : 400 }}
          onClick={() => setTab(tab === 'note' ? null : 'note')} data-testid="note-annotate-tab">📝 備註</button>
        <button className="tk-btn" style={{ flex: 1, cursor: 'pointer', padding: '2px 4px', fontWeight: tab === 'ask' ? 600 : 400 }}
          onClick={() => setTab(tab === 'ask' ? null : 'ask')} data-testid="note-ask-tab">💬 提問</button>
      </div>

      {tab === 'hl' && (
        <ColorPickerInline onPick={(hex) => onHighlight(hex)} />
      )}

      {tab === 'ask' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            autoFocus
            value={askQ}
            onChange={(e) => setAskQ(e.target.value)}
            placeholder="針對這段文字問 AI…（會以整篇筆記為脈絡，在旁邊新增便利貼回答）"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
            data-testid="note-ask-text"
          />
          <button
            className="tk-btn tk-btn--primary"
            style={{ cursor: 'pointer', alignSelf: 'flex-end' }}
            disabled={!askQ.trim() || asking}
            onClick={async () => { setAsking(true); await onAsk(askQ); setAsking(false); }}
            data-testid="note-ask-send"
          >
            {asking ? '思考中…' : '送出提問'}
          </button>
        </div>
      )}

      {tab === 'link' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋筆記 / 任務 / 節點…"
            style={inputStyle}
            data-testid="note-link-search"
          />
          <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {cands.map((c) => (
              <button
                key={`${c.type}-${c.id}`}
                onClick={() => onLink(c.type, c.id)}
                title={`關聯到此${TARGET_LABEL[c.type] ?? ''}`}
                style={{
                  textAlign: 'left', cursor: 'pointer', background: 'transparent',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                data-testid="note-link-candidate"
              >
                <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                  [{TARGET_LABEL[c.type] ?? c.type}]
                </span>{' '}
                {c.title}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="或貼上外部網址…"
              style={inputStyle}
              data-testid="note-link-url"
            />
            <button
              className="tk-btn tk-btn--primary"
              style={{ cursor: 'pointer' }}
              disabled={!/^https?:\/\//.test(url.trim())}
              onClick={() => onLink('url', undefined, url.trim())}
            >
              連結
            </button>
          </div>
        </div>
      )}

      {tab === 'note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="為這段文字寫備註…"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
            data-testid="note-annotate-text"
          />
          <button
            className="tk-btn tk-btn--primary"
            style={{ cursor: 'pointer', alignSelf: 'flex-end' }}
            disabled={!noteText.trim()}
            onClick={() => onAnnotate(noteText)}
          >
            儲存備註
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 8px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-default)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
};

/** 由既有標註重建「建立用 payload」（供刪除後復原重建）。null 欄位轉 undefined。 */
function markToInput(m: NoteMark): CreateNoteMarkInput {
  return {
    kind: m.kind,
    anchorText: m.anchorText,
    anchorStart: m.anchorStart,
    anchorEnd: m.anchorEnd,
    anchorPrefix: m.anchorPrefix,
    anchorSuffix: m.anchorSuffix,
    color: m.color ?? undefined,
    targetType: m.targetType ?? undefined,
    targetId: m.targetId ?? undefined,
    targetUrl: m.targetUrl ?? undefined,
    text: m.text ?? undefined,
  };
}

// ============================================================================
// DOM 標註套用（移植自開問啦 annotate.ts，擴充三種標註）
// ============================================================================

/** 收集容器內所有文字節點。 */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (;;) {
    const n = walker.nextNode();
    if (!n) break;
    out.push(n as Text);
  }
  return out;
}

/** 還原先前包裹的標註並合併文字節點。 */
function unwrap(container: HTMLElement): void {
  container.querySelectorAll('[data-anno]').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  container.normalize();
}

/** 將 [start,end) 範圍包進 wrapper。 */
function wrapRange(
  container: HTMLElement,
  start: number,
  end: number,
  makeWrapper: () => HTMLElement
): void {
  if (end <= start) return;
  const texts = collectTextNodes(container);
  let pos = 0;
  for (const t of texts) {
    const len = t.data.length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;
    const a = Math.max(start, nodeStart);
    const b = Math.min(end, nodeEnd);
    if (a >= b) continue;
    let target = t;
    const localStart = a - nodeStart;
    const localEnd = b - nodeStart;
    if (localStart > 0) target = target.splitText(localStart);
    if (localEnd - localStart < target.data.length) target.splitText(localEnd - localStart);
    const wrapper = makeWrapper();
    target.parentNode?.replaceChild(wrapper, target);
    wrapper.appendChild(target);
  }
}

/** 對容器套用所有標註（重點以 mark、連結/備註以 span）。 */
function applyMarks(container: HTMLElement, marks: NoteMark[]): void {
  unwrap(container);
  const text = container.textContent ?? '';

  // 先套重點（底色），再套連結/備註（底線/虛線），確保互不吃掉。
  for (const m of marks.filter((x) => x.kind === 'highlight')) {
    const r = reAnchor(text, m.anchorText, m.anchorStart, m.anchorPrefix, m.anchorSuffix);
    if (!r.found) continue;
    wrapRange(container, r.start, r.end, () => {
      const el = document.createElement('mark');
      el.dataset.anno = '1';
      el.dataset.markId = m.id; // 供 hover 偵測 → 可移除重點（#4）
      el.style.background = resolveColor(m.color);
      el.style.borderRadius = '3px';
      el.style.padding = '0 1px';
      el.style.color = 'inherit';
      el.style.cursor = 'pointer';
      el.title = '滑入可移除重點';
      return el;
    });
  }

  for (const m of marks.filter((x) => x.kind === 'link' || x.kind === 'annotation')) {
    const r = reAnchor(text, m.anchorText, m.anchorStart, m.anchorPrefix, m.anchorSuffix);
    if (!r.found) continue;
    wrapRange(container, r.start, r.end, () => {
      const span = document.createElement('span');
      span.dataset.anno = '1';
      span.dataset.markId = m.id;
      span.className = m.kind === 'link' ? 'note-anno-link' : 'note-anno-note';
      span.title = m.kind === 'link' ? '有關聯（滑入查看）' : '有備註（滑入查看）';
      return span;
    });
  }
}
