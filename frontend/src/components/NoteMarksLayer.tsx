'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { captureSelection, reAnchor, type SelectionInfo } from '@/lib/textAnchor';
import {
  listNoteMarks,
  createNoteMark,
  updateNoteMark,
  deleteNoteMark,
  patchNoteMarkDetached,
  askNoteSelectionAnswer,
  searchLinkCandidates,
  getNoteById,
  type NoteMark,
  type NoteDetail,
  type CreateNoteMarkInput,
  type LinkCandidate,
} from '@/lib/api';
import { ColorPickerInline, resolveColor } from '@/components/ColorPicker';
import { pushUndo } from '@/lib/undoManager';
import { showToast } from '@/lib/toast';
import { noteHref } from '@/lib/noteHref';
import { formatMarkRef, parseMarkRef } from '@/lib/markRef';
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
  /**
   * 本篇筆記目前的 contentHash（供 Detached 回寫的「當次渲染基準」防過期）。
   * 瀏覽器為唯一座標系：每次真實渲染後把「found 與 mark.detached 不一致」者回寫，
   * 帶此 hash 讓後端擋掉停在舊內容的分頁送來的過期計算。未提供時不回寫（保守）。
   */
  contentHash?: string;
}

/**
 * 筆記文字標註層：在已渲染的內文上套用「畫重點 / 做關聯 / 寫備註」，
 * 提供框選浮窗（建立標註）與滑鼠移上去的浮窗（檢視關聯目標 / 備註，可導航 / 移除）。
 *
 * 標註以 DOM 包裹方式覆蓋在 react 之外（容器用 dangerouslySetInnerHTML、內容不變時 react 不會重設），
 * 與開問啦節點的標註機制一致；錨點用「文字＋位移＋前後文」定位，內容編輯後可重新定位。
 */
