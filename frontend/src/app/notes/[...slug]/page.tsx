'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { enhanceCodeBlocks } from '@/lib/codeBlocks';
import {
  getNote,
  updateNote,
  deleteNote,
  listNoteComments,
  addNoteComment,
  listNoteCategories,
  listNoteTags,
  createNoteCategory,
  createNoteTag,
  type NoteDetail,
  type NoteCategory,
  type NoteTag,
  type Comment,
  type CurrentUser,
  getCurrentUser,
} from '@/lib/api';
import { formatFullDateTime, formatDateTime as formatDateTimeUtil } from '@/lib/formatters';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { SkeletonCard } from '@/components/Skeleton';
import { NoteAiActions } from '@/components/NoteAiActions';
import { NoteEditHistory } from '@/components/NoteEditHistory';
import { NoteBacklinks } from '@/components/NoteBacklinks';
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { LinkedEntitiesBar } from '@/components/LinkedEntitiesBar';
import { NoteMarksLayer } from '@/components/NoteMarksLayer';
import { NoteOverlay } from '@/components/NoteOverlay';
import { useUndoHotkeys, resetUndo } from '@/lib/undoManager';

/**
 * 筆記詳細編輯與查看頁面
 *
 * 功能：
 * - 顯示筆記內容（Markdown 預覽 + HTML 渲染）
 * - 編輯筆記（Markdown 編輯器）
 * - 草稿切換
 * - 刪除筆記
 * - 留言列表與新增留言
 * - 編輯歷史時間軸（GET /api/notes/{id}/revisions）
 * - 反向連結面板（GET /api/notes/{id}/backlinks）
 * - 浮動白板（可拖曳、可繪圖、便利貼，localStorage 持久化）
 * - AI 兩鍵（排版調整 / 內容美化 + 撤銷，POST /api/notes/{id}/reformat 及 /beautify）
 */

