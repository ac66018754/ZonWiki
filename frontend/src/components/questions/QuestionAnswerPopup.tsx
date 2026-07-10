'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { askNoteQuestion, updateNoteOverlay } from '@/lib/api/notes';

/**
 * 模組層級的 z-index 計數器：讓「最後被點到的彈窗」浮到最上層（多開時的疊放順序）。
 * 起始 2000（高於釘住便利貼的 1100+，低於確認框的 4000，確保未存守門確認框永遠蓋在彈窗之上）。
 */
let popupZCounter = 2000;

/**
 * 答題彈窗的屬性。
 */
interface QuestionAnswerPopupProps {
  /** 問題（浮層元件）識別碼——儲存回答時的目標。 */
  itemId: string;
  /** 所屬筆記識別碼——請 AI 回答時的脈絡來源。 */
  noteId: string;
  /** 浮層型別（sticky 顯示「標題＋內文」；text 只顯示內文）。 */
  kind: 'sticky' | 'text';
  /** 問題顯示標題（sticky 用；供彈窗標題列與問題框標頭）。 */
  questionTitle: string;
  /** 問題完整文字。 */
  questionText: string;
  /** 回答的初始值（item 目前的 questionAnswer）。 */
  initialAnswer: string;
  /** 第幾個彈窗（供初始位置階梯錯開，避免完全重疊）。 */
  offsetIndex: number;
  /** 關閉彈窗（由呼叫端移除此彈窗）。 */
  onClose: () => void;
  /** 儲存成功後回呼（帶最新回答值，供上層更新「已答」徽章）。 */
  onSaved: (answer: string) => void;
}

/**
 * 答題彈窗：可拖曳的浮動小視窗（似便利貼但有關閉鈕；狀態只存 React、刷新即消失、可同時開多個）。
 *
 * 內含「問題」（唯讀）與「回答」（可編輯）兩區，支援：
 * - 🤖 請 AI 回答：以整篇筆記為脈絡非同步提問，完成後「覆蓋」回答框內容；
 * - Ctrl+Z：還原「AI 覆蓋前」的內容（僅在值仍等於 AI 覆蓋結果時攔截，否則交給原生 undo）；
 * - 儲存：寫回浮層元件的 questionAnswer；
 * - 未存關閉守門：回答有未儲存變更時按 ✕ 會先在「本彈窗內部」跳一層確認（不走全站單例
 *   ConfirmProvider）——因本功能可同時開多個答題彈窗，共用單一 resolver 會互相覆蓋而卡死，
 *   故每個彈窗實例各自持有獨立的確認狀態。
 */
