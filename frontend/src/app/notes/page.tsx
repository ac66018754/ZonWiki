'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  listNotes,
  listNoteCategories,
  listNoteTags,
  createNoteTag,
  addNoteTag,
  removeNoteTag,
  type NoteSummary,
  type NoteCategory,
  type NoteTag,
  type CurrentUser,
  getCurrentUser,
} from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { DEFAULT_TIMEZONE, NOTE_DND_MIME } from '@/lib/constants';
import { SkeletonListItem } from '@/components/Skeleton';
import { NotesBatchToolbar } from './components/NotesBatchToolbar';

/** localStorage 鍵：編輯模式開關（重整／斷線都不關閉，只有再次按鈕才關）。 */
const LS_EDIT_MODE = 'zonwiki:notesEditMode';
/** localStorage 鍵：本次編輯模式的「批次標籤」ID（選取狀態的持久化來源＝該標籤成員）。 */
const LS_BATCH_TAG = 'zonwiki:notesBatchTagId';

/** 產生批次標籤名稱（含本機時戳，作為這群筆記的永久關聯）。 */
function makeBatchTagName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `批次 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 筆記清單頁面（主內容區只負責「所選分類／標籤的筆記清單」）
 *
 * 分類樹、標籤、就地管理與「新增筆記」按鈕都在左側固定側欄（Sidebar.tsx）；
 * 本頁僅依網址查詢字串（?categoryId / ?tagId）顯示對應的筆記。
 *
 * 編輯模式（#5）：開啟後每篇筆記左側出現勾選框，可批次刪除／加入分類／加入標籤。
 * - 編輯模式狀態存 localStorage，重整／斷線都不關閉，只有再次按「編輯模式」才關。
 * - 選取狀態以「批次標籤」承載：首次勾選自動建立一個時戳標籤並把該筆記加入，取消勾選則移除；
 *   故即使意外重整，回到清單時仍能依標籤成員還原勾選，且這群筆記也獲得一個永久關聯。
 */
export default function NotesPage() {
  const searchParams = useSearchParams();
  const selectedCategoryId = searchParams.get('categoryId');
  const selectedTagId = searchParams.get('tagId');

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 排序：最後打開 / 最後編輯 / 建立 時間，可正逆序；預設＝最後打開、逆序（最近打開在最前）。
  const [sortBy, setSortBy] = useState<'opened' | 'updated' | 'created'>('opened');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // 依排序設定產生顯示用清單（前端排序；無該時間者排最後）。
  const sortedNotes = useMemo(() => {
    const keyOf = (n: NoteSummary) => {
      const v =
        sortBy === 'opened'
          ? n.lastOpenedDateTime
          : sortBy === 'created'
            ? n.createdDateTime
            : n.updatedDateTime;
      return v ? new Date(v).getTime() : 0;
    };
    const arr = [...notes].sort((a, b) => keyOf(a) - keyOf(b));
    return sortDir === 'desc' ? arr.reverse() : arr;
  }, [notes, sortBy, sortDir]);

  // 編輯模式 + 本次批次標籤（皆持久化於 localStorage）
  const [editMode, setEditMode] = useState(false);
  const [batchTagId, setBatchTagId] = useState<string | null>(null);
  // 勾選/取消時避免重複點擊
  const [toggling, setToggling] = useState(false);

  // 掛載後從 localStorage 還原編輯模式與批次標籤（避免 SSR/水合不一致，故放 effect）。
  useEffect(() => {
    setEditMode(localStorage.getItem(LS_EDIT_MODE) === '1');
    setBatchTagId(localStorage.getItem(LS_BATCH_TAG));
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [currentUser, notesList, catList, tagList] = await Promise.all([
        getCurrentUser(),
        listNotes({
          categoryId: selectedCategoryId || undefined,
          tagId: selectedTagId || undefined,
        }),
        listNoteCategories(),
        listNoteTags(),
      ]);
      setUser(currentUser);
      setNotes(notesList);
      setCategories(catList);
      setTags(tagList);
      setError(null);
    } catch {
      setError('無法載入筆記清單，請稍後重試。');
    } finally {
      setLoading(false);
    }
  }, [selectedCategoryId, selectedTagId]);

  useEffect(() => {
    load();
  }, [load]);

  // 監聽「筆記被拖入某分類」事件（由側欄發出）→ 重新載入，更新分類筆記數與目前篩選
  useEffect(() => {
    const onCategorized = () => load();
    window.addEventListener('zonwiki:note-categorized', onCategorized);
    return () => window.removeEventListener('zonwiki:note-categorized', onCategorized);
  }, [load]);

  const formatNoteDateTime = (dateStr: string) =>
    formatDateTime(dateStr, user?.timeZone || DEFAULT_TIMEZONE);

  // 目前選取的筆記（＝批次標籤成員、且在目前清單可見）。
  const selectedNotes = useMemo(
    () =>
      editMode && batchTagId
        ? notes.filter((n) => (n.tags ?? []).some((t) => t.id === batchTagId))
        : [],
    [editMode, batchTagId, notes]
  );
  const selectedIdSet = useMemo(() => new Set(selectedNotes.map((n) => n.id)), [selectedNotes]);

  /** 切換編輯模式。關閉時清掉本次批次標籤（下次開啟重新建立一組）；標籤本身保留在 DB。 */
  const toggleEditMode = () => {
    setEditMode((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem(LS_EDIT_MODE, '1');
      } else {
        localStorage.removeItem(LS_EDIT_MODE);
        localStorage.removeItem(LS_BATCH_TAG);
        setBatchTagId(null);
      }
      return next;
    });
  };

  /** 勾選 / 取消勾選某筆記（＝把該筆記加入 / 移出批次標籤）。 */
  const toggleSelect = async (note: NoteSummary) => {
    if (toggling) return;
    setToggling(true);
    try {
      const currentlySelected = selectedIdSet.has(note.id);
      if (!currentlySelected) {
        // 確保批次標籤存在（首次勾選才建立）。
        let tagId = batchTagId;
        let tagName = '';
        if (!tagId) {
          const created = await createNoteTag(makeBatchTagName());
          if (!created) return;
          tagId = created.id;
          tagName = created.name;
          setBatchTagId(tagId);
          localStorage.setItem(LS_BATCH_TAG, tagId);
          setTags((prev) => [...prev, created]);
        } else {
          tagName = tags.find((t) => t.id === tagId)?.name ?? '批次';
        }
        // 用「原子加單一標籤」端點，不需先讀目前標籤再整組送 → 不會覆蓋他處對此筆記標籤的變更。
        const ok = await addNoteTag(note.id, tagId);
        if (!ok) return;
        const tid = tagId;
        setNotes((prev) =>
          prev.map((n) =>
            n.id === note.id ? { ...n, tags: [...(n.tags ?? []), { id: tid, name: tagName }] } : n
          )
        );
      } else {
        const tid = batchTagId;
        if (!tid) return;
        // 原子移除單一標籤（同上，避免讀-改-寫競態）。
        const ok = await removeNoteTag(note.id, tid);
        if (!ok) return;
        setNotes((prev) =>
          prev.map((n) =>
            n.id === note.id ? { ...n, tags: (n.tags ?? []).filter((t) => t.id !== tid) } : n
          )
        );
      }
    } finally {
      setToggling(false);
    }
  };

  // 目前所選分類底下的「子分類」（供右側在筆記清單下方列出，可點擊鑽入）
  const childCategories = selectedCategoryId
    ? categories.filter((c) => (c.parentId ?? null) === selectedCategoryId)
    : [];

  // 目前篩選的名稱（顯示在標題旁，讓使用者知道正在看哪個分類／標籤）
  const activeFilterLabel = (() => {
    if (selectedCategoryId) {
      const cat = categories.find((c) => c.id === selectedCategoryId);
      return cat ? `分類：${cat.name}` : null;
    }
    if (selectedTagId) {
      const tag = tags.find((t) => t.id === selectedTagId);
      return tag ? `標籤：#${tag.name}` : null;
    }
    return null;
  })();

  if (loading) {
    return (
      <div className="notes-page">
        <div className="notes-page__container">
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      </div>
    );
  }

  return (
    <div className="notes-page">
      <div className="notes-page__container">
        {/* 置頂列（#6 sticky）：筆記數 + 目前篩選 + 編輯模式鈕 + 批次工具列 */}
        <div className="notes-stickyhead">
          <div className="notes-headrow">
            <div>
              <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700 }}>筆記</h1>
              <p
                style={{
                  margin: 'var(--spacing-2) 0 0 0',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  gap: 'var(--spacing-3)',
                  alignItems: 'center',
                }}
              >
                <span>{notes.length} 篇筆記</span>
                {activeFilterLabel && (
                  <span
                    style={{
                      padding: '2px 10px',
                      background: 'var(--action-secondary-bg)',
                      color: 'var(--action-secondary-fg)',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {activeFilterLabel}
                  </span>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* 排序方式（建立 / 最後編輯 / 最後打開）+ 方向 */}
              <select
                className="tk-input"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'opened' | 'updated' | 'created')}
                aria-label="排序方式"
                style={{ width: 'auto' }}
              >
                <option value="opened">最後打開時間</option>
                <option value="updated">最後編輯時間</option>
                <option value="created">建立時間</option>
              </select>
              <button
                className="tk-input"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title="切換正序 / 逆序"
                style={{ width: 'auto', cursor: 'pointer' }}
              >
                {sortDir === 'asc' ? '↑ 正序' : '↓ 逆序'}
              </button>
              <button
                className={`notes-editbtn ${editMode ? 'notes-editbtn--on' : ''}`}
                onClick={toggleEditMode}
                title="編輯模式：開啟後可勾選筆記做批次操作（重整不會關閉，只有再次按此才關）"
              >
                {editMode ? '✓ 編輯模式：開' : '☑ 編輯模式'}
              </button>
            </div>
          </div>

          {/* 批次操作工具列（編輯模式且有選取時顯示） */}
          {editMode && selectedNotes.length > 0 && (
            <NotesBatchToolbar
              selected={selectedNotes}
              categories={categories}
              tags={tags}
              onReload={load}
              onResetBatch={() => {
                // 批次刪除後：成員已不在，清掉本次批次標籤指標（下次勾選會建新的一組）。
                setBatchTagId(null);
                localStorage.removeItem(LS_BATCH_TAG);
              }}
            />
          )}
        </div>

        {error && (
          <div
            style={{
              padding: 'var(--spacing-4)',
              background: 'var(--status-danger-bg)',
              color: 'var(--status-danger-fg)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 'var(--spacing-6)',
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        {notes.length === 0 ? (
          <div
            style={{
              padding: 'var(--spacing-12)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-default)',
            }}
          >
            <span style={{ fontSize: 'var(--text-2xl)', display: 'block', marginBottom: 'var(--spacing-2)' }}>
              📝
            </span>
            <p style={{ margin: 0, fontWeight: 500 }}>沒有筆記</p>
            <p style={{ margin: 'var(--spacing-2) 0 0 0', fontSize: 'var(--text-sm)' }}>
              點左側側欄的「＋ 新增筆記」開始記錄想法。
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
            {sortedNotes.map((note) => {
              const checked = selectedIdSet.has(note.id);
              // 顯示的時間跟著「排序方式」走：選什麼排序，就顯示那個時間。
              const sortTime =
                sortBy === 'opened'
                  ? note.lastOpenedDateTime
                  : sortBy === 'created'
                    ? note.createdDateTime
                    : note.updatedDateTime;
              const sortTimeLabel =
                sortBy === 'opened' ? '最後打開' : sortBy === 'created' ? '建立' : '最後編輯';
              return (
                <div key={note.id} className="note-row">
                  {editMode && (
                    <input
                      type="checkbox"
                      className="note-check"
                      checked={checked}
                      disabled={toggling}
                      onChange={() => toggleSelect(note)}
                      aria-label={`選取筆記：${note.title}`}
                      title="勾選以加入批次操作"
                    />
                  )}
                  <Link
                    href={`/notes/${note.slug}`}
                    prefetch
                    draggable
                    title="可拖曳到左側分類，把這篇筆記歸入該分類"
                    onDragStart={(e) => {
                      // 攜帶筆記 ID，供左側欄分類列接收（拖筆記入分類）
                      e.dataTransfer.setData(NOTE_DND_MIME, note.id);
                      e.dataTransfer.effectAllowed = 'copyMove';
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'block',
                      padding: 'var(--spacing-4)',
                      background: checked ? 'var(--action-secondary-bg)' : 'var(--bg-surface)',
                      border: `1px solid ${checked ? 'var(--action-primary-bg)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-lg)',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-strong)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = checked
                        ? 'var(--action-primary-bg)'
                        : 'var(--border-default)';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 'var(--text-base)',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {note.title}
                    </h3>
                    <div
                      style={{
                        marginTop: 'var(--spacing-2)',
                        display: 'flex',
                        gap: 'var(--spacing-3)',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-tertiary)',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        ⏱️ {sortTimeLabel}：
                        {sortTime ? formatNoteDateTime(sortTime) : '—（未打開）'}
                      </span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {/* 子分類：所選分類底下的子分類，列在筆記清單下方，可點擊鑽入 */}
        {selectedCategoryId && childCategories.length > 0 && (
          <div style={{ marginTop: 'var(--spacing-8)' }}>
            <h2
              style={{
                margin: '0 0 var(--spacing-3) 0',
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              子分類（{childCategories.length}）
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 'var(--spacing-3)',
              }}
            >
              {childCategories.map((c) => (
                <Link
                  key={c.id}
                  href={`/notes?categoryId=${c.id}`}
                  prefetch
                  title={`鑽入子分類：${c.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-2)',
                    padding: 'var(--spacing-3) var(--spacing-4)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span aria-hidden="true">📁</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.noteCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .notes-page {
          width: 100%;
          overflow-y: auto;
        }
        .notes-page__container {
          max-width: var(--max-content-width);
          margin: 0 auto;
          padding: var(--spacing-6) var(--spacing-4);
        }
        /* #6 置頂列：黏在捲動容器頂端，內容往下捲時不會被滑掉 */
        .notes-stickyhead {
          position: sticky;
          top: 0;
          z-index: 6;
          background: var(--bg-default);
          padding: var(--spacing-4) 0 var(--spacing-3);
          margin-bottom: var(--spacing-3);
          border-bottom: 1px solid var(--border-default);
        }
        .notes-headrow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--spacing-3);
        }
        .notes-editbtn {
          flex-shrink: 0;
          padding: var(--spacing-2) var(--spacing-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          cursor: pointer;
        }
        .notes-editbtn:hover {
          background: var(--bg-default);
          color: var(--text-primary);
        }
        .notes-editbtn--on {
          background: var(--action-primary-bg);
          color: var(--action-primary-fg);
          border-color: var(--action-primary-bg);
          font-weight: 600;
        }
        .note-row {
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
        }
        .note-check {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
        @media (max-width: 768px) {
          .notes-page__container {
            padding: var(--spacing-4) var(--spacing-3);
          }
        }
      `}</style>
    </div>
  );
}