export default function NotesDetailPage() {
  // 萬用路由 [...slug]：筆記 slug 含「/」（對應子資料夾層級），
  // 用 useParams 取回各段，逐段 decode 後再以「/」組回完整 slug。
  const routeParams = useParams();
  const slug = Array.isArray(routeParams.slug)
    ? routeParams.slug.map((s) => decodeURIComponent(s)).join('/')
    : decodeURIComponent(String(routeParams.slug ?? ''));
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編輯狀態
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // AI（排版/美化）進行中：用來與「保存」互鎖，避免兩者重疊寫入造成競態。
  const [aiBusy, setAiBusy] = useState(false);
  // 預覽內文容器參考（供 NoteMarksLayer 套用文字標註）。
  const previewRef = useRef<HTMLDivElement | null>(null);

  // 編輯時的分類/標籤：選項池與目前選取
  const [allCategories, setAllCategories] = useState<NoteCategory[]>([]);
  const [allTags, setAllTags] = useState<NoteTag[]>([]);
  const [editCatIds, setEditCatIds] = useState<string[]>([]);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);

  // 計算分類的完整階層路徑（顯示用，例如「工作 / 專案A」）
  const categoryPath = (parentId: string | null | undefined, cats: NoteCategory[]): string => {
    if (!parentId) return '';
    const p = cats.find((c) => c.id === parentId);
    return p ? `${categoryPath(p.parentId, cats)}${p.name} / ` : '';
  };

  // 留言狀態
  const [commentContent, setCommentContent] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // 標籤頁
  const [activeTab, setActiveTab] = useState<'preview' | 'comments' | 'history' | 'backlinks'>('preview');

  // 共用「復原 / 重做」：手繪塗鴉與畫重點共用同一條 Ctrl+Z 堆疊，僅在預覽分頁掛上單一鍵盤監聽。
  useUndoHotkeys(activeTab === 'preview');
  // 切換筆記時清空堆疊，避免跨筆記誤復原。
  useEffect(() => {
    resetUndo();
    return () => resetUndo();
  }, [note?.id]);

  // 為閱讀檢視中的程式碼區塊注入「一鍵複製」按鈕（內容為注入 HTML，故以 DOM 後處理）。
  // 內容（contentHtml）或分頁變更後重跑；已處理的區塊有 data-cb 標記不會重複加。
  useEffect(() => {
    if (activeTab !== 'preview' || !previewRef.current) return;
    enhanceCodeBlocks(previewRef.current);
  }, [activeTab, note?.contentHtml]);

  // 把「目前筆記所屬分類」廣播給左側欄，讓它標示「📍 此筆記在這」（避免迷路）。
  // 用分類 id 串接當相依，分類載入/切換筆記時更新；離開時清空。
  const noteCatIdsKey = (note?.categories ?? []).map((c) => c.id).join(',');
  useEffect(() => {
    const ids = noteCatIdsKey ? noteCatIdsKey.split(',') : [];
    window.dispatchEvent(
      new CustomEvent('zonwiki:note-active-category', { detail: { categoryIds: ids } })
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent('zonwiki:note-active-category', { detail: { categoryIds: [] } })
      );
    };
  }, [noteCatIdsKey]);

  // AI 操作回調：AI（排版/美化/撤銷）只更新編輯器內容，不寫 DB、也不重抓筆記
  // （後端已改為純轉換、不落地）。先前的 getNote 重抓會把編輯器內容蓋回 DB 版，
  // 造成「未存編輯被吃掉」與「撤銷無效」，故移除。最終是否落地由使用者按「保存」決定。
  const handleAiContentUpdate = (contentRaw: string) => {
    setEditContent(contentRaw);
  };

  // 載入筆記詳細
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [currentUser, noteData, cats, tgs] = await Promise.all([
          getCurrentUser(),
          getNote(slug),
          listNoteCategories(),
          listNoteTags(),
        ]);

        setUser(currentUser);
        setAllCategories(cats);
        setAllTags(tgs);
        if (noteData) {
          setNote(noteData);
          setEditTitle(noteData.title);
          setEditContent(noteData.contentRaw);
          setEditCatIds((noteData.categories ?? []).map((c) => c.id));
          setEditTagIds((noteData.tags ?? []).map((t) => t.id));

          // 載入留言
          const commentsList = await listNoteComments(noteData.id);
          setComments(commentsList);
        } else {
          setError('筆記不存在');
        }
      } catch {
        setError('無法載入筆記，請稍後重試。');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [slug]);

  // 保存編輯
  const handleSave = async () => {
    if (!note) return;

    try {
      setIsSaving(true);
      await updateNote(note.id, {
        title: editTitle,
        contentRaw: editContent,
        categoryIds: editCatIds,
        tagIds: editTagIds,
      });

      // 重新載入
      const updated = await getNote(slug);
      if (updated) {
        setNote(updated);
        setEditCatIds((updated.categories ?? []).map((c) => c.id));
        setEditTagIds((updated.tags ?? []).map((t) => t.id));
        setIsEditing(false);
        setError(null);
      }
    } catch {
      setError('無法保存筆記，請稍後重試。');
    } finally {
      setIsSaving(false);
    }
  };

  // 匯出 PDF：用瀏覽器原生列印（另存為 PDF）。以 @media print 只保留筆記內容區，
  // 並把文件標題暫時改成筆記標題，讓「另存 PDF」的預設檔名即為筆記標題。
  const handleExportPdf = () => {
    if (!note) return;
    const prevTitle = document.title;
    document.title = note.title || '筆記';
    // 等標題套用後再叫出列印對話框；列印結束後還原標題。
    const restore = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 50);
  };

  // 刪除筆記
  const handleDelete = async () => {
    if (!note || !confirm('確定要刪除此筆記嗎？')) return;

    try {
      await deleteNote(note.id);
      // 導向筆記清單
      window.location.href = '/notes';
    } catch {
      setError('無法刪除筆記，請稍後重試。');
    }
  };

  // 新增留言
  const handlePostComment = async () => {
    if (!note || !commentContent.trim()) return;

    try {
      setIsPostingComment(true);
      await addNoteComment(note.id, commentContent);

      // 重新載入留言
      const updated = await listNoteComments(note.id);
      setComments(updated);
      setCommentContent('');
    } catch {
      setError('無法新增留言，請稍後重試。');
    } finally {
      setIsPostingComment(false);
    }
  };

  /**
   * 格式化筆記的完整時間戳，使用用戶時區
   */
  const userTimeZone = user?.timeZone || DEFAULT_TIMEZONE;
  const formatNoteFullDateTime = (dateStr: string) => {
    return formatFullDateTime(dateStr, userTimeZone);
  };

  /**
   * 格式化留言時間 (MM/DD HH:mm)
   */
  const formatCommentTime = (dateStr: string) => {
    return formatDateTimeUtil(dateStr, userTimeZone);
  };

  if (loading) {
    return (
      <div className="note-detail-page">
        <div className="note-detail__container">
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="note-detail-page">
        <div className="note-detail__container">
          <div
            style={{
              padding: 'var(--spacing-12)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--text-lg)' }}>筆記不存在</p>
            <Link href="/notes" style={{ marginTop: 'var(--spacing-3)', display: 'inline-block' }}>
              返回筆記清單
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="note-detail-page">
      <div className="note-detail__container">
        {/* 返回上一個瀏覽的地方（瀏覽器歷史；例如從分類清單/別篇筆記/關聯跳來） */}
        <button
          onClick={() => router.back()}
          className="btn-secondary"
          title="返回上一個瀏覽的地方"
          style={{
            marginBottom: 'var(--spacing-3)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-1)',
          }}
        >
          ← 返回
        </button>

        {/* 錯誤提示 */}
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

        {/* 關聯列：此筆記關聯的任務/子任務/節點，可搜尋既有項目來關聯（點任務→回到當天行事曆） */}
        <div style={{ marginBottom: 'var(--spacing-4)' }}>
          <LinkedEntitiesBar type="note" id={note.id} sourceTitle={note.title} />
        </div>

        {/* 編輯模式 */}
        {isEditing ? (
          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            {/* 標題列：標題輸入框與「取消／保存」同行 */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--spacing-3)',
                alignItems: 'center',
                marginBottom: 'var(--spacing-4)',
              }}
            >
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: 'var(--spacing-3)',
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 700,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-body)',
                }}
                placeholder="筆記標題..."
              />
              <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexShrink: 0 }}>
                <button
                  onClick={() => setIsEditing(false)}
                  className="btn-secondary"
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="btn-primary"
                  disabled={isSaving || aiBusy}
                  title={aiBusy ? 'AI 處理中，請稍候…' : undefined}
                >
                  {isSaving ? '保存中...' : '💾 保存'}
                </button>
              </div>
            </div>

            {/* 分類 / 標籤（可搜尋下拉 + 就地新增） */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--spacing-4)',
                marginBottom: 'var(--spacing-4)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--spacing-1)',
                  }}
                >
                  分類
                </label>
                <SearchableMultiSelect
                  options={allCategories.map((c) => ({
                    id: c.id,
                    name: `${categoryPath(c.parentId, allCategories)}${c.name}`,
                  }))}
                  selectedIds={editCatIds}
                  onChange={setEditCatIds}
                  onCreate={async (name) => {
                    try {
                      const cat = await createNoteCategory({ name, parentId: null });
                      if (cat) {
                        setAllCategories((c) => [...c, cat]);
                        return { id: cat.id, name: cat.name };
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '新增分類失敗');
                    }
                    return null;
                  }}
                  placeholder="搜尋或新增分類…"
                />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--spacing-1)',
                  }}
                >
                  標籤
                </label>
                <SearchableMultiSelect
                  options={allTags.map((t) => ({ id: t.id, name: t.name }))}
                  selectedIds={editTagIds}
                  onChange={setEditTagIds}
                  onCreate={async (name) => {
                    try {
                      const tag = await createNoteTag(name);
                      if (tag) {
                        setAllTags((t) => [...t, tag]);
                        return { id: tag.id, name: tag.name };
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '新增標籤失敗');
                    }
                    return null;
                  }}
                  prefix="#"
                  placeholder="搜尋或新增標籤…"
                />
              </div>
            </div>

            {/* AI 操作按鈕 */}
            <div style={{ marginBottom: 'var(--spacing-4)' }}>
              <NoteAiActions
                noteId={note.id}
                currentContent={editContent}
                onContentUpdate={handleAiContentUpdate}
                onError={(message) => setError(message)}
                disabled={isSaving}
                onBusyChange={setAiBusy}
              />
            </div>

            <MarkdownEditor
              value={editContent}
              onChange={setEditContent}
              withPreview
              minHeight={400}
              placeholder="用 Markdown 撰寫內容…（可用工具列套用格式）"
            />
          </div>
        ) : (
          /* 查看模式 */
          <>
            {/* 筆記頭：標題與「編輯／設為草稿／刪除」同行 */}
            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 'var(--spacing-3)',
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    fontSize: 'var(--text-3xl)',
                    fontWeight: 700,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {note.title}
                </h1>
                <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexShrink: 0 }}>
                  <button
                    onClick={() => {
                      // 進入編輯前以目前筆記內容重設各編輯欄位（含分類/標籤）。
                      setEditTitle(note.title);
                      setEditContent(note.contentRaw);
                      setEditCatIds((note.categories ?? []).map((c) => c.id));
                      setEditTagIds((note.tags ?? []).map((t) => t.id));
                      setIsEditing(true);
                    }}
                    className="btn-primary"
                  >
                    ✏️ 編輯
                  </button>
                  <button onClick={handleExportPdf} className="btn-secondary" title="以瀏覽器列印（可另存為 PDF）">
                    📄 匯出 PDF
                  </button>
                  <button onClick={handleDelete} className="btn-danger">
                    🗑️ 刪除
                  </button>
                </div>
              </div>
              <div
                style={{
                  marginTop: 'var(--spacing-3)',
                  display: 'flex',
                  gap: 'var(--spacing-4)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>建立：{formatNoteFullDateTime(note.createdDateTime)}</span>
                <span>更新：{formatNoteFullDateTime(note.updatedDateTime)}</span>
              </div>
            </div>

            {/* 標籤頁 */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--spacing-2)',
                borderBottom: '1px solid var(--border-default)',
                marginBottom: 'var(--spacing-4)',
                overflowX: 'auto',
              }}
            >
              <button
                onClick={() => setActiveTab('preview')}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-4)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom:
                    activeTab === 'preview'
                      ? '2px solid var(--action-primary-bg)'
                      : '2px solid transparent',
                  color:
                    activeTab === 'preview'
                      ? 'var(--action-primary-bg)'
                      : 'var(--text-secondary)',
                  fontWeight: activeTab === 'preview' ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                📖 預覽
              </button>
              <button
                onClick={() => setActiveTab('comments')}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-4)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom:
                    activeTab === 'comments'
                      ? '2px solid var(--action-primary-bg)'
                      : '2px solid transparent',
                  color:
                    activeTab === 'comments'
                      ? 'var(--action-primary-bg)'
                      : 'var(--text-secondary)',
                  fontWeight: activeTab === 'comments' ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                💬 留言 ({comments.length})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-4)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom:
                    activeTab === 'history'
                      ? '2px solid var(--action-primary-bg)'
                      : '2px solid transparent',
                  color:
                    activeTab === 'history'
                      ? 'var(--action-primary-bg)'
                      : 'var(--text-secondary)',
                  fontWeight: activeTab === 'history' ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                ⏰ 歷史
              </button>
              <button
                onClick={() => setActiveTab('backlinks')}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-4)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom:
                    activeTab === 'backlinks'
                      ? '2px solid var(--action-primary-bg)'
                      : '2px solid transparent',
                  color:
                    activeTab === 'backlinks'
                      ? 'var(--action-primary-bg)'
                      : 'var(--text-secondary)',
                  fontWeight: activeTab === 'backlinks' ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                🔗 反向連結
              </button>
            </div>

            {/* 預覽標籤：框選文字畫重點/做關聯/寫備註（NoteMarksLayer）＋ 浮層便利貼/塗鴉/輪播（NoteOverlay，疊最上層） */}
            {activeTab === 'preview' && (
              <div style={{ position: 'relative' }}>
                <div
                  ref={previewRef}
                  className="markdown-prose"
                  style={{
                    background: 'var(--bg-surface)',
                    padding: 'var(--spacing-6)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-default)',
                  }}
                  dangerouslySetInnerHTML={{ __html: note.contentHtml }}
                />
                <NoteMarksLayer
                  noteId={note.id}
                  containerRef={previewRef}
                  contentHtml={note.contentHtml}
                  active={activeTab === 'preview'}
                />
                <NoteOverlay noteId={note.id} containerRef={previewRef} />
              </div>
            )}

            {/* 留言標籤 */}
            {activeTab === 'comments' && (
              <div>
                {/* 新增留言 */}
                {user && (
                  <div
                    style={{
                      padding: 'var(--spacing-4)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-lg)',
                      marginBottom: 'var(--spacing-4)',
                    }}
                  >
                    <textarea
                      value={commentContent}
                      onChange={(e) => setCommentContent(e.target.value)}
                      placeholder="寫下你的想法或問題..."
                      style={{
                        width: '100%',
                        minHeight: '100px',
                        padding: 'var(--spacing-3)',
                        fontSize: 'var(--text-base)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        fontFamily: 'var(--font-body)',
                        marginBottom: 'var(--spacing-3)',
                        resize: 'vertical',
                      }}
                      disabled={isPostingComment}
                    />
                    <button
                      onClick={handlePostComment}
                      className="btn-primary"
                      disabled={isPostingComment || !commentContent.trim()}
                    >
                      {isPostingComment ? '發送中...' : '💬 發送留言'}
                    </button>
                  </div>
                )}

                {/* 留言列表 */}
                {comments.length === 0 ? (
                  <div
                    style={{
                      padding: 'var(--spacing-8)',
                      textAlign: 'center',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <p style={{ margin: 0 }}>暫無留言</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        style={{
                          padding: 'var(--spacing-4)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-lg)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            gap: 'var(--spacing-3)',
                            marginBottom: 'var(--spacing-2)',
                          }}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--action-secondary-bg)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 'var(--text-sm)',
                              fontWeight: 600,
                              color: 'var(--action-secondary-fg)',
                            }}
                          >
                            {comment.authorName.charAt(0)}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                              }}
                            >
                              {comment.authorName}
                            </div>
                            <div
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              {formatCommentTime(comment.createdDateTime)}
                            </div>
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--text-secondary)',
                            lineHeight: 'var(--line-height-normal)',
                          }}
                        >
                          {comment.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 歷史標籤 */}
            {activeTab === 'history' && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <NoteEditHistory noteId={note.id} userTimeZone={userTimeZone} />
              </div>
            )}

            {/* 反向連結標籤 */}
            {activeTab === 'backlinks' && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <NoteBacklinks noteId={note.id} />
              </div>
            )}

            {/*
              列印 / 匯出 PDF 專用區塊：螢幕上隱藏（display:none），僅在 @media print 顯示。
              點「匯出 PDF」→ window.print()，列印 CSS（globals.css）會隱藏整頁其餘內容，
              只留這塊（標題＋內容），不受目前在哪個分頁影響。
            */}
            <div className="note-print-only" aria-hidden="true">
              <h1 className="note-print-title">{note.title}</h1>
              <div
                className="markdown-prose"
                dangerouslySetInnerHTML={{ __html: note.contentHtml }}
              />
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .note-detail-page {
          width: 100%;
          overflow-y: auto;
        }

        .note-detail__container {
          max-width: var(--max-content-width);
          margin: 0 auto;
          padding: var(--spacing-6) var(--spacing-4);
        }

        /* Markdown 樣式 */
        .markdown-prose {
          font-size: var(--text-base);
          line-height: var(--line-height-normal);
          color: var(--text-primary);
        }

        .markdown-prose h1,
        .markdown-prose h2,
        .markdown-prose h3,
        .markdown-prose h4,
        .markdown-prose h5,
        .markdown-prose h6 {
          margin: var(--spacing-4) 0 var(--spacing-2);
          font-weight: 600;
          color: var(--text-primary);
        }

        .markdown-prose h1 {
          font-size: var(--text-2xl);
        }

        .markdown-prose h2 {
          font-size: var(--text-xl);
        }

        .markdown-prose h3 {
          font-size: var(--text-lg);
        }

        .markdown-prose p {
          margin: var(--spacing-3) 0;
        }

        .markdown-prose a {
          color: var(--action-secondary-fg);
          text-decoration: underline;
        }

        /* 只套用到「行內程式碼」（直接父層不是 pre）。
           否則這個 inline 樣式（背景＋padding）會落到區塊程式碼的 <code> 上，
           讓多行內容每一行各自出現一塊灰底（看起來變成一行一行的）。區塊程式碼樣式見 globals.css。 */
        .markdown-prose :not(pre) > code {
          background: var(--code-bg);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 0.9em;
        }

        /* 程式碼區塊（pre / pre code）樣式改由 globals.css 全域定義，
           以確保套用到「以 HTML 注入」的內容、且在所有主題都醒目（見 .markdown-prose pre）。 */

        .markdown-prose ul,
        .markdown-prose ol {
          margin: var(--spacing-3) 0;
          padding-left: var(--spacing-6);
        }

        .markdown-prose li {
          margin: var(--spacing-1) 0;
        }

        .markdown-prose blockquote {
          margin: var(--spacing-3) 0;
          padding-left: var(--spacing-4);
          border-left: 4px solid var(--border-default);
          color: var(--text-secondary);
        }

        .markdown-prose table {
          width: 100%;
          border-collapse: collapse;
          margin: var(--spacing-4) 0;
        }

        .markdown-prose th,
        .markdown-prose td {
          padding: var(--spacing-2) var(--spacing-3);
          border: 1px solid var(--border-default);
          text-align: left;
        }

        .markdown-prose th {
          background: var(--bg-surface-secondary);
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .note-detail__container {
            padding: var(--spacing-4) var(--spacing-3);
          }
        }
      `}</style>
    </div>
  );
}
