"use client";

import React from "react";
import Link from "next/link";
import type { NoteSummary } from "@/lib/api";

/**
 * NoteRow 的 props。
 */
interface NoteRowProps {
  /** 要顯示的筆記。 */
  note: NoteSummary;
  /** 縮排深度（比所屬分類深一層）。 */
  depth: number;
  /** 是否為目前正在閱讀的筆記（用於高亮）。 */
  isActive: boolean;
}

/**
 * 側欄分類樹中的一列「筆記（檔案）」：點擊即開啟該筆記。
 *
 * 以 React.memo 包裝：props 為穩定的 note / depth / isActive，因此父層因與此列無關的狀態
 * 重繪時（如編輯器輸入、拖曳其他分類）本列會被略過，不再隨整棵樹重建（審查 finding #22）。
 * JSX 與原 Sidebar.renderNoteRow 一致。
 */
function NoteRowImpl({ note, depth, isActive }: NoteRowProps): React.ReactElement {
  return (
    <div className="nt-row nt-row--note" style={{ paddingLeft: `${depth * 14}px` }}>
      <span className="nt-caret nt-caret--spacer" />
      <Link
        href={`/notes/${note.slug}`}
        prefetch
        className="nt-name nt-name--note"
        title={note.title}
        style={{
          fontWeight: isActive ? 600 : 400,
          color: isActive ? "var(--action-secondary-fg)" : "var(--text-secondary)",
          background: isActive ? "var(--action-secondary-bg)" : undefined,
          borderRadius: isActive ? "var(--radius-sm)" : undefined,
        }}
      >
        <span aria-hidden="true" style={{ marginRight: 4, opacity: 0.7 }}>
          📄
        </span>
        <span className="nt-name-text">{note.title || "(無標題筆記)"}</span>
      </Link>
    </div>
  );
}

/**
 * 記憶化的筆記列（見 NoteRowImpl 說明）。
 */
export const NoteRow = React.memo(NoteRowImpl);
