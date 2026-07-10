"use client";

import React from "react";
import Link from "next/link";
import type { NoteSummary } from "@/lib/api";
import { NOTE_DND_MIME } from "@/lib/constants";

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
 * 拖曳歸類：本列可被拖曳，攜帶 <see cref="NOTE_DND_MIME"/>（筆記 ID）——放到左側任一分類列即把此筆記
 * 「加入」該分類（一篇筆記可同時屬於多個分類，來源分類保留；drop 端邏輯見 CategoryNode）。與筆記清單頁
 * 的卡片同一套拖放協定，故側欄內、清單頁皆可作為拖曳來源。HTML5 拖曳與點擊互斥（純點擊仍照常開啟筆記）。
 *
 * 以 React.memo 包裝：props 為穩定的 note / depth / isActive，因此父層因與此列無關的狀態
 * 重繪時（如編輯器輸入、拖曳其他分類）本列會被略過，不再隨整棵樹重建（審查 finding #22）。
 */
function NoteRowImpl({ note, depth, isActive }: NoteRowProps): React.ReactElement {
  return (
    <div className="nt-row nt-row--note" style={{ paddingLeft: `${depth * 14}px` }}>
      <span className="nt-caret nt-caret--spacer" />
      <Link
        href={`/notes/${note.slug}`}
        prefetch
        draggable
        className="nt-name nt-name--note"
        title={note.title}
        onDragStart={(e) => {
          // 攜帶筆記 ID，供左側分類列接收（把此筆記加入該分類）。與清單頁卡片同一套協定。
          e.dataTransfer.setData(NOTE_DND_MIME, note.id);
          e.dataTransfer.effectAllowed = "copyMove";
        }}
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