export function NoteMarksLayer({ noteId, containerRef, contentHtml, active, contentHash }: Props) {
  const router = useRouter();
  const [marks, setMarks] = useState<NoteMark[]>([]);
  const [sel, setSel] = useState<(SelectionInfo & { rect: DOMRect }) | null>(null);
  // 本次選取已建立的重點 mark id：再選色時改用「更新顏色」而非重複建立，
  // 讓使用者可反覆調色，工具面板不關閉（只在點外部空白處才關）。
  const [hlMarkId, setHlMarkId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ markIds: string[]; rect: DOMRect } | null>(null);
  const hideTimer = useRef<number | null>(null);
  // 閱讀模式段落 hover「複製段落引用」小鈕（方案 C）：記住目前浮出的段落與其容器內純文字位移。
  const [copyRefBtn, setCopyRefBtn] = useState<{ rect: DOMRect; start: number; end: number; text: string } | null>(null);
  // 目前浮出小鈕對應的段落元素：避免 mouseover 在同段落內反覆 setState（只在換段落時更新）。
  const lastBlockRef = useRef<HTMLElement | null>(null);

  // Detached 回寫的防抖批次狀態（見 useLayoutEffect 內註解）。以 ref 持有跨重繪，避免每次渲染重置。
  const detachedSync = useRef<{
    pending: Map<string, boolean>;
    inFlight: Set<string>;
    synced: Map<string, string>; // markId → `${hash}:${detached}` 已回寫過的記錄（防重試風暴）
    timer: number | null;
  }>({ pending: new Map(), inFlight: new Set(), synced: new Map(), timer: null });

  const reload = useCallback(async () => {
    setMarks(await listNoteMarks(noteId));
  }, [noteId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 套用標註到容器（DOM 包裹），並回寫 Detached。marks / 內容 / 啟用狀態 / hash 變更時重套。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;
    const foundMap = applyMarks(el, marks);

    // ── Detached 回寫（瀏覽器為唯一座標系，見 docs/DECISIONS.md）──
    // 後端不算 reAnchor：這裡以每次真實渲染算出的 found，把「found 與 mark.detached 不一致」者
    // 以 PATCH 回寫（帶當次 contentHash 防過期）；markId 去重、飛行中不重排、300ms 防抖合批、
    // fire-and-forget 失敗靜默。synced 記錄「已就此 hash 回寫過同值」避免每次重繪都重送（重試風暴）。
    if (contentHash) {
      const sync = detachedSync.current;
      for (const m of marks) {
        const found = foundMap.get(m.id);
        if (found === undefined) continue;
        const desired = !found; // found=true → detached 應為 false（復活）；反之標為失效
        if (desired === m.detached) continue;
        if (sync.synced.get(m.id) === `${contentHash}:${desired}`) continue;
        if (sync.inFlight.has(m.id)) continue;
        sync.pending.set(m.id, desired);
      }
      if (sync.pending.size > 0 && sync.timer == null) {
        sync.timer = window.setTimeout(() => {
          const batch = Array.from(sync.pending.entries());
          sync.pending.clear();
          sync.timer = null;
          for (const [markId, desired] of batch) {
            if (sync.inFlight.has(markId)) continue;
            sync.inFlight.add(markId);
            patchNoteMarkDetached(markId, desired, contentHash)
              .then((ok) => { if (ok) sync.synced.set(markId, `${contentHash}:${desired}`); })
              .finally(() => { sync.inFlight.delete(markId); });
          }
        }, 300);
      }
    }

    // 卸載 / 重套前先還原，避免殘留。
    return () => {
      if (el) unwrap(el);
    };
  }, [marks, contentHtml, active, containerRef, contentHash]);

  // 切換筆記（noteId 變）→ 立即清空 Detached 回寫佇列與已回寫記錄，避免上一篇的
  // pending/inFlight/synced 污染下一篇（不倚賴後端 hash 巧合防跨筆記錯寫；顯式重置才可靠）。
  useEffect(() => {
    const sync = detachedSync.current;
    if (sync.timer != null) { window.clearTimeout(sync.timer); sync.timer = null; }
    sync.pending.clear();
    sync.inFlight.clear();
    sync.synced.clear();
  }, [noteId]);

  // 卸載時清掉 Detached 回寫的防抖計時器（不在上面的重套 cleanup 清，才能跨重繪維持防抖）。
  useEffect(() => {
    const sync = detachedSync.current;
    return () => {
      if (sync.timer != null) {
        window.clearTimeout(sync.timer);
        sync.timer = null;
      }
    };
  }, []);

  // 框選（mouseup）與 hover（mouseover/out）事件委派到容器。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;

    // 框選結束 → 跳出標註浮窗。用 pointerup（涵蓋滑鼠／觸控／觸控筆）而非 mouseup，
    // 否則手機/平板觸控時根本不觸發 → 行動裝置無法畫重點/做關聯/寫備註/提問。
    // 行動瀏覽器在 pointerup 當下「選取」有時尚未定案，故延後一拍再讀取。
    const onPointerUp = () => {
      window.setTimeout(() => {
        // 點到既有標註不視為新框選。
        const info = captureSelection(el);
        if (!info) return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        setHlMarkId(null); // 新的一次選取 → 下次選色建立新的重點
        setSel({ ...info, rect: range.getBoundingClientRect() });
      }, 0);
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

    // 觸控沒有 hover：點一下標註 → 顯示同一個浮窗（檢視關聯/備註、移除重點）；點到非標註處 → 收起。
    // 桌機照常以 hover（mouseover/out）為主，這個 click 只是補上觸控可達性，兩者不衝突。
    const onMarkTap = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest('[data-mark-id]') as HTMLElement | null;
      if (!target || !el.contains(target)) {
        setHover(null);
        return;
      }
      const ids: string[] = [];
      let cur: HTMLElement | null = target;
      while (cur && cur !== el) {
        const id = cur.getAttribute('data-mark-id');
        if (id) ids.push(id);
        cur = cur.parentElement;
      }
      if (ids.length === 0) {
        setHover(null);
        return;
      }
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setHover({ markIds: ids, rect: target.getBoundingClientRect() });
    };

    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    el.addEventListener('click', onMarkTap);
    return () => {
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
      el.removeEventListener('click', onMarkTap);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, [active, containerRef]);

  // 閱讀模式段落 hover「複製段落引用」（方案 C）：滑到 p/li/h1-h3 → 段落右上浮出 🔗 小鈕。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;

    const onOverBlock = (e: Event) => {
      const block = (e.target as HTMLElement)?.closest('p, li, h1, h2, h3') as HTMLElement | null;
      if (!block || !el.contains(block)) return;
      if (lastBlockRef.current === block) return; // 同段落內移動不重設
      const full = el.textContent ?? '';
      const elText = (block.textContent ?? '').trim();
      if (!elText) return;
      // 段落文字在容器純文字中的起點：以 Range 量到 block 之前的文字長度，再用內容比對微調前導空白。
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(block, 0);
      const rawStart = pre.toString().length;
      const probe = elText.slice(0, 40);
      const idx = full.indexOf(probe, rawStart);
      const start = idx >= 0 ? idx : rawStart;
      const text = elText.slice(0, 200); // 錨文字截 200 字（去重與跳轉都以此為準）
      lastBlockRef.current = block;
      setCopyRefBtn({ rect: block.getBoundingClientRect(), start, end: start + text.length, text });
    };

    const onLeaveBlock = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related?.closest('[data-note-copyref-btn]')) return; // 移到小鈕上 → 不收
      lastBlockRef.current = null;
      setCopyRefBtn(null);
    };

    el.addEventListener('mouseover', onOverBlock);
    el.addEventListener('mouseleave', onLeaveBlock);
    return () => {
      el.removeEventListener('mouseover', onOverBlock);
      el.removeEventListener('mouseleave', onLeaveBlock);
    };
  }, [active, containerRef]);

  /** 複製段落引用：在本篇建（或複用）該段的 anchor → 複製 zonwiki-mark:{noteId}:{markId} 字串。 */
  const copyParagraphRef = async () => {
    const info = copyRefBtn;
    if (!info) return;
    // 先確認剪貼簿可用再動作：否則會「建了 anchor 卻沒複製到」＝假成功＋殘留孤兒錨點。
    if (!navigator.clipboard) {
      showToast('此環境無法存取剪貼簿', { type: 'error' });
      return;
    }
    const full = containerRef.current?.textContent ?? '';
    const prefix = full.slice(Math.max(0, info.start - 24), info.start);
    const suffix = full.slice(info.end, info.end + 24);
    // 去重：以 anchorText 為鍵（不用位移——前文一經編輯，位移就漂掉、同段會被當新錨重建；復審實證）。
    const existing = marks.find((m) => m.kind === 'anchor' && m.anchorText === info.text);
    let markId = existing?.id;
    if (!markId) {
      const created = await createNoteMark(noteId, {
        kind: 'anchor',
        anchorText: info.text,
        anchorStart: info.start,
        anchorEnd: info.end,
        anchorPrefix: prefix,
        anchorSuffix: suffix,
      });
      if (!created) { showToast('建立段落引用失敗，請稍後再試', { type: 'error' }); return; }
      markId = created.id;
      await reload();
    }
    const ref = formatMarkRef(noteId, markId);
    try {
      await navigator.clipboard.writeText(ref);
      showToast('已複製段落引用', { type: 'success' });
    } catch {
      showToast(ref, { type: 'info', durationMs: 4000 }); // 剪貼簿被擋 → 直接秀字串供手動複製
    }
    lastBlockRef.current = null;
    setCopyRefBtn(null);
  };

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

  const addLink = async (
    targetType: string,
    targetId?: string,
    targetUrl?: string,
    targetMarkId?: string
  ) => {
    if (!sel) return;
    const payload: CreateNoteMarkInput = {
      kind: 'link',
      anchorText: sel.text, anchorStart: sel.start, anchorEnd: sel.end,
      anchorPrefix: sel.prefix, anchorSuffix: sel.suffix,
      targetType, targetId, targetUrl, targetMarkId,
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
      // 段落級關聯（有 targetMarkId）→ 帶 ?mark= 精準落在目標段落；否則整篇（落頁頂，既有行為）。
      const href = m.targetMarkId
        ? `${noteHref(m.targetSlug)}?mark=${encodeURIComponent(m.targetMarkId)}`
        : noteHref(m.targetSlug);
      router.push(href);
    } else if (m.targetType === 'taskcard') {
      // 在筆記頁就地開任務彈窗（不離開頁面）；筆記頁有監聽 zonwiki:open-task。
      if (m.targetId) {
        window.dispatchEvent(new CustomEvent('zonwiki:open-task', { detail: { taskId: m.targetId } }));
      } else {
        router.push(`/tasks`);
      }
    } else if (m.targetType === 'node') {
      router.push(`/canvas`);
    } else if (m.targetType === 'url' && m.targetUrl) {
      const u = m.targetUrl;
      if (/^https?:\/\//i.test(u)) {
        window.open(u, '_blank', 'noopener');
      } else {
        // 瀏覽器基於安全，不允許從網頁直接開啟 file:// 等本機協定（避免網頁存取你的檔案系統）。
        // 折衷：把連結複製到剪貼簿，請使用者自行貼到瀏覽器網址列開啟。
        navigator.clipboard?.writeText(u).then(
          () => showToast('已複製連結（瀏覽器安全限制無法直接開啟本機檔案，請貼到網址列開啟）', { type: 'info', durationMs: 3500 }),
          () => showToast(u, { type: 'info', durationMs: 4000 }),
        );
      }
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
      {/* 方案 C：閱讀模式段落 hover 浮出的「複製段落引用」🔗 小鈕（不干擾框選/標註）。 */}
      {copyRefBtn && createPortal(
        <button
          data-note-copyref-btn
          onClick={copyParagraphRef}
          title="複製段落引用（貼到別篇筆記的「關聯」搜尋框即可精準關聯此段）"
          style={{
            position: 'fixed',
            top: Math.max(8, copyRefBtn.rect.top + 2),
            left: Math.min(window.innerWidth - 34, copyRefBtn.rect.right - 30),
            zIndex: 3500, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)',
          }}
        >
          🔗
        </button>,
        document.body
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
                {m.detached && (
                  <span
                    title="此標註的錨點在目前內容中找不到（內容被編輯或刪除）"
                    style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--status-warning-fg, #d97706)' }}
                  >
                    ⚠ 失去定位
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
  onLink: (targetType: string, targetId?: string, targetUrl?: string, targetMarkId?: string) => void;
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
  // 關聯第二步（方案 A）：選定某篇筆記後，先渲染其預覽讓使用者點選「要關聯到哪個段落」。
  const [relateNote, setRelateNote] = useState<NoteDetail | null>(null);
  const [relateLoading, setRelateLoading] = useState(false);
  // 搜尋框貼上段落引用字串（zonwiki-mark:{noteId}:{markId}）時，直接以該錨點為段落目標。
  const pastedRef = parseMarkRef(q);

  /** 點選某篇筆記 → 進入第二步（取回目標筆記內容渲染預覽）。 */
  const enterRelateStep = async (targetNoteId: string) => {
    setRelateLoading(true);
    const note = await getNoteById(targetNoteId);
    setRelateLoading(false);
    if (note) setRelateNote(note);
    else showToast('無法載入目標筆記，改為關聯整篇', { type: 'error' });
    if (!note) onLink('note', targetNoteId); // 退化：載入失敗仍可整篇關聯
  };

  // 關聯：搜尋既有筆記/任務/節點。不預先列出——打了字才搜（避免一打開就一長串）。
  // 搜尋範圍由後端決定：筆記用標題、任務用 Title、開問啦節點用內容。
  useEffect(() => {
    if (tab !== 'link') return;
    const term = q.trim();
    // 空字串不搜（也不在 effect 內同步 setState，避免級聯重繪）；顯示端用 q 過濾陳舊候選。
    if (!term) return;
    let alive = true;
    const id = window.setTimeout(async () => {
      const res = await searchLinkCandidates('note', noteId, term);
      if (alive) setCands(res);
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [tab, q, noteId]);

  // 點/觸浮窗外關閉。用 pointerdown（涵蓋觸控）讓行動裝置也能點外面關閉。
  useEffect(() => {
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement)?.closest('[data-note-sel-popover]')) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  // 第二步（渲染目標筆記預覽）需要較寬的面板；其餘維持窄面板。
  const width = relateNote ? 440 : 280;
  const top = Math.min(window.innerHeight - 160, rect.bottom + 6);
  const left = Math.min(window.innerWidth - (width + 20), Math.max(8, rect.left));

  return createPortal(
    <div
      data-note-sel-popover
      style={{
        position: 'fixed', top, left, zIndex: 3600, width,
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        padding: 'var(--spacing-2)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)',
      }}
    >
      {relateNote ? (
        <RelateSecondStep
          target={relateNote}
          onBack={() => setRelateNote(null)}
          onWhole={() => onLink('note', relateNote.id)}
          onPickParagraph={(markId) => onLink('note', relateNote.id, undefined, markId)}
        />
      ) : (
      <>
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
          {/* 貼上段落引用字串 → 直接以該錨點為段落目標（方案 C 的接收端）。 */}
          {pastedRef && (
            <button
              onClick={() => onLink('note', pastedRef.noteId, undefined, pastedRef.markId)}
              title="偵測到段落引用：直接關聯到該段落"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
                textAlign: 'left', cursor: 'pointer', background: 'var(--accent-soft, var(--bg-surface-secondary, var(--bg-surface)))',
                border: '1px solid var(--accent, var(--border-default))', borderRadius: 'var(--radius-sm)',
                padding: '6px 8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', minHeight: 30,
              }}
              data-testid="note-link-pasted-ref"
            >
              <span style={{ flexShrink: 0 }}>🔗</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                引用段落（貼上的段落引用）
              </span>
            </button>
          )}
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* 只在有輸入時顯示候選；空字串時不顯示陳舊結果（effect 不同步清狀態）。最多顯示 8 筆，避免一次太多。 */}
            {(q.trim() && !pastedRef ? cands : []).slice(0, 8).map((c) => (
              <button
                key={`${c.type}-${c.id}`}
                onClick={() => (c.type === 'note' ? enterRelateStep(c.id) : onLink(c.type, c.id))}
                title={c.type === 'note'
                  ? `關聯到《${c.title}》：可再選段落或整篇`
                  : `關聯到此${TARGET_LABEL[c.type] ?? ''}：${c.title}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
                  textAlign: 'left', cursor: 'pointer', background: 'var(--bg-surface-secondary, var(--bg-surface))',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', minHeight: 30,
                }}
                data-testid="note-link-candidate"
              >
                <span style={{ flexShrink: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                  [{TARGET_LABEL[c.type] ?? c.type}]
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
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
              // 放行任意「scheme://」協定（http/https/file/ftp…），例如 file:///D:/...；
              // 注意：瀏覽器基於安全通常會擋住從網頁開啟 file://，但仍可儲存此關聯供記錄/複製。
              disabled={!/^[a-z][a-z0-9+.\-]*:\/\//i.test(url.trim())}
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

      {relateLoading && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
          載入目標筆記中…
        </div>
      )}
      </>
      )}
    </div>,
    document.body
  );
}

// ============================================================================
// 關聯第二步（方案 A）：渲染目標筆記預覽、hover 高亮段落、點選段落建立段落級關聯
// ============================================================================

/**
 * 建立關聯的第二步：在目標筆記的預覽上點選一個段落（p/li/h1-h3），
 * 以該段文字在目標筆記建 kind="anchor" 錨點，再由父層以此 targetMarkId 建 link；
 * 「🔗 關聯整篇」＝走現行整篇路徑；「← 換一篇」返回搜尋。
 */
function RelateSecondStep({
  target,
  onBack,
  onWhole,
  onPickParagraph,
}: {
  target: NoteDetail;
  onBack: () => void;
  onWhole: () => void;
  onPickParagraph: (targetMarkId: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);

  // 用「後端 RenderToHtml 的同一份 contentHtml」注入預覽（不用 react-markdown 重繪）：
  // 錨定座標系是「瀏覽器對 Markdig HTML 的 textContent」（見 docs/DECISIONS.md「瀏覽器為唯一座標系」）。
  // react-markdown 對原始 HTML 片段的處理與 Markdig 不同（丟棄 vs 轉義保留）＝第三套座標系，
  // 會讓「剛建立就死」的段落連結，故一律吃 contentHtml 與閱讀模式/存檔攔截完全同源。
  // React 19 識別陷阱：{__html} 物件必須 useMemo 固定，否則任何重繪都重注入 innerHTML 清掉 DOM 狀態。
  const previewHtml = useMemo(() => ({ __html: target.contentHtml ?? '' }), [target.contentHtml]);

  // 預覽容器內 hover 高亮 p/li/h1-h3（事件委派＋加/移 class，CSS 於 globals.css）。
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    let current: HTMLElement | null = null;
    const setHi = (block: HTMLElement | null) => {
      if (current === block) return;
      current?.classList.remove('relate-para-hover');
      block?.classList.add('relate-para-hover');
      current = block;
    };
    const onOver = (e: Event) => {
      const block = (e.target as HTMLElement)?.closest('p, li, h1, h2, h3') as HTMLElement | null;
      setHi(block && el.contains(block) ? block : null);
    };
    const onLeave = () => setHi(null);
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseleave', onLeave);
      setHi(null);
    };
  }, []);

  /** 點選預覽中的某段落 → 以該段文字在目標筆記建 anchor，再交父層建 link。 */
  const onPickBlock = async (e: React.MouseEvent) => {
    const el = previewRef.current;
    const block = (e.target as HTMLElement)?.closest('p, li, h1, h2, h3') as HTMLElement | null;
    if (!el || !block || !el.contains(block) || picking) return;

    const full = el.textContent ?? '';
    const elText = (block.textContent ?? '').trim();
    if (!elText) return;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(block, 0);
    const rawStart = pre.toString().length;
    const idx = full.indexOf(elText.slice(0, 40), rawStart);
    const start = idx >= 0 ? idx : rawStart;
    const text = elText.slice(0, 200);

    setPicking(true);
    const anchor = await createNoteMark(target.id, {
      kind: 'anchor',
      anchorText: text,
      anchorStart: start,
      anchorEnd: start + text.length,
      anchorPrefix: full.slice(Math.max(0, start - 24), start),
      anchorSuffix: full.slice(start + text.length, start + text.length + 24),
    });
    setPicking(false);
    if (!anchor) { showToast('建立段落錨點失敗，請改用「關聯整篇」', { type: 'error' }); return; }
    onPickParagraph(anchor.id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="tk-btn" style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={onBack} data-testid="relate-back">
          ← 換一篇
        </button>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.title}
        </span>
        <button className="tk-btn tk-btn--primary" style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={onWhole} data-testid="relate-whole">
          🔗 關聯整篇
        </button>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        點選下方段落＝精準關聯到該段；或按「關聯整篇」。
      </div>
      <div
        ref={previewRef}
        onClick={onPickBlock}
        className="markdown-prose relate-preview"
        style={{
          maxHeight: 320, overflowY: 'auto', cursor: 'pointer',
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
          padding: 'var(--spacing-2)', background: 'var(--bg-default)',
        }}
        data-testid="relate-preview"
        dangerouslySetInnerHTML={previewHtml}
      />
      {picking && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
          建立段落關聯中…
        </div>
      )}
    </div>
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

/**
 * 對容器套用所有標註（重點以 mark、連結/備註以 span；anchor 純錨點不視覺包裹）。
 * 回傳每個 mark 的 found（markId → 是否找得到錨點），供 Detached 回寫比對。
 */
function applyMarks(container: HTMLElement, marks: NoteMark[]): Map<string, boolean> {
  unwrap(container);
  const text = container.textContent ?? '';
  const foundMap = new Map<string, boolean>();

  // 先套重點（底色），再套連結/備註（底線/虛線），確保互不吃掉。
  for (const m of marks.filter((x) => x.kind === 'highlight')) {
    const r = reAnchor(text, m.anchorText, m.anchorStart, m.anchorPrefix, m.anchorSuffix);
    foundMap.set(m.id, r.found);
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
    foundMap.set(m.id, r.found);
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

  // anchor（段落級關聯的目標定位點）：不做視覺包裹，只算 found 供 Detached 回寫（斷了→backlinks 顯示失去定位）。
  for (const m of marks.filter((x) => x.kind === 'anchor')) {
    const r = reAnchor(text, m.anchorText, m.anchorStart, m.anchorPrefix, m.anchorSuffix);
    foundMap.set(m.id, r.found);
  }

  return foundMap;
}
