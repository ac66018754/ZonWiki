"use client";

import React from "react";
import Link from "next/link";
import type { NoteCategory } from "@/lib/api";
import { NOTE_DND_MIME } from "@/lib/constants";
import type { CatDrop, CatEditorState, SidebarTreeHandlers } from "./types";
import { NoteRow } from "./NoteRow";
import { CategoryEditor } from "./CategoryEditor";

/**
 * CategoryNode 的 props。
 *
 * `handlers` 為穩定的回呼與資料存取集合（由 Sidebar 記憶化）；其餘為分類樹的暫態檢視狀態，
 * 皆以「參考穩定」的方式傳入，讓 React.memo 能在與樹無關的父層重繪時略過整棵子樹。
 */
interface CategoryNodeProps {
  /** 本節點的分類。 */
  cat: NoteCategory;
  /** 縮排深度（最上層為 0）。 */
  depth: number;
  /** 穩定的回呼與資料存取集合。 */
  handlers: SidebarTreeHandlers;
  /** 收合中的分類 ID 集合。 */
  collapsed: Set<string>;
  /** 是否處於排序（拖曳）模式。 */
  sortMode: boolean;
  /** 正在拖曳的分類 ID。 */
  dragCatId: string | null;
  /** 分類拖曳目前的放置目標與落點區。 */
  catDrop: CatDrop | null;
  /** 筆記拖入時游標所在的分類 ID。 */
  noteDropCatId: string | null;
  /** 目前由網址選取的分類 ID（?categoryId）。 */
  selectedCategoryId: string | null;
  /** 目前閱讀的筆記所屬分類 ID 清單。 */
  activeNoteCats: string[];
  /** 目前筆記的路徑（用來高亮樹中的「檔案」）。 */
  currentNotePath: string;
  /** 目前開啟的分類編輯器狀態（決定要在哪個節點下就地顯示編輯器）。 */
  catEditor: CatEditorState | null;
}

/**
 * 遞迴渲染分類節點（無限階層）；展開後像 VS Code 一樣顯示「子分類（資料夾）＋筆記（檔案）」。
 *
 * 由原 Sidebar.renderNode 抽出為 React.memo 子元件（審查 finding #22）：邏輯與 JSX 一致，
 * 差別僅在資料存取與回呼改走 `handlers`、暫態狀態改走 props，並以 <CategoryNode> / <NoteRow>
 * 遞迴子元件取代原本的內嵌 render 函式，藉此讓「編輯器輸入 / 忙碌旗標 / 分頁切換」等與樹無關的
 * 父層狀態變更不再重建整棵樹。
 */
