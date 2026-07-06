"use client";

import React from "react";
import Link from "next/link";
import type { NoteTag } from "@/lib/api";

/**
 * 標籤排序拖曳的落點區（標籤是平的，只有前 / 後）。
 */
type TagDropZone = "before" | "after";

/**
 * 標籤編輯器（新增 / 編輯）的開啟狀態。
 */
interface TagEditorState {
  mode: "add" | "edit";
  id?: string;
}

/**
 * TagList 的 props。標籤是平的清單，故不像分類樹需要記憶化；
 * 由原 Sidebar 的標籤分頁抽出（審查 finding #22 拆檔），行為與 JSX 一致。
 */
interface TagListProps {
  /** 全部標籤。 */
  tags: NoteTag[];
  /** 是否處於排序（拖曳）模式。 */
  sortMode: boolean;
  /** 目前由網址選取的標籤 ID（?tagId）。 */
  selectedTagId: string | null;
  /** 正在拖曳的標籤 ID。 */
  dragTagId: string | null;
  /** 標籤拖曳目前的放置目標與落點區。 */
  tagDrop: { id: string; zone: TagDropZone } | null;
  /** 目前開啟的標籤編輯器狀態。 */
  tagEditor: TagEditorState | null;
  /** 標籤名稱輸入值。 */
  tagNameInput: string;
  /** 是否正在儲存中。 */
  busy: boolean;
  /** 設定正在拖曳的標籤 ID。 */
  setDragTagId: (id: string | null) => void;
  /** 設定標籤拖曳的放置目標與落點區。 */
  setTagDrop: (drop: { id: string; zone: TagDropZone } | null) => void;
  /** 把被拖標籤插到目標標籤前 / 後（調順序）。 */
  reorderTagSibling: (dragId: string, targetId: string, zone: TagDropZone) => void;
  /** 把標籤往上移一位。 */
  moveTagUp: (tagId: string) => void;
  /** 把標籤往下移一位。 */
  moveTagDown: (tagId: string) => void;
  /** 開啟「編輯標籤」編輯器。 */
  openEditTag: (tag: NoteTag) => void;
  /** 刪除標籤（軟刪除，經確認）。 */
  handleDeleteTag: (tag: NoteTag) => void;
  /** 設定標籤名稱輸入值。 */
  setTagNameInput: (value: string) => void;
  /** 儲存標籤。 */
  saveTag: () => void;
  /** 關閉標籤編輯器。 */
  closeTagEditor: () => void;
}

/**
 * 側欄「標籤」分頁：可就地新增 / 編輯 / 刪除、排序模式下可拖曳或用按鈕調順序。
 */
export function TagList(props: TagListProps): React.ReactElement {
  const {
    tags,
    sortMode,
    selectedTagId,
    dragTagId,
    tagDrop,
    tagEditor,
    tagNameInput,
    busy,
    setDragTagId,
    setTagDrop,
    reorderTagSibling,
    moveTagUp,
    moveTagDown,
    openEditTag,
    handleDeleteTag,
    setTagNameInput,
    saveTag,
    closeTagEditor,
  } = props;

  // 標籤編輯器（新增/編輯共用）。
  const renderTagEditor = () => (
    <div className="nt-editor">
      <input
        className="nt-input"
        value={tagNameInput}
        onChange={(e) => setTagNameInput(e.target.value)}
        placeholder="標籤名稱"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") saveTag();
        }}
      />
      <div className="nt-editor-actions">
        <button className="nt-btn nt-btn-primary" onClick={saveTag} disabled={busy}>
          {busy ? "儲存中…" : "儲存"}
        </button>
        <button className="nt-btn" onClick={closeTagEditor} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );

  return (
    <div data-testid="tag-list">
      {sortMode && tags.length >= 2 && (
        <div className="nt-sort-hint">
          排序模式：拖曳標籤調整順序（上半＝插到前、下半＝插到後）。
        </div>
      )}
      {tagEditor && tagEditor.mode === "add" && renderTagEditor()}
      {tags.map((tag, tagIdx) => {
        const isSelected = selectedTagId === tag.id;
        return (
          <div key={tag.id}>
            <div
              className={[
                "nt-row",
                sortMode ? "nt-row--draggable" : "",
                tagDrop?.id === tag.id ? `nt-row--drop-${tagDrop.zone}` : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={sortMode}
              onDragStart={
                sortMode
                  ? (e) => {
                      setDragTagId(tag.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onDragEnd={() => {
                setDragTagId(null);
                setTagDrop(null);
              }}
              onDragOver={
                sortMode && dragTagId && dragTagId !== tag.id
                  ? (e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const zone =
                        e.clientY - rect.top < rect.height / 2 ? "before" : "after";
                      setTagDrop({ id: tag.id, zone });
                    }
                  : undefined
              }
              onDrop={
                sortMode && dragTagId && dragTagId !== tag.id
                  ? (e) => {
                      e.preventDefault();
                      const zone = tagDrop?.id === tag.id ? tagDrop.zone : "after";
                      const dragged = dragTagId;
                      setTagDrop(null);
                      setDragTagId(null);
                      reorderTagSibling(dragged, tag.id, zone);
                    }
                  : undefined
              }
            >
              {sortMode ? (
                <span
                  className="nt-sort-controls"
                  style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                >
                  <span
                    className="nt-drag-handle"
                    title="桌機可拖曳調整順序；手機請用右側按鈕"
                  >
                    ⠿
                  </span>
                  <button
                    className="nt-sortbtn"
                    title="上移"
                    aria-label="上移此標籤"
                    disabled={tagIdx <= 0}
                    onClick={(e) => {
                      e.preventDefault();
                      moveTagUp(tag.id);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="nt-sortbtn"
                    title="下移"
                    aria-label="下移此標籤"
                    disabled={tagIdx >= tags.length - 1}
                    onClick={(e) => {
                      e.preventDefault();
                      moveTagDown(tag.id);
                    }}
                  >
                    ↓
                  </button>
                </span>
              ) : (
                <span className="nt-caret nt-caret--spacer" />
              )}
              <Link
                href={`/notes?tagId=${tag.id}`}
                prefetch
                className="nt-name"
                onClick={sortMode ? (e) => e.preventDefault() : undefined}
                style={{
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? "var(--action-secondary-fg)" : "var(--text-secondary)",
                }}
              >
                <span className="nt-name-text">#{tag.name}</span>
                <span className="nt-count">{tag.noteCount}</span>
              </Link>
              <span className="nt-actions">
                <button title="編輯標籤" onClick={() => openEditTag(tag)}>
                  ✎
                </button>
                <button title="刪除標籤" onClick={() => handleDeleteTag(tag)}>
                  🗑
                </button>
              </span>
            </div>
            {tagEditor && tagEditor.mode === "edit" && tagEditor.id === tag.id && renderTagEditor()}
          </div>
        );
      })}
      {tags.length === 0 && <p className="nt-muted">還沒有標籤，點上方「＋ 新增」。</p>}
    </div>
  );
}