export function QuestionAnswerPopup({
  itemId,
  noteId,
  kind,
  questionTitle,
  questionText,
  initialAnswer,
  offsetIndex,
  onClose,
  onSaved,
}: QuestionAnswerPopupProps) {
  // 目前回答值 / 最後一次儲存的基準值（用來判斷 dirty）。
  const [answer, setAnswer] = useState(initialAnswer);
  const [savedAnswer, setSavedAnswer] = useState(initialAnswer);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // 「未存離開」的本彈窗內部確認層是否顯示（各實例獨立，不共用全站單例）。
  const [confirmingClose, setConfirmingClose] = useState(false);

  // AI 覆蓋前的快照（用於 Ctrl+Z 還原）：{ before: 覆蓋前, after: 覆蓋後 }。
  const aiSnapshotRef = useRef<{ before: string; after: string } | null>(null);

  // 元件是否仍掛載：非同步（請 AI 回答）完成後，避免對已卸載元件 setState。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 彈窗位置（fixed，視窗座標）；初始置中偏上並依 offsetIndex 階梯錯開。
  const [pos, setPos] = useState(() => {
    const step = offsetIndex * 24;
    if (typeof window === 'undefined') return { x: 120 + step, y: 100 + step };
    return {
      x: Math.max(12, window.innerWidth / 2 - 190 + step),
      y: Math.max(12, 96 + step),
    };
  });
  const [z, setZ] = useState(() => ++popupZCounter);

  const dirty = answer !== savedAnswer;

  /** 把此彈窗浮到最上層（點擊任一處時）。 */
  const bringToFront = () => setZ(++popupZCounter);

  /** 標題列拖曳移動（視窗座標，夾在畫面內至少保留標題列可抓）。 */
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    bringToFront();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = pos.x;
    const oy = pos.y;
    const onMove = (ev: PointerEvent) => {
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 32;
      setPos({
        x: Math.min(maxX, Math.max(0, ox + (ev.clientX - sx))),
        y: Math.min(maxY, Math.max(0, oy + (ev.clientY - sy))),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 請 AI 回答：完成後「覆蓋」回答框並記錄 undo 快照；失敗顯示錯誤、不覆蓋。 */
  const handleAskAi = async () => {
    setAiLoading(true);
    setErrorText(null);
    try {
      const result = await askNoteQuestion(noteId, questionText);
      if (!mountedRef.current) return; // 等待期間彈窗已關閉 → 不再 setState
      if (result == null || result.trim() === '') {
        setErrorText('AI 沒有回覆內容，請稍後再試。');
        return;
      }
      const before = answer;
      aiSnapshotRef.current = { before, after: result };
      setAnswer(result);
    } catch {
      if (mountedRef.current) setErrorText('請 AI 回答失敗，請稍後再試。');
    } finally {
      if (mountedRef.current) setAiLoading(false);
    }
  };

  /** 回答框 Ctrl+Z：只在「值仍等於 AI 覆蓋結果」時還原覆蓋前內容，否則交給原生 undo。 */
  const handleAnswerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    if (!isUndo) return;
    const snap = aiSnapshotRef.current;
    if (snap && answer === snap.after) {
      e.preventDefault();
      setAnswer(snap.before);
      aiSnapshotRef.current = null;
    }
    // 否則不攔截：讓 textarea 原生 undo 生效。
  };

  /** 儲存回答：寫回浮層元件，成功後更新基準值與「已答」徽章。 */
  const handleSave = async () => {
    setSaving(true);
    setErrorText(null);
    try {
      const ok = await updateNoteOverlay(itemId, { questionAnswer: answer });
      if (ok) {
        setSavedAnswer(answer);
        onSaved(answer);
      } else {
        setErrorText('儲存失敗，請重試。');
      }
    } catch {
      setErrorText('儲存失敗，請重試。');
    } finally {
      setSaving(false);
    }
  };

  /** 關閉：有未存變更時先在本彈窗內部跳一層確認（未存守門）；無變更直接關閉。 */
  const handleClose = () => {
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  // 彈窗僅在使用者按「答」後（客戶端）渲染，不會出現在 SSR 初始 HTML，故可直接 portal 到 body。
  if (typeof document === 'undefined') return null;

  const busy = saving || aiLoading;

  return createPortal(
    <div
      role="dialog"
      aria-label="問題答題彈窗"
      onPointerDown={bringToFront}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: 380,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: z,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
        overflow: 'hidden',
      }}
    >
      {/* 標題列（可拖曳） */}
      <div
        onPointerDown={startDrag}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          padding: 'var(--spacing-2) var(--spacing-3)',
          cursor: 'move',
          background: 'var(--action-secondary-bg, rgba(0,0,0,0.06))',
          color: 'var(--action-secondary-fg, var(--text-primary))',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ❓ {questionTitle || '問題'}
        </span>
        <button
          type="button"
          onClick={handleClose}
          onPointerDown={(e) => e.stopPropagation()}
          title="關閉"
          aria-label="關閉"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            fontSize: 'var(--text-md)',
            lineHeight: 1,
            padding: 2,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* 內容 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', padding: 'var(--spacing-3)' }}>
        {/* 問題（唯讀） */}
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>問題</label>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
            background: 'var(--bg-subtle, var(--bg-muted, rgba(0,0,0,0.03)))',
            border: '1px solid var(--border-subtle, var(--border-default))',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-2)',
            maxHeight: 140,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.7,
          }}
        >
          {kind === 'sticky' && questionTitle && questionTitle !== questionText && (
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{questionTitle}</div>
          )}
          {questionText || '(無內容)'}
        </div>

        {/* 回答（可編輯） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label htmlFor={`answer-${itemId}`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>回答</label>
          <button
            type="button"
            onClick={handleAskAi}
            disabled={busy}
            className="btn-secondary"
            style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', minHeight: 0 }}
            title="以整篇筆記為脈絡請 AI 回答（會覆蓋目前回答，可用 Ctrl+Z 還原）"
          >
            {aiLoading ? '⏳ AI 回答中…' : '🤖 請 AI 回答'}
          </button>
        </div>
        <textarea
          id={`answer-${itemId}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleAnswerKeyDown}
          placeholder="在這裡手寫回答，或按「🤖 請 AI 回答」…"
          rows={6}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontSize: 'var(--text-sm)',
            lineHeight: 1.7,
            color: 'var(--text-primary)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-2)',
            fontFamily: 'inherit',
          }}
        />

        {errorText && (
          <div role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--action-danger-fg, var(--color-danger, #dc2626))' }}>
            {errorText}
          </div>
        )}

        {/* 動作列 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-1)' }}>
          <button type="button" onClick={handleClose} className="btn-secondary" style={{ minHeight: 0 }}>
            關閉
          </button>
          <button type="button" onClick={handleSave} disabled={busy || !dirty} className="btn-primary" style={{ minHeight: 0 }}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>

      {/* 未存離開確認層（本彈窗內部、覆蓋整個彈窗；各實例獨立，不共用全站單例 ConfirmProvider）。 */}
      {confirmingClose && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="離開確認"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10, // 蓋過彈窗內容（內容為一般流、無自訂 z-index）
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--spacing-3)',
            background: 'rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 300,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-3)',
              padding: 'var(--spacing-3)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
            }}
          >
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.7 }}>
              回答尚未儲存，離開將遺失內容。確定離開？
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="btn-secondary"
                style={{ minHeight: 0 }}
              >
                留下
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  onClose();
                }}
                className="btn-danger"
                style={{ minHeight: 0 }}
              >
                放棄離開
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