function CategoryNodeImpl(props: CategoryNodeProps): React.ReactElement {
  const {
    cat,
    depth,
    handlers,
    collapsed,
    sortMode,
    dragCatId,
    catDrop,
    noteDropCatId,
    selectedCategoryId,
    activeNoteCats,
    currentNotePath,
    catEditor,
  } = props;

  const {
    childrenOf,
    notesOf,
    descendantIds,
    dropZoneFromEvent,
    setDragCatId,
    setCatDrop,
    setNoteDropCatId,
    reparentCategory,
    reorderCategorySibling,
    handleDropNoteOnCategory,
    moveCategoryUp,
    moveCategoryDown,
    openEditCategory,
    openCategoryAction,
    handleDeleteCategory,
    toggleCollapse,
  } = handlers;

  const kids = childrenOf(cat.id);
  const catNotes = notesOf(cat.id);
  // 同層兄弟（供排序模式「↑/↓」按鈕判斷是否已在頭/尾）。
  const siblings = childrenOf(cat.parentId ?? null);
  const sibIdx = siblings.findIndex((c) => c.id === cat.id);
  const isFirstSibling = sibIdx <= 0;
  const isLastSibling = sibIdx >= siblings.length - 1;
  // 有子分類或底下有筆記 → 可展開（顯示三角形、點名稱可收合）。
  const expandable = kids.length > 0 || catNotes.length > 0;
  const isCollapsed = collapsed.has(cat.id);
  const isSelected = selectedCategoryId === cat.id;
  // 目前閱讀的筆記所屬分類（網址未帶 categoryId 時，用此標示目前位置）。
  const isCurrentNote = !selectedCategoryId && activeNoteCats.includes(cat.id);
  const highlighted = isSelected || isCurrentNote;

  // 是否要在本節點下就地顯示分類編輯器。
  const showEditorHere =
    !!catEditor &&
    ((catEditor.mode === "edit" && catEditor.id === cat.id) ||
      (catEditor.mode === "add" && catEditor.parentId === cat.id));

  return (
    <div>
      <div
        className={[
          "nt-row",
          sortMode ? "nt-row--draggable" : "",
          noteDropCatId === cat.id ? "nt-row--notedrop" : "",
          catDrop?.id === cat.id ? `nt-row--drop-${catDrop.zone}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: `${depth * 14}px` }}
        draggable={sortMode}
        onDragStart={
          sortMode
            ? (e) => {
                setDragCatId(cat.id);
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        onDragEnd={() => {
          setDragCatId(null);
          setCatDrop(null);
          setNoteDropCatId(null);
        }}
        onDragOver={(e) => {
          // (1) 來自筆記清單頁的「筆記拖入」——任何時候都可放（不限排序模式）
          if (e.dataTransfer.types.includes(NOTE_DND_MIME)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            setNoteDropCatId(cat.id);
            setCatDrop(null);
            return;
          }
          // (2) 分類拖曳（排序模式）——上＝插到前、下＝插到後、中＝變成子分類
          if (
            sortMode &&
            dragCatId &&
            dragCatId !== cat.id &&
            !descendantIds(dragCatId).has(cat.id)
          ) {
            e.preventDefault();
            e.stopPropagation();
            setCatDrop({ id: cat.id, zone: dropZoneFromEvent(e, e.currentTarget) });
            setNoteDropCatId(null);
          }
        }}
        onDragLeave={(e) => {
          // 只在離開「這一列本身」時清除高亮（避免子元素冒泡誤清）
          if (e.currentTarget === e.target) {
            if (noteDropCatId === cat.id) setNoteDropCatId(null);
            if (catDrop?.id === cat.id) setCatDrop(null);
          }
        }}
        onDrop={(e) => {
          // (1) 筆記拖入 → 把該筆記加入這個分類
          if (e.dataTransfer.types.includes(NOTE_DND_MIME)) {
            e.preventDefault();
            e.stopPropagation();
            const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
            setNoteDropCatId(null);
            if (noteId) handleDropNoteOnCategory(noteId, cat.id);
            return;
          }
          // (2) 分類拖曳放下 → 依落點調順序或變子分類
          if (
            sortMode &&
            dragCatId &&
            dragCatId !== cat.id &&
            !descendantIds(dragCatId).has(cat.id)
          ) {
            e.preventDefault();
            e.stopPropagation();
            const zone =
              catDrop?.id === cat.id ? catDrop.zone : dropZoneFromEvent(e, e.currentTarget);
            setCatDrop(null);
            setDragCatId(null);
            if (zone === "inside") reparentCategory(dragCatId, cat.id);
            else reorderCategorySibling(dragCatId, cat.id, zone);
          }
        }}
      >
        {sortMode && (
          <span
            className="nt-sort-controls"
            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
          >
            <span
              className="nt-drag-handle"
              title="桌機可拖曳：上下＝調順序、中間＝變子分類；手機請用右側按鈕"
            >
              ⠿
            </span>
            <button
              className="nt-sortbtn"
              title="上移"
              aria-label="上移此分類"
              disabled={isFirstSibling}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                moveCategoryUp(cat);
              }}
            >
              ↑
            </button>
            <button
              className="nt-sortbtn"
              title="下移"
              aria-label="下移此分類"
              disabled={isLastSibling}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                moveCategoryDown(cat);
              }}
            >
              ↓
            </button>
            {(cat.parentId ?? null) !== null && (
              <button
                className="nt-sortbtn"
                title="移到頂層（取消子分類）"
                aria-label="移到頂層"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  reparentCategory(cat.id, null);
                }}
              >
                ⤴
              </button>
            )}
          </span>
        )}
        {expandable ? (
          <button
            className="nt-caret"
            onClick={() => toggleCollapse(cat.id)}
            title={isCollapsed ? "展開" : "收合"}
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
        ) : (
          <span className="nt-caret nt-caret--spacer" />
        )}
        <Link
          href={`/notes?categoryId=${cat.id}`}
          prefetch
          className="nt-name"
          data-cat-id={cat.id}
          onClick={(e) => {
            if (sortMode) {
              e.preventDefault();
              return;
            }
            // 點分類名稱＝點左側三角形：切換展開/收合（同時照常導覽/篩選該分類）。
            if (expandable) toggleCollapse(cat.id);
          }}
          style={{
            fontWeight: highlighted ? 600 : 400,
            // 分類名稱用主要文字色（夜間 --text-secondary 的灰在深色底下對比太低、幾乎看不到）。
            color: highlighted ? "var(--action-secondary-fg)" : "var(--text-primary)",
            background: isCurrentNote ? "var(--action-secondary-bg)" : undefined,
            borderRadius: isCurrentNote ? "var(--radius-sm)" : undefined,
          }}
        >
          {isCurrentNote && (
            <span title="目前閱讀的筆記在此分類" style={{ marginRight: 2 }}>
              📍
            </span>
          )}
          <span className="nt-name-text">{cat.name}</span>
        </Link>
        {(cat.tags ?? []).slice(0, 1).map((t) => (
          <span key={t.id} className="nt-chip">
            #{t.name}
          </span>
        ))}
        <span className="nt-actions">
          <button title="編輯分類" onClick={() => openEditCategory(cat)}>
            ✎
          </button>
          <button
            title="新增（在此分類下新增筆記 / 新增子分類）"
            onClick={() => openCategoryAction(cat)}
          >
            ＋
          </button>
          <button title="刪除分類" onClick={() => handleDeleteCategory(cat)}>
            🗑
          </button>
        </span>
      </div>
      {showEditorHere && <CategoryEditor />}
      {!isCollapsed && (
        <>
          {/* 先列「子分類（資料夾）」，再列「本分類的筆記（檔案）」，與 VS Code 一致。 */}
          {kids.map((k) => (
            <CategoryNode
              key={k.id}
              cat={k}
              depth={depth + 1}
              handlers={handlers}
              collapsed={collapsed}
              sortMode={sortMode}
              dragCatId={dragCatId}
              catDrop={catDrop}
              noteDropCatId={noteDropCatId}
              selectedCategoryId={selectedCategoryId}
              activeNoteCats={activeNoteCats}
              currentNotePath={currentNotePath}
              catEditor={catEditor}
            />
          ))}
          {catNotes.map((note) => (
            <NoteRow
              key={`note-${note.id}`}
              note={note}
              depth={depth + 1}
              isActive={currentNotePath === `/notes/${note.slug}`}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * 記憶化的分類節點（見 CategoryNodeImpl 說明）。
 */
export const CategoryNode = React.memo(CategoryNodeImpl);
