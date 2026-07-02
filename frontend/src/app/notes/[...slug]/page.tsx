'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { enhanceCodeBlocks } from '@/lib/codeBlocks';
import {
  getNote,
  markNoteOpened,
  updateNote,
  deleteNote,
  listNoteComments,
  addNoteComment,
  listNoteCategories,
  listNoteTags,
  createNoteCategory,
  createNoteTag,
  listTaskGroups,
  type NoteDetail,
  type NoteCategory,
  type NoteTag,
  type Comment,
  type CurrentUser,
  type TaskGroup,
  getCurrentUser,
} from '@/lib/api';
import { TaskEditorModal } from '@/app/tasks/components/TaskEditorModal';
import { formatFullDateTime, formatDateTime as formatDateTimeUtil } from '@/lib/formatters';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { SkeletonCard } from '@/components/Skeleton';
import { NoteAiActions } from '@/components/NoteAiActions';
import { NoteEditHistory } from '@/components/NoteEditHistory';
import { NoteBacklinks } from '@/components/NoteBacklinks';
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { recordNoteNav, getNoteBackTarget } from '@/lib/noteNav';
import { LinkedEntitiesBar } from '@/components/LinkedEntitiesBar';
import { NoteMarksLayer } from '@/components/NoteMarksLayer';
import { NoteOverlay } from '@/components/NoteOverlay';
import { TocPanel } from '@/components/TocPanel';
import { buildToc } from '@/lib/toc';
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
  // 編輯器 textarea 參考：供「局部排版（重排選取範圍）」讀取目前選取位置。
  const editorTaRef = useRef<HTMLTextAreaElement | null>(null);

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
  const [activeTab, setActiveTab] = useState<'preview' | 'comments' | 'history' | 'backlinks' | 'links'>('preview');
  // 「全部收合／展開」單鈕的狀態：false=目前視為全收合（後端 toggle 預設收合），點擊會展開全部並翻轉。
  const [allTogglesExpanded, setAllTogglesExpanded] = useState(false);

  // 章節目錄表（浮動、可拖曳、可關閉）：每次載入頁面「預設打開」，位置固定在左側（不記憶、不壓內文）。
  const [tocOpen, setTocOpen] = useState(true);

  // 本頁捲動容器（.note-detail-page）：記住閱讀位置、下次打開自動捲回（N1）。
  const noteScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSaveRaf = useRef<number | null>(null);
  const scrollRestoredFor = useRef<string | null>(null);
  const noteScrollKey = (noteId: string) => `zonwiki:note-scroll:${noteId}`;

  // 任務編輯彈窗（從框選關聯點任務時，在筆記頁就地開啟，不離開頁面）（N4）。
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [taskEditorStack, setTaskEditorStack] = useState<string[]>([]);
  const taskEditorId = taskEditorStack.length ? taskEditorStack[taskEditorStack.length - 1] : null;
  useEffect(() => {
    listTaskGroups().then(setTaskGroups).catch(() => {});
  }, []);
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (id) setTaskEditorStack((prev) => (prev.length ? [...prev, id] : [id]));
    };
    window.addEventListener('zonwiki:open-task', onOpenTask);
    return () => window.removeEventListener('zonwiki:open-task', onOpenTask);
  }, []);

  // 捲動時節流存目前位置（每幀最多存一次）。
  const handleNoteScroll = useCallback(() => {
    const nid = note?.id;
    if (!nid) return;
    if (scrollSaveRaf.current != null) return;
    scrollSaveRaf.current = requestAnimationFrame(() => {
      scrollSaveRaf.current = null;
      const el = noteScrollRef.current;
      if (el) {
        try { localStorage.setItem(noteScrollKey(nid), String(Math.round(el.scrollTop))); } catch { /* ignore */ }
      }
    });
  }, [note?.id]);

  // 載入完成後，把捲動位置還原到上次離開處（每篇只還原一次；等內文渲染後再捲）。
  useEffect(() => {
    const nid = note?.id;
    if (!nid || loading) return;
    if (scrollRestoredFor.current === nid) return;
    let saved = 0;
    try { saved = Number(localStorage.getItem(noteScrollKey(nid)) || '0'); } catch { /* ignore */ }
    if (!saved) { scrollRestoredFor.current = nid; return; }
    const timer = setTimeout(() => {
      const el = noteScrollRef.current;
      if (el) el.scrollTop = saved;
      scrollRestoredFor.current = nid;
    }, 250);
    return () => clearTimeout(timer);
    // 內文渲染後再捲；用 250ms 緩衝，不相依 previewHtml（它宣告於後方，避免 TDZ）。
  }, [note?.id, loading]);

  // 記住「最後看的筆記」slug：之後從 Header 點「筆記」會直接回到這篇（N1：打開筆記功能＝回到該篇該位置）。
  useEffect(() => {
    if (note?.id && slug) {
      try { localStorage.setItem('zonwiki:last-note-slug', slug); } catch { /* ignore */ }
      // 記錄到「筆記情境返回堆疊」：抵達此筆記頁時 push（供返回鈕只在筆記情境內移動）。
      recordNoteNav(window.location.pathname + window.location.search);
    }
  }, [note?.id, slug]);
  // 由內文 HTML 萃取章節（h1/h2/h3）並為各標題補上錨點 id（供目錄點擊捲動）。
  const { html: previewHtml, toc } = useMemo(
    () => (note ? buildToc(note.contentHtml) : { html: '', toc: [] }),
    [note],
  );

  // 「全部展開／收合」：改用 effect 套用到目前 DOM 的所有 details——
  // 先前直接在點擊時 setOpen，但內文渲染層（NoteMarksLayer 等）在同次重繪會把 .markdown-prose 重新注入、
  // 把 details 重建成預設收合，導致「全部展開」按了沒反應（全部收合看似 OK 只因預設就收合）。
  // 放進 effect（父層 effect 於子層之後執行）→ 在重注入之後才套用，故一定生效；也隨 previewHtml 變動重套。
  useEffect(() => {
    previewRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.md-toggle')
      .forEach((d) => { d.open = allTogglesExpanded; });
  }, [allTogglesExpanded, previewHtml]);

  // 共用「復原 / 重做」：手繪塗鴉與畫重點共用同一條 Ctrl+Z 堆疊，僅在預覽分頁掛上單一鍵盤監聽。
  useUndoHotkeys(activeTab === 'preview');
  // 切換筆記時清空堆疊，避免跨筆記誤復原。
  useEffect(() => {
    resetUndo();
    return () => resetUndo();
  }, [note?.id]);

  // 預覽容器的 callback ref：掛載當下就為程式碼區塊注入「複製」鈕，並以 MutationObserver
  // 持續處理之後才出現/重繪的區塊（取代原本相依 previewRef 時序的 useEffect——實測它不一定跑到）。
  // 同時把 node 存回 previewRef，供 NoteMarksLayer / NoteOverlay 使用。
  const previewObsRef = useRef<MutationObserver | null>(null);
  const setPreviewNode = useCallback((node: HTMLDivElement | null) => {
    previewRef.current = node;
    previewObsRef.current?.disconnect();
    previewObsRef.current = null;
    if (!node) return;
    enhanceCodeBlocks(node);
    const obs = new MutationObserver(() => enhanceCodeBlocks(node));
    obs.observe(node, { childList: true, subtree: true });
    previewObsRef.current = obs;
  }, []);

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

  // 讀取查詢參數（?mark= 用來從提問佇列跳轉到框選位置）
  const searchParams = useSearchParams();
  const markId = searchParams.get('mark');

  // 滾動到標記位置（當標記 ID 有效且預覽容器已掛載時觸發）
  // 這部分在預覽 HTML 與標記層載入後執行，以確保 DOM 已準備好
  useEffect(() => {
    if (!markId || !previewRef.current) return;

    // 延遲執行，確保 DOM 已完全渲染
    const timer = setTimeout(() => {
      // 尋找標記對應的 DOM 元素（預期由 NoteMarksLayer 建立的標記視覺化）
      // 標記通常在 previewRef 内部的某個高亮元素或標註 UI
      const markElement = previewRef.current?.querySelector(
        `[data-mark-id="${CSS.escape(markId)}"]`
      ) as HTMLElement | null;

      if (markElement) {
        // 滾動到該元素
        markElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 短暫高亮（添加視覺反饋）
        const originalBackground = markElement.style.backgroundColor;
        markElement.style.backgroundColor = 'rgba(255, 193, 7, 0.3)';
        const highlightTimer = setTimeout(() => {
          markElement.style.backgroundColor = originalBackground;
        }, 2000);

        return () => clearTimeout(highlightTimer);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [markId, previewHtml]);

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

          // 記錄「最後打開時間」（供筆記清單依此排序；輕量、失敗靜默）。
          markNoteOpened(noteData.id);

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

  // 匯出 PDF：用瀏覽器原生列印（另存為 PDF）。
  // 列印的是「實際預覽區」（含手繪塗鴉/便利貼/畫重點），@media print 會隱藏全站外殼、
  // 右下角工具列與章節目錄表，只留標題＋內容＋浮層（手繪等）。
  // 先切到「預覽」分頁確保浮層（含手繪 SVG）已掛載，否則塗鴉印不出來；
  // 並把文件標題暫時改成筆記標題，讓「另存 PDF」的預設檔名即為筆記標題。
  const handleExportPdf = () => {
    if (!note) return;
    setActiveTab('preview');
    const prevTitle = document.title;
    document.title = note.title || '筆記';
    // 等標題套用後再叫出列印對話框；列印結束後還原標題。
    const restore = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    // 稍候讓「預覽分頁＋浮層（手繪）」完成渲染再列印。
    setTimeout(() => window.print(), 200);
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
    <div className="note-detail-page" ref={noteScrollRef} onScroll={handleNoteScroll}>
      <div className="note-detail__container">
        {/* 置頂工具列（sticky，不隨內文捲走）：返回 + 標題 + 編輯 / 匯出 PDF / 刪除，同一行。 */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-3)',
            marginBottom: 'var(--spacing-3)',
            paddingTop: 'var(--spacing-2)',
            paddingBottom: 'var(--spacing-2)',
            background: 'var(--bg-canvas)',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <button
            onClick={() => {
              // 編輯中：「返回」無條件回到本篇筆記頁（退出編輯、切回閱讀），不走返回堆疊、不導航離開。
              if (isEditing) {
                setIsEditing(false);
                return;
              }
              // 閱讀中：只在「筆記情境」內返回：從堆疊取上一個筆記情境頁（別篇筆記／分類頁）。
              // 堆疊起點（從首頁/搜尋/直接開網址進來）→ 回該篇筆記的分類頁（無分類則回筆記清單），
              // 刻意不回到 zonwiki 首頁等非筆記情境。
              const current = window.location.pathname + window.location.search;
              const target = getNoteBackTarget(current);
              if (target) {
                router.push(target);
              } else {
                const catId = note?.categories?.[0]?.id;
                router.push(catId ? `/notes?categoryId=${catId}` : '/notes');
              }
            }}
            className="btn-secondary"
            title={isEditing ? '返回本篇筆記（退出編輯）' : '返回上一個筆記情境頁（別篇筆記／分類頁）'}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-1)' }}
          >
            ← 返回
          </button>
          <h1
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={note.title}
          >
            {note.title}
          </h1>
          {/* 編輯中時隱藏「編輯 / 匯出 / 刪除」（避免與下方編輯區的取消/保存混淆）；編輯區自有取消/保存。 */}
          {!isEditing && (
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexShrink: 0 }}>
              {/* 一鍵收合／展開整頁摺疊區塊（單鈕切換；只在預覽分頁、且內容真的有 toggle 時才出現）。
                  toggle 是後端渲染的原生 <details>，直接設 .open 即可。 */}
              {activeTab === 'preview' && previewHtml.includes('md-toggle') && (
                <button
                  onClick={() => setAllTogglesExpanded((v) => !v)}
                  className="btn-secondary"
                  title={allTogglesExpanded ? '收合整頁所有摺疊區塊' : '展開整頁所有摺疊區塊'}
                >
                  {allTogglesExpanded ? '⊟ 全部收合' : '⊞ 全部展開'}
                </button>
              )}
              <button
                onClick={() => {
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
          )}
        </div>

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

        {/* 關聯內容已移到下方「關聯」分頁（見標籤頁） */}

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
                taRef={editorTaRef}
              />
            </div>

            <MarkdownEditor
              value={editContent}
              onChange={setEditContent}
              withPreview
              minHeight={400}
              placeholder="用 Markdown 撰寫內容…（可用工具列套用格式；🔒 可框住不想被 AI 重排的內容）"
              taRef={editorTaRef}
            />
          </div>
        ) : (
          /* 查看模式 */
          <>
            {/* 建立／更新時間（標題與動作鈕已移至上方置頂工具列） */}
            <div
              style={{
                marginBottom: 'var(--spacing-5)',
                display: 'flex',
                gap: 'var(--spacing-4)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>建立：{formatNoteFullDateTime(note.createdDateTime)}</span>
              <span>更新：{formatNoteFullDateTime(note.updatedDateTime)}</span>
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
              <button
                onClick={() => setActiveTab('links')}
                style={{
                  padding: 'var(--spacing-2) var(--spacing-4)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderBottom:
                    activeTab === 'links'
                      ? '2px solid var(--action-primary-bg)'
                      : '2px solid transparent',
                  color:
                    activeTab === 'links' ? 'var(--action-primary-bg)' : 'var(--text-secondary)',
                  fontWeight: activeTab === 'links' ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                🧷 關聯
              </button>
            </div>

            {/* 關聯分頁：此筆記關聯的任務/子任務/節點，可搜尋既有項目來關聯（點任務→回到當天行事曆） */}
            {activeTab === 'links' && (
              <div>
                <div
                  style={{
                    marginBottom: 'var(--spacing-3)',
                    padding: 'var(--spacing-3)',
                    background: 'var(--bg-surface-secondary, var(--bg-surface))',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                    lineHeight: 'var(--line-height-normal)',
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)' }}>🧷 關聯</strong>
                  ＝你<strong>手動</strong>把這篇筆記綁到其他「任務 / 開問啦節點 / 其他筆記」，
                  兩邊都看得到、可互相點擊跳轉。用下方「＋關聯」搜尋並加入既有項目即可。
                </div>
                <LinkedEntitiesBar type="note" id={note.id} sourceTitle={note.title} />
              </div>
            )}

            {/* 預覽標籤：框選文字畫重點/做關聯/寫備註（NoteMarksLayer）＋ 浮層便利貼/塗鴉/輪播（NoteOverlay，疊最上層）
                ＋ 浮動章節目錄表（TocPanel）。此區也是「匯出 PDF」實際列印的區塊（含手繪等浮層）。 */}
            {activeTab === 'preview' && (
              <div className="note-live-preview" style={{ position: 'relative' }}>
                {/* 列印用標題：螢幕上隱藏，@media print 顯示（內文區本身不含標題）。 */}
                <h1 className="note-print-title" aria-hidden="true">{note.title}</h1>
                <div
                  ref={setPreviewNode}
                  className="markdown-prose"
                  style={{
                    background: 'var(--bg-surface)',
                    padding: 'var(--spacing-6)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-default)',
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
                <NoteMarksLayer
                  noteId={note.id}
                  containerRef={previewRef}
                  contentHtml={previewHtml}
                  active={activeTab === 'preview'}
                />
                <NoteOverlay
                  noteId={note.id}
                  containerRef={previewRef}
                  onToggleToc={() => setTocOpen((v) => !v)}
                  tocOpen={tocOpen}
                />
                {tocOpen && toc.length > 0 && (
                  <TocPanel noteId={note.id} toc={toc} onClose={() => setTocOpen(false)} />
                )}
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
              <div>
                <div
                  style={{
                    marginBottom: 'var(--spacing-3)',
                    padding: 'var(--spacing-3)',
                    background: 'var(--bg-surface-secondary, var(--bg-surface))',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                    lineHeight: 'var(--line-height-normal)',
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)' }}>🔗 反向連結</strong>
                  ＝系統<strong>自動</strong>偵測「哪些<strong>其他筆記</strong>用 <code>[[本篇標題]]</code> 連到這篇」。
                  你不用手動建立——只要在別的筆記內文寫 <code>[[{note.title}]]</code>，那篇就會出現在這裡。
                </div>
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <NoteBacklinks noteId={note.id} />
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {/* 框選關聯到任務時：在筆記頁就地開啟任務編輯彈窗（不離開頁面）（N4）。 */}
      {taskEditorId && (
        <TaskEditorModal
          taskId={taskEditorId}
          groups={taskGroups}
          user={user}
          canGoBack={taskEditorStack.length > 1}
          onClose={() => setTaskEditorStack((prev) => prev.slice(0, -1))}
          onSaved={() => { /* 任務存檔後不需重載筆記 */ }}
          onDeleted={() => setTaskEditorStack((prev) => prev.slice(0, -1))}
          onNavigateToSubtask={(id) => setTaskEditorStack((prev) => [...prev, id])}
        />
      )}

      <style jsx>{`
        /* 讓本頁自己成為「固定高度的捲動容器」，而非整頁(body)捲動——
           否則上方 sticky 工具列因為祖先(main-content)雖有 overflow:auto 卻不真的捲動，
           sticky 便失效、會被一起捲走。高度扣掉全站固定標題列(--header-height)。 */
        .note-detail-page {
          width: 100%;
          height: calc(100vh - var(--header-height));
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
          /* 章節目錄表點擊捲動時，讓標題不要被頂端置頂工具列遮住。 */
          scroll-margin-top: 64px;
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
