'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TocItem } from '@/lib/toc';
import { useDraggable } from '@/hooks/useDraggable';

/**
 * 筆記章節目錄表（浮動、可自由拖曳、可關閉）。
 *
 * 與右下角工具列不同：本面板「可自由移動」（不固定在角落），且可關閉（✕）。
 * 關閉後可從右下角工具列的「📖 目錄」鈕重開，或重新整理頁面（預設開啟）。
 *
 * 功能：
 * - 列出筆記的 h1/h2/h3 章節（依層級縮排）。
 * - 顯示「閱讀進度」：已讀過（捲過）的章節、目前正在讀的章節、尚未讀到的章節以不同顏色標示，
 *   左側並有顏色條（已讀=綠、目前=主色、未讀=透明）。
 * - 點章節名稱＝平滑捲動到該標題（超連結般）。
 *
 * 進度追蹤以 IntersectionObserver 監看各標題在視窗中的位置（rootMargin 偏上，
 * 讓「目前章節」抓的是接近頂端、正在閱讀的那個）。
 */
export function TocPanel({
  noteId,
  toc,
  onClose,
}: {
  /** 筆記 ID（拿來當位置記憶的鍵，故每篇筆記各自記住面板位置）。 */
  noteId: string;
  /** 章節清單（已含錨點 id；由 buildToc 產生）。 */
  toc: TocItem[];
  /** 關閉面板（由父層管理開關狀態）。 */
  onClose: () => void;
}) {
  // 預設位置：左側（左側欄一帶）；不記憶位置，每次打開都回到這裡（避開頂端置頂工具列）。
  const defaultPos = useMemo(
    () => ({ x: 16, y: 84 }),
    [],
  );
  // persist:false → 不記憶位置，每次打開都用預設（右上角，不壓到左側欄）。
  const { pos, dragging, hydrated, panelRef, onPointerDown } = useDraggable(
    `toc-note-${noteId}`,
    defaultPos,
    { persist: false },
  );

  // 目前正在閱讀的章節 id（IntersectionObserver 追蹤）。
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);
  // 收合面板本體（只留標題列）；與「關閉」不同——收合仍在畫面上。
  const [collapsed, setCollapsed] = useState(false);

  // 閱讀進度：用「捲動位置」即時判斷目前章節（比 IntersectionObserver 可靠——
  // 筆記頁的捲動發生在內層容器 .note-detail-page，IO 以視窗為 root 時不一定觸發）。
  // 以 capture 監聽全域捲動，能收到內層捲動容器的事件；目前章節＝「最後一個頂端已捲過門檻」的標題。
  useEffect(() => {
    if (toc.length === 0) return;
    const ACTIVE_OFFSET = 96; // 標題頂端越過視窗上方這個距離，就算「正在讀 / 已讀過」
    const compute = () => {
      const headings = toc
        .map((t) => document.getElementById(t.id))
        .filter((el): el is HTMLElement => el !== null);
      if (headings.length === 0) return;
      let active = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) active = h.id;
        else break;
      }
      setActiveId(active);
    };
    compute();
    // capture:true → 即使捲動發生在內層 overflow 容器也收得到。
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [toc]);

  const activeIndex = toc.findIndex((t) => t.id === activeId);

  const scrollToHeading = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  if (toc.length === 0) return null;

  return (
    <div
      ref={panelRef}
      data-testid="note-toc-panel"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        width: 270,
        maxHeight: 'min(70vh, 640px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: dragging ? 'var(--shadow-lg)' : 'var(--shadow-md)',
        zIndex: 1300,
        overflow: 'hidden',
        visibility: hydrated ? 'visible' : 'hidden',
        userSelect: 'none',
      }}
    >
      {/* 標題列（＝拖曳把手） */}
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px 6px 10px',
          cursor: 'move',
          background: 'var(--bg-surface-secondary, rgba(0,0,0,0.04))',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14 }}>📑</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          章節目錄表
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? '展開' : '收合'}
          style={tocIconBtn}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <button
          type="button"
          onClick={onClose}
          title="關閉（可從右下角工具列「📖 目錄」重開）"
          data-testid="note-toc-close"
          style={tocIconBtn}
        >
          ✕
        </button>
      </div>

      {/* 章節清單 */}
      {!collapsed && (
        <div
          style={{
            overflowY: 'auto',
            padding: '4px 0',
            // 拖曳時暫時關閉內部捲動指標，避免與拖曳衝突。
            pointerEvents: dragging ? 'none' : 'auto',
          }}
        >
          {toc.map((item, index) => {
            // 閱讀進度狀態：目前 / 已讀（在目前之前）/ 未讀（在目前之後）。
            const state: 'current' | 'past' | 'future' =
              index === activeIndex ? 'current' : activeIndex >= 0 && index < activeIndex ? 'past' : 'future';
            const railColor =
              state === 'current'
                ? 'var(--action-primary-bg, #2563eb)'
                : state === 'past'
                  ? 'var(--status-success-fg, #16a34a)'
                  : 'transparent';
            const textColor =
              state === 'current'
                ? 'var(--action-secondary-fg)'
                : state === 'past'
                  ? 'var(--text-secondary)'
                  : 'var(--text-tertiary)';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToHeading(item.id)}
                title={item.text}
                data-level={item.level}
                data-state={state}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderLeft: `3px solid ${railColor}`,
                  background: state === 'current' ? 'var(--action-secondary-bg)' : 'transparent',
                  color: textColor,
                  cursor: 'pointer',
                  fontSize: item.level === 1 ? 'var(--text-sm)' : 'var(--text-xs)',
                  fontWeight: item.level === 1 ? 700 : state === 'current' ? 600 : 400,
                  lineHeight: 1.4,
                  padding: '4px 8px',
                  paddingLeft: 8 + (item.level - 1) * 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.text}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 標題列上的小圖示按鈕樣式。 */
const tocIconBtn: React.CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  borderRadius: 'var(--radius-sm)',
};
