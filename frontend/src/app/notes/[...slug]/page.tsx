'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { enhanceReadingCodeBlocks } from '@/lib/enhanceReadingCodeBlocks';
import { enhanceReadingTables } from '@/lib/enhanceReadingTables';
import { setFenceMetaAtLine } from '@/lib/codeBlockMeta';
import { showToast } from '@/lib/toast';
import {
  getNote,
  markNoteOpened,
  updateNote,
  deleteNote,
  duplicateNote,
  listNoteComments,
  addNoteComment,
  createNoteCategory,
  createNoteTag,
  listTaskGroups,
  type NoteDetail,
  type NoteCategory,
  type NoteTag,
  type Comment,
  type TaskGroup,
} from '@/lib/api';
import { useCurrentUser, useNoteCategories, useNoteTags } from '@/lib/swr';
import { ConflictError } from '@/lib/errors';
import { formatFullDateTime, formatDateTime as formatDateTimeUtil } from '@/lib/formatters';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { SkeletonCard } from '@/components/Skeleton';
import { NoteAiActions } from '@/components/NoteAiActions';
import { NoteEditHistory } from '@/components/NoteEditHistory';
import { NoteBacklinks } from '@/components/NoteBacklinks';
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect';
import { recordNoteNav, getNoteBackTarget } from '@/lib/noteNav';
import { LinkedEntitiesBar } from '@/components/LinkedEntitiesBar';
import { TocPanel } from '@/components/TocPanel';
import { ToggleAwareMarkdown } from '@/components/MarkdownPreview';
import { buildToc } from '@/lib/toc';
import { scrollToOverlayItem } from '@/lib/scrollToOverlayItem';
import { resolveAttachmentUrls } from '@/lib/attachmentUrl';
import { useUndoHotkeys, resetUndo } from '@/lib/undoManager';
import { useConfirm } from '@/components/ConfirmProvider';
import { registerNavigationGuard } from '@/lib/navigationGuard';
import { emitNoteActiveCategory } from '@/lib/noteEvents';
import { noteEditChannelName, NOTE_EDIT_MAX_CONTENT, type NoteEditMessage } from '@/lib/noteEditChannel';

// ── 重量級用戶端元件延遲載入（修 #10：dev 模式 Turbopack render worker 崩潰 500）────────────
// 這四個元件（Markdown 編輯器、文字標註層、浮動白板、任務編輯彈窗）合計約 2,900 行，全為
// 互動式，且僅在特定條件下才渲染（編輯中／預覽分頁／開啟任務彈窗），對 SSR 首屏 HTML 無貢獻。
// 原本以靜態 import 全數塞進本路由的伺服器端模組評估圖；在長時運行、HMR 記憶體累積的 dev
// server 上，單一 render worker 編譯／SSR 此超重路由時峰值記憶體過高而崩潰，Next 便回報
//「Jest worker encountered 2 child process exceptions, exceeding retry limit」→ 該頁 500。
// 改用 next/dynamic 且 ssr:false 後：
//   1) 這些模組不再進入伺服器端 render worker 的評估圖，直接消除該 worker 的崩潰來源；
//   2) NoteOverlay／NoteMarksLayer 使用 createPortal（需要 document），本就不適合 SSR。
// 皆為具名匯出，故以 .then 取出對應成員；ssr:false 在本檔（'use client'）中為合法用法。
const MarkdownEditor = dynamic(
  () => import('@/components/MarkdownEditor').then((mod) => mod.MarkdownEditor),
  { ssr: false },
);
const NoteMarksLayer = dynamic(
  () => import('@/components/NoteMarksLayer').then((mod) => mod.NoteMarksLayer),
  { ssr: false },
);
const NoteOverlay = dynamic(
  () => import('@/components/NoteOverlay').then((mod) => mod.NoteOverlay),
  { ssr: false },
);
const TaskEditorModal = dynamic(
  () => import('@/app/tasks/components/TaskEditorModal').then((mod) => mod.TaskEditorModal),
  { ssr: false },
);

/**
 * 解析「站內同源錨點導航」的目的地（capture 階段 document click 的共用過濾）。
 *
 * 這段錨點過濾＋同源目的地解析同時服務本檔兩個 capture 階段的 click 攔截器：
 *   1)「軟離開防護 B」——編輯中有未存變更時，先確認再導頁；
 *   2)「站內筆記連結客戶端導航」——乾淨狀態時，攔內文裸 &lt;a&gt; 改走部分渲染。
 * 兩者「這個點擊算不算一個該攔的站內同源導航、以及要導去哪裡」的判斷完全相同，
 * 故抽成單一純函式避免兩份過濾邏輯日後各自漂移（DRY）。抽取時逐檢查、逐順序保持與
 * 防護 B 原本的行為完全一致——防護 B 久經對抗式復審，語意不得改變；本函式只封裝
 * 「是否攔＋目的地」的純判斷，兩個攔截器各自的額外條件（如只攔 /notes/）與動作
 * （確認導頁／直接 router.push）仍留在各自的 effect 內。
 *
 * @param event capture 階段收到的滑鼠點擊事件
 * @returns 通過全部過濾、且與目前頁面不同的「同源目的地 URL」；任一條件不符則回傳
 *          null（呼叫端據此 return，維持瀏覽器／Next &lt;Link&gt; 的原生行為）。
 */
function resolveSameOriginAnchorTarget(event: MouseEvent): URL | null {
  // 只處理單純左鍵、無修飾鍵的點擊；其餘（開新分頁/中鍵等）交給瀏覽器預設行為。
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }
  const anchor = (event.target as HTMLElement | null)?.closest?.('a');
  if (!anchor) return null;
  // 自管導頁的連結（自己會透過 navigationGuard 確認）→ 不由攔截器插手。
  if (anchor.closest('[data-skip-leave-guard]')) return null;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return null; // 純錨點捲動不算離開
  if (anchor.target && anchor.target !== '_self') return null; // 開新分頁
  if (anchor.hasAttribute('download')) return null;
  // 解析為絕對網址：外部連結（不同 origin）交給瀏覽器預設（由 beforeunload 接手）。
  let destination: URL;
  try {
    destination = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (destination.origin !== window.location.origin) return null;
  // 目的地與目前頁面相同則略過（避免對自身連結誤攔）。
  const current = window.location.pathname + window.location.search;
  if (destination.pathname + destination.search === current) return null;
  return destination;
}

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
  const confirm = useConfirm();
  // 目前登入者（時區顯示）改由共用的 SWR 快取取得，不再與筆記一起手動抓。
  const { data: userData } = useCurrentUser();
  const user = userData ?? null;
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
  // 圖片上傳進行中的數量：>0 時擋「保存」與 AI 動作，
  // 避免把編輯器裡的「〔圖片上傳中 #xxx〕」佔位文字永久存進 DB。
  const [uploadingCount, setUploadingCount] = useState(0);
  // 預覽內文容器參考（供 NoteMarksLayer 套用文字標註）。
  const previewRef = useRef<HTMLDivElement | null>(null);
  // 編輯器 textarea 參考：供「局部排版（重排選取範圍）」讀取目前選取位置。
  const editorTaRef = useRef<HTMLTextAreaElement | null>(null);
  // 編輯彈窗：開啟時筆記頁改顯示「即時預覽（彈窗目前內容）」；null＝彈窗未開、顯示存檔版閱讀畫面。
  const [editPopoutContent, setEditPopoutContent] = useState<string | null>(null);
  const editChannelRef = useRef<BroadcastChannel | null>(null);
  const editPopupRef = useRef<Window | null>(null);
  // 「編輯」按鈕點下展開的小選單：可選「編輯頁（頁內）」或「編輯彈窗（獨立視窗）」。
  const [showEditMenu, setShowEditMenu] = useState(false);

  // 編輯時的分類/標籤：選項池與目前選取。
  // 選項池改由共用的 SWR 快取（useNoteCategories/useNoteTags）供給，並在取得資料時 seed 到
  // 本地 state；本地 state 仍保留，用於承載「就地新增分類/標籤」的樂觀更新（hybrid，與筆記清單頁一致）。
  // 同時解構 mutate，供「就地新增分類/標籤」後主動重新驗證共用快取
  //（SwrProvider 關閉了 revalidateIfStale/revalidateOnFocus，新鮮度須靠操作後主動 mutate 維持），
  // 讓常駐的 Sidebar 與其他消費者立即反映新分類/標籤，避免雙軌狀態不同步。
  const { data: catData, mutate: mutateCategories } = useNoteCategories();
  const { data: tagData, mutate: mutateTags } = useNoteTags();
  const [allCategories, setAllCategories] = useState<NoteCategory[]>([]);
  const [allTags, setAllTags] = useState<NoteTag[]>([]);
  useEffect(() => {
    if (catData) setAllCategories(catData);
  }, [catData]);
  useEffect(() => {
    if (tagData) setAllTags(tagData);
  }, [tagData]);
  const [editCatIds, setEditCatIds] = useState<string[]>([]);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);

  // 計算分類的完整階層路徑（顯示用，例如「工作 / 專案A」）
  const categoryPath = (parentId: string | null | undefined, cats: NoteCategory[]): string => {
    if (!parentId) return '';
    const p = cats.find((c) => c.id === parentId);
    return p ? `${categoryPath(p.parentId, cats)}${p.name} / ` : '';
  };

  // ── 未儲存變更離開防護（#16，對齊 TaskEditorModal 的交易式暫存/放棄確認）─────────────
  // 兩組 id 陣列是否為同一集合（忽略順序）：分類/標籤選取的先後不視為變更。
  const isSameIdSet = (a: readonly string[], b: readonly string[]): boolean => {
    if (a.length !== b.length) return false;
    const other = new Set(b);
    return a.every((id) => other.has(id));
  };

  // 是否有未儲存變更：僅在「編輯中」且四項編輯值與載入的筆記基準不同時為 true。
  const hasUnsavedChanges = useMemo(() => {
    if (!isEditing || !note) return false;
    if (editTitle !== note.title) return true;
    if (editContent !== note.contentRaw) return true;
    const baseCatIds = (note.categories ?? []).map((c) => c.id);
    const baseTagIds = (note.tags ?? []).map((t) => t.id);
    if (!isSameIdSet(editCatIds, baseCatIds)) return true;
    if (!isSameIdSet(editTagIds, baseTagIds)) return true;
    return false;
  }, [isEditing, note, editTitle, editContent, editCatIds, editTagIds]);

  // 有未儲存變更時詢問是否放棄；回傳 Promise<true>＝可離開（沿用 W6 的 ConfirmDialog）。
  const confirmDiscardIfDirty = useCallback(async () => {
    if (!hasUnsavedChanges) return true;
    return confirm({
      title: '放棄未儲存的變更？',
      message:
        '此筆記有未儲存的變更，要放棄並離開嗎？\n' +
        '（標題／內容／分類／標籤的修改，未按「保存」都不會生效。）',
      danger: true,
      confirmLabel: '放棄並離開',
    });
  }, [hasUnsavedChanges, confirm]);

  // 硬離開防護：整頁重新整理／關閉分頁／改網址列時，用瀏覽器原生 beforeunload 警示。
  // （原生對話框無法自訂文案，僅在有未儲存變更時掛上，離開編輯即卸除。）
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 舊瀏覽器需設定 returnValue 才會跳出確認；現代瀏覽器顯示制式文案。
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 軟離開防護 A｜全站導頁守門：把「未儲存變更確認」登記進共用的 navigationGuard，
  // 供所有「以 router.push 導頁但非 <a>」或「自管導頁的 <a>」入口（全域搜尋、指令面板、
  // Header 的『筆記』導覽等）在導頁前徵詢——這是涵蓋全站切換筆記/任務的正確作法
  // （對照 W7 只攔 <a> 的漏洞：div onClick / Enter 鍵路徑完全攔不到）。
  // confirmDiscardIfDirty 於無未儲存變更時直接放行，故非編輯中登記亦無副作用。
  useEffect(() => {
    return registerNavigationGuard(confirmDiscardIfDirty);
  }, [confirmDiscardIfDirty]);

  // 軟離開防護 B｜站內 <a> 連結（如左側欄分類/筆記、內文連結）：App Router 無官方
  // 路由攔截 API，且這類「純 Next <Link>」不會主動呼叫上面的守門，故仍在 capture 階段
  // 攔其點擊，先確認再手動導頁。
  //   注意（修 W7 對抗式復審 finding #1）：此處「只 preventDefault、不 stopPropagation」——
  //   capture 階段對 document 呼叫 stopPropagation 會讓事件根本傳不到 target，
  //   連累別的元件掛在 <a> 上的 onClick（如 Header『筆記』的 handleNotesNav 依 localStorage
  //   導回上次瀏覽的那篇）完全不執行、行為悄悄改變。改為只 preventDefault：Next <Link> 會
  //   因 defaultPrevented 而不自行導頁，其餘 onClick 仍能各自執行。
  //   另對「自管導頁」的 <a>（標記 data-skip-leave-guard，如 Header『筆記』）一律略過，
  //   交由該元件自行透過守門確認，避免雙重導頁/導到錯的目的地。
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleAnchorClick = (event: MouseEvent) => {
      // 錨點過濾＋同源目的地解析抽成共用純函式（見檔案上方 resolveSameOriginAnchorTarget）：
      // 逐檢查、逐順序與本防護原本的行為完全一致，僅去除與下方客戶端導航攔截器的重複，語意不變。
      const destination = resolveSameOriginAnchorTarget(event);
      if (!destination) return;

      // 只攔下預設導頁（Next <Link> 會因 defaultPrevented 而不自行導頁）；
      // 不呼叫 stopPropagation，讓同一 <a> 上其他 onClick 仍能執行自己的邏輯。
      event.preventDefault();
      void confirmDiscardIfDirty().then((canLeave) => {
        if (canLeave) {
          setIsEditing(false); // 先解除編輯，卸除防護後再導頁
          router.push(destination.pathname + destination.search + destination.hash);
        }
      });
    };
    // capture 階段攔截：先於 React 綁在根節點的合成事件與 Next.js Link 的處理。
    document.addEventListener('click', handleAnchorClick, true);
    return () => document.removeEventListener('click', handleAnchorClick, true);
  }, [hasUnsavedChanges, confirmDiscardIfDirty, router]);

  // 站內筆記連結客戶端導航（部分渲染）｜乾淨狀態時攔內文裸 <a>，改走 router.push：
  //   ● 為什麼要攔：查看模式的內文是後端渲染的 HTML 經 dangerouslySetInnerHTML 注入，
  //     內文的站內連結是裸 <a>，點擊會走瀏覽器原生「整頁重載」——白白重抓整個頁面殼、
  //     閃一下白畫面、丟掉前端狀態。改用 router.push 走 App Router 的客戶端導航後，只有
  //     本頁主體重繪（Header／左側欄常駐），與左側欄筆記列（next/link）今天已在用、已驗證
  //     的路徑完全一致：不同 URL 對應不同 cache node，[...slug] 頁元件卸載重掛→重抓該篇→
  //     重廣播分類給側欄，捲動還原（setPreviewNode）／toggle 還原／返回堆疊（recordNoteNav）
  //     皆天然成立，無需另寫還原邏輯。
  //   ● 為什麼只在乾淨狀態（!hasUnsavedChanges）啟用：與上面「軟離開防護 B」互斥——髒狀態
  //     （編輯中有未存變更）一律交給防護 B（它會先跳「放棄變更？」確認再導頁），本攔截器完全
  //     不介入。兩者都以 hasUnsavedChanges 決定是否掛 document click 監聽，任一時刻只有一個
  //     生效（狀態翻轉時舊 effect 卸監聽、新 effect 掛監聽），避免同一點擊被雙重處理或順序耦合。
  //   ● 為什麼只攔 /notes/：本需求只涵蓋「筆記→筆記」的部分渲染。其他 app 路由（首頁／任務／
  //     行事曆…）、/api/... 一律不攔，維持瀏覽器原生整頁行為，避免誤攔到需要整頁載入的目的地。
  //   過濾與同源目的地解析與防護 B 共用 resolveSameOriginAnchorTarget（見檔案上方註解）。
  useEffect(() => {
    if (hasUnsavedChanges) return; // 髒狀態交給防護 B，本攔截器不介入（兩者互斥）
    const handleInternalNoteNavClick = (event: MouseEvent) => {
      const destination = resolveSameOriginAnchorTarget(event);
      if (!destination) return;
      // 只涵蓋筆記→筆記；其餘同源路由維持原生整頁導航（不攔 /api/... 與其他 app 路由）。
      if (!destination.pathname.startsWith('/notes/')) return;

      // 只 preventDefault、不 stopPropagation（理由同防護 B）：讓 Next <Link> 與同一 <a>
      // 上其他 onClick 仍能各自運作，只改由我們以 router.push 走客戶端部分渲染。
      event.preventDefault();
      router.push(destination.pathname + destination.search + destination.hash);
    };
    // capture 階段攔截：先於 Next.js Link 與 React 合成事件（與防護 B 同一機制）。
    document.addEventListener('click', handleInternalNoteNavClick, true);
    return () => document.removeEventListener('click', handleInternalNoteNavClick, true);
  }, [hasUnsavedChanges, router]);

  // 留言狀態
  const [commentContent, setCommentContent] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // 標籤頁
  const [activeTab, setActiveTab] = useState<'preview' | 'comments' | 'history' | 'backlinks' | 'links'>('preview');
  // 「全部收合／展開」單鈕的狀態：false=目前視為全收合（後端 toggle 預設收合），點擊會展開全部並翻轉。
  const [allTogglesExpanded, setAllTogglesExpanded] = useState(false);
  // 「全部收合／展開」的觸發序號：0＝尚未按過。批次寫入 details.open 的 effect 只在序號變動時執行一次——
  // 初載與其他任何重繪都不得批次改寫（否則 :::toggle-open 的預設展開會被壓掉、使用者手動開合會被清空）。
  const [allTogglesSeq, setAllTogglesSeq] = useState(0);

  // 章節目錄表（浮動、可拖曳、可關閉）：預設不開啟，點右下角工具列「📖 目錄」才打開（使用者裁示 2026-07-08）。
  const [tocOpen, setTocOpen] = useState(false);

  // 問題清單：面板開關由本頁工具列鈕控制，面板本體由 NoteOverlay 渲染（需存取 overlay items）。
  // 問題數由 NoteOverlay 透過 onQuestionsChange 回報，供工具列鈕顯示 "❓ 問題清單 (N)"。
  const [questionPanelOpen, setQuestionPanelOpen] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);

  // 本頁捲動容器（.note-detail-page）：記住閱讀位置、下次打開自動捲回（N1）。
  const noteScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSaveRaf = useRef<number | null>(null);
  const noteScrollKey = (noteId: string) => `zonwiki:note-scroll:${noteId}`;
  // 每篇筆記記住 toggle 展開狀態的 key（N-toggle：編輯彈窗/切分頁造成內文區重掛時，
  // 不再讓 toggle 被重新注入的 markdown 預設值蓋掉；同時也是「續讀」功能的一部分）。
  const noteToggleKey = (noteId: string) => `zonwiki:note-toggles:${noteId}`;
  // 目前筆記 id 的最新值：供不隨 note 變動而重建的 setPreviewNode callback 讀取（避免閉包捕捉到舊值）。
  // 直接在 render 期間同步賦值（合法的 React 逃生艙模式），不透過 useEffect——
  // ref callback 與 useLayoutEffect 同屬「commit 階段」執行，早於 useEffect 這類被動效果被 flush，
  // 若改用 useEffect 同步，首次掛載時 setPreviewNode 可能搶先在 noteIdRef 被寫入前執行，讀到 null。
  const noteIdRef = useRef<string | null>(null);
  noteIdRef.current = note?.id ?? null;
  // 以 ref 持有最新 note，供查看模式就地改程式碼區塊 metadata 時讀到最新 contentRaw（避免 stale closure）。
  const noteRef = useRef<NoteDetail | null>(null);
  noteRef.current = note;
  // 查看模式就地改程式碼 metadata 的暫存基準（H2：連續快速改不遺失更新；切換筆記時由下方 effect 重置）。
  // appliedTo＝算此結果時的基準 contentRaw、result＝算出的新 contentRaw，用來偵測 note 是否被別條路徑換掉。
  const readingDraftRef = useRef<{ appliedTo: string; result: string } | null>(null);
  // 即存後 setNote 會整篇重注入，用此旗標讓 observer 在重注入後重套 toggle 展開狀態與捲動位置（M1）。
  const pendingMetaReflowRef = useRef(false);
  useEffect(() => { readingDraftRef.current = null; }, [note?.id]);

  // 讀取某篇筆記記住的 toggle 展開狀態（序號→是否展開的表；壞資料視同沒有）。
  // 包成穩定 useCallback（鍵直接內嵌，不相依外層的 noteToggleKey），供下方兩個 callback 安全列入依賴，
  // 才不會讓 setPreviewNode 每次 render 都重建、導致查看模式內文區被無謂重掛。
  const readToggleMap = useCallback((noteId: string): Record<string, boolean> => {
    try {
      const raw = localStorage.getItem(`zonwiki:note-toggles:${noteId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
      }
    } catch { /* 壞資料視同沒有 */ }
    return {};
  }, []);

  // toggle 的持久化鍵＝「該 toggle 在整篇筆記 .markdown-prose 容器內、依文件順序（含巢狀）的序號」。
  // 為什麼用序號而非標題／錨點 id：查看模式（後端 HTML＋dangerouslySetInnerHTML）與編輯彈窗即時預覽
  // （ToggleAwareMarkdown React 元件）是兩條不同的渲染路徑——前者 summary 有 buildToc 注入的 id、
  // 後者完全沒有。用「容器內第幾個 details.md-toggle」這種兩邊都能一致算出的序號當鍵，才能讓
  // 「查看模式展開 → 開編輯彈窗，即時預覽」延續同一份展開狀態（本次修的正是後者仍全部收合的問題）。
  //
  // 把上次記住的展開狀態套用到容器內的 toggle（沒記到的維持 markdown 預設收合/展開）。
  const applyStoredToggleState = useCallback((container: HTMLElement, noteId: string) => {
    const saved = readToggleMap(noteId);
    container.querySelectorAll<HTMLDetailsElement>('details.md-toggle').forEach((d, index) => {
      if (Object.prototype.hasOwnProperty.call(saved, index)) {
        d.open = saved[index];
      }
    });
  }, [readToggleMap]);

  // 使用者手動點開/收合 toggle（或「全部展開/收合」批次寫入 .open 也會非同步觸發 toggle 事件）時存回 localStorage。
  // 以 target 最近的 .markdown-prose 當容器算序號，故查看模式與編輯彈窗即時預覽兩條路徑共用同一支 handler、
  // 存進同一份以序號為鍵的紀錄。<details> 的 toggle 事件不冒泡，故在容器上以 capture 委派單一監聽。
  const handleToggleChange = useCallback((e: Event) => {
    const nid = noteIdRef.current;
    const target = e.target;
    if (!nid || !(target instanceof HTMLDetailsElement) || !target.classList.contains('md-toggle')) return;
    const container = target.closest<HTMLElement>('.markdown-prose');
    if (!container) return;
    const index = Array.from(container.querySelectorAll<HTMLDetailsElement>('details.md-toggle')).indexOf(target);
    if (index < 0) return;
    const saved = readToggleMap(nid);
    saved[index] = target.open;
    try { localStorage.setItem(noteToggleKey(nid), JSON.stringify(saved)); } catch { /* ignore */ }
  }, [readToggleMap]);

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
  // 只在真正的「查看模式＋預覽分頁」時存——編輯彈窗／編輯頁／其他分頁把內文換成短很多的版面時，
  // 瀏覽器會自動把 scrollTop 夾小（因為 scrollHeight 變短了），這個「夾動」也會觸發 scroll 事件；
  // 若不分辨就存，會把使用者原本讀到一半的真實位置洗成夾動後的 0，回到預覽時自然也還原不回去。
  const handleNoteScroll = useCallback(() => {
    const nid = note?.id;
    if (!nid) return;
    if (isEditing || editPopoutContent !== null || activeTab !== 'preview') return;
    if (scrollSaveRaf.current != null) return;
    scrollSaveRaf.current = requestAnimationFrame(() => {
      scrollSaveRaf.current = null;
      const el = noteScrollRef.current;
      if (el) {
        try { localStorage.setItem(noteScrollKey(nid), String(Math.round(el.scrollTop))); } catch { /* ignore */ }
      }
    });
  }, [note?.id, isEditing, editPopoutContent, activeTab]);

  // 還原捲動位置：改由 setPreviewNode（見下方）在「預覽內文區重新掛載」當下觸發，不再是
  // 「每篇筆記只還原一次」——那個舊限制正是本 bug 的根因之一：編輯彈窗／切分頁只會讓內文區
  // 卸載重掛（note.id 不變），舊效果的 once-guard 會直接跳過，捲動位置就永遠停在重掛當下
  // 瀏覽器因內容變短而夾出來的 0。統一交給 setPreviewNode，涵蓋「首次載入／切換筆記（會整頁
  // 卸載重掛）／編輯彈窗或切分頁切回預覽（只有內文區卸載重掛）」三種情境。
  const restoreScrollPosition = useCallback((noteId: string) => {
    let saved = 0;
    try { saved = Number(localStorage.getItem(noteScrollKey(noteId)) || '0'); } catch { /* ignore */ }
    if (!saved) return;
    // 等內文（含圖片版面）穩定後再捲，避免捲到一半又被非同步載入的圖片撐開版面推走。
    setTimeout(() => {
      // 這 250ms 空窗內若使用者已經切到別篇筆記，noteIdRef 會先變成新筆記的 id——
      // 此時必須放棄，否則會把「這篇」的舊捲動位置套到「新筆記」現正顯示的容器上（兩者共用同一個 DOM 節點）。
      if (noteIdRef.current !== noteId) return;
      const el = noteScrollRef.current;
      if (el) el.scrollTop = saved;
    }, 250);
  }, []);

  // 記住「最後看的筆記」slug：之後從 Header 點「筆記」會直接回到這篇（N1：打開筆記功能＝回到該篇該位置）。
  useEffect(() => {
    if (note?.id && slug) {
      try { localStorage.setItem('zonwiki:last-note-slug', slug); } catch { /* ignore */ }
      // 記錄到「筆記情境返回堆疊」：抵達此筆記頁時 push（供返回鈕只在筆記情境內移動）。
      recordNoteNav(window.location.pathname + window.location.search);
    }
  }, [note?.id, slug]);
  // 由內文 HTML 萃取章節（h1/h2/h3 標題＋ :::toggle 摘要）並補上錨點 id（供目錄點擊捲動）。
  // 附件圖片 src 先由相對路徑補成 API 絕對網址（本地 dev 前後端跨埠時 <img> 才載得到）。
  const { html: previewHtml, toc } = useMemo(
    () => (note ? buildToc(resolveAttachmentUrls(note.contentHtml)) : { html: '', toc: [] }),
    [note],
  );
  // 【關鍵】dangerouslySetInnerHTML 的物件必須「識別穩定」（memo 化）——
  // React 19 的 commitUpdate 以物件識別比較此 prop，若每次 render 都是新的 {__html} 字面量，
  // 任何不相關的重繪（例如點「📖 目錄」改 tocOpen）都會重新注入 innerHTML，
  // 把所有 <details> 重建成預設收合、也順帶清掉畫重點的 DOM 包裹（2026-07-08 以位元組級插樁證實：
  // 重注入的內容與原內容完全相同，純屬白做工的破壞性重寫）。
  const previewHtmlObj = useMemo(() => ({ __html: previewHtml }), [previewHtml]);

  // 「全部展開／收合」：以 effect 套用到目前 DOM 的所有 details（點擊當下的重繪會先重注入內文，
  // effect 於其後執行故一定生效）。只在「按鈕真的被按下」（序號變動）時批次寫入——
  // 先前以 [allTogglesExpanded, previewHtml] 為依賴，初載就會把 :::toggle-open 壓成收合，
  // 且任何 previewHtml 識別變動都會清空使用者手動的開合狀態。
  useEffect(() => {
    if (allTogglesSeq === 0) return; // 尚未按過 → 尊重 markdown 預設與使用者手動狀態
    previewRef.current
      ?.querySelectorAll<HTMLDetailsElement>('details.md-toggle')
      .forEach((d) => { d.open = allTogglesExpanded; });
  }, [allTogglesSeq, allTogglesExpanded]);

  // 共用「復原 / 重做」：手繪塗鴉與畫重點共用同一條 Ctrl+Z 堆疊，僅在預覽分頁掛上單一鍵盤監聽。
  useUndoHotkeys(activeTab === 'preview');
  // 切換筆記時清空堆疊，避免跨筆記誤復原。
  useEffect(() => {
    resetUndo();
    return () => resetUndo();
  }, [note?.id]);

  // 預覽容器的 callback ref：掛載當下就把程式碼區塊美化（VS Code 語法上色＋檔名/語言標題列＋複製鈕），
  // 並以 MutationObserver 持續處理之後才出現/重繪的區塊。同時把 node 存回 previewRef，供 NoteMarksLayer / NoteOverlay 使用。
  // 註：enhanceReadingCodeBlocks 會包一層 .code-block（本身也是 DOM 變動），但對已包裝者會跳過，故不會無限迴圈。
  //
  // 這裡也是「續讀」的還原時機：這個 div 每次（重新）掛載，就代表 dangerouslySetInnerHTML 剛注入
  // 一份全新內容（markdown 預設的 toggle 開合狀態），不論起因是首次載入、切換到別篇筆記（會整頁
  // 卸載重掛）、或是編輯彈窗／切分頁切回預覽（只有這個 div 卸載重掛，note.id 不變）——三種情境都
  // 統一在此還原，取代舊版「每篇筆記只還原一次」的捲動還原（會漏掉後兩種情境）。
  // 查看模式「就地改程式碼區塊 metadata 即存」：在閱讀檢視改檔名／語言 → 算出這是第幾個程式碼區塊
  // → 改寫 Markdown 圍欄（```lang:filename）→ 即時存 DB，並以回傳的最新版重繪（不必進編輯模式）。
  // 索引以「變更當下查 DOM 的 .code-block 文件順序」算出，與 setCodeFenceMeta 的文件順序掃描對齊
  // （同編輯預覽既有機制）；用 noteRef 讀最新 contentRaw 避免 stale closure。
  const handleReadingCodeMeta = useCallback((fenceLine: number, lang: string, filename: string) => {
    const cur = noteRef.current;
    if (!cur) return;
    // H2：draft 記錄「基於哪份 contentRaw（appliedTo）算出哪份結果（result）」。只有當前 note 仍停在
    // draft 起點（in-flight、尚未 setNote）或已成為 draft 結果（本函式存回）時才續用 draft 當基準；
    // 若 note.contentRaw 已被別條路徑（編輯彈窗／編輯頁／AI 保存）換掉，draft 即失效、改以最新
    // note.contentRaw 為基準——否則會用過期 draft 覆寫掉別條路徑的整篇編輯（靜默資料遺失）。
    const draft = readingDraftRef.current;
    const draftValid = draft !== null && (cur.contentRaw === draft.appliedTo || cur.contentRaw === draft.result);
    const base = draftValid ? draft.result : cur.contentRaw;
    const nextRaw = setFenceMetaAtLine(base, fenceLine, lang, filename);
    if (nextRaw === base) return; // 行號無對應圍欄或無實際變更 → 不打擾
    readingDraftRef.current = { appliedTo: base, result: nextRaw };
    updateNote(cur.id, { contentRaw: nextRaw })
      .then((latest) => {
        if (latest) {
          pendingMetaReflowRef.current = true; // M1：重注入後由 observer 重套 toggle 展開狀態與捲動位置
          setNote(latest);
        } else {
          showToast('程式碼區塊資訊儲存失敗，請稍後再試', { type: 'error' });
        }
      })
      .catch(() => showToast('程式碼區塊資訊儲存失敗，請稍後再試', { type: 'error' }));
  }, []);

  const previewObsRef = useRef<MutationObserver | null>(null);
  const setPreviewNode = useCallback((node: HTMLDivElement | null) => {
    previewRef.current = node;
    previewObsRef.current?.disconnect();
    previewObsRef.current = null;
    if (!node) return;
    enhanceReadingCodeBlocks(node, handleReadingCodeMeta);
    const nid = noteIdRef.current;
    // 表格增強（可拖曳調寬＋記住寬度）與程式碼區塊美化同一時機處理；欄寬還原需要 noteId。
    enhanceReadingTables(node, nid);
    if (nid) {
      applyStoredToggleState(node, nid);
      restoreScrollPosition(nid);
    }
    node.addEventListener('toggle', handleToggleChange, true);
    // 重注入後（React 19 會清掉就地 DOM 改動）由 observer 重跑兩者：程式碼美化＋表格增強（會從 localStorage 還原欄寬）。
    const obs = new MutationObserver(() => {
      enhanceReadingCodeBlocks(node, handleReadingCodeMeta);
      enhanceReadingTables(node, noteIdRef.current);
      // 就地改程式碼 metadata 即存後的整篇重注入：重套使用者的 toggle 展開狀態與捲動位置，
      // 避免「讀到一半改個語言就把展開的段落全收合、畫面跳回頂端」（只認即存觸發的那次重注入，
      // 不干擾一般 DOM 變動如畫記包字）。
      if (pendingMetaReflowRef.current) {
        pendingMetaReflowRef.current = false;
        const reflowNid = noteIdRef.current;
        if (reflowNid) {
          applyStoredToggleState(node, reflowNid);
          restoreScrollPosition(reflowNid);
        }
      }
    });
    obs.observe(node, { childList: true, subtree: true });
    previewObsRef.current = obs;
  }, [applyStoredToggleState, restoreScrollPosition, handleToggleChange, handleReadingCodeMeta]);

  // 編輯彈窗「即時預覽」容器的 callback ref：這條路徑用 ToggleAwareMarkdown（React 元件）渲染，
  // 與查看模式的 dangerouslySetInnerHTML 是兩套 DOM，但同為 .markdown-prose 容器、同以序號記憶 toggle。
  // 掛載當下套用記住的展開狀態（否則一開編輯彈窗，即時預覽會把所有 toggle 掉回 markdown 預設收合），
  // 並掛上同一支 toggle 監聽讓在即時預覽裡的開合也存回同一份紀錄。此 callback 為穩定 useCallback，
  // 只在該 div 真正掛載/卸載時被呼叫，鍵入預覽內容時不會重複掛監聽。
  const setLivePreviewNode = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const nid = noteIdRef.current;
    if (nid) applyStoredToggleState(node, nid);
    node.addEventListener('toggle', handleToggleChange, true);
  }, [applyStoredToggleState, handleToggleChange]);

  // 把「目前筆記所屬分類」廣播給左側欄，讓它標示「📍 此筆記在這」（避免迷路）。
  // 用分類 id 串接當相依，分類載入/切換筆記時更新；離開時清空。
  const noteCatIdsKey = (note?.categories ?? []).map((c) => c.id).join(',');
  useEffect(() => {
    const ids = noteCatIdsKey ? noteCatIdsKey.split(',') : [];
    emitNoteActiveCategory(ids);
    return () => emitNoteActiveCategory([]);
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

  // 讀取 ?overlay= 用來從搜尋結果 / 問題清單跳轉到某個浮層元件（便利貼 / T 文字框）位置。
  const overlayId = searchParams.get('overlay');

  // 捲動到浮層元件位置並短暫高亮（定位邏輯抽成共用 util，問題清單面板點列項目也複用同一份）。
  useEffect(() => {
    if (!overlayId) return;
    return scrollToOverlayItem(overlayId);
  }, [overlayId, previewHtml, note?.id]);

  // 載入筆記詳細（分類/標籤選項池與使用者已改由 SWR 供給，故此處只抓筆記本身）
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const noteData = await getNote(slug);

        if (noteData) {
          setNote(noteData);
          setEditTitle(noteData.title);
          setEditContent(noteData.contentRaw);
          setEditCatIds((noteData.categories ?? []).map((c) => c.id));
          setEditTagIds((noteData.tags ?? []).map((t) => t.id));

          // 記錄「最後打開時間」（供筆記清單依此排序；輕量、失敗靜默）。
          // 併發修正（#4/#34）：標記打開會 UPDATE 該列、使 xmin 前進，令上面剛記下的 note.version
          // 立刻過期；後端會回傳更新後的最新版本，這裡據此把 note.version 同步成最新，避免「開啟後直接
          // 編輯→存檔」撲空、收到假的 409「此筆記已被其他來源修改」。只覆寫 version 欄，並確認仍停在
          // 同一篇（避免使用者已切走到別篇時誤蓋版本）。
          markNoteOpened(noteData.id).then((openedVersion) => {
            if (openedVersion != null) {
              // 單調取大（防亂序覆寫）：xmin 隨該列每次更新遞增；同一筆記可能觸發多次 /opened
              // （React StrictMode 雙掛載、快速切回同一篇、同篇開多分頁），其 HTTP 回應可能亂序抵達。
              // 若無條件覆寫，較舊回應會把 note.version 蓋回過期值 → 存檔又撞假 409。故只在「新版本
              // 較大（＝更新）」時採用、永不回退（存檔後更大的 xmin 也不會被較舊的 /opened 回應蓋掉）。
              setNote((prev) =>
                prev && prev.id === noteData.id
                  ? { ...prev, version: Math.max(prev.version ?? 0, openedVersion) }
                  : prev
              );
            }
          });

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

    // 前端先擋：標題不可為空（與後端規則一致，給即時回饋、免一次無謂往返）。
    if (!editTitle.trim()) {
      setError('標題不可為空');
      return;
    }
    // 防線放在函式本體（非只有按鈕 disabled）：任何呼叫入口都不可在圖片上傳中保存，
    // 避免把「〔圖片上傳中 #xxx〕」佔位文字永久存進 DB。
    if (uploadingCount > 0) {
      setError('圖片上傳中，請稍候再保存');
      return;
    }

    // 以指定 baseVersion 送出更新（undefined＝不做併發檢查、覆蓋）。
    const doUpdate = (baseVersion?: number) =>
      updateNote(note.id, {
        title: editTitle,
        contentRaw: editContent,
        categoryIds: editCatIds,
        tagIds: editTagIds,
        baseVersion,
      });

    try {
      setIsSaving(true);

      let saved: NoteDetail | null;
      try {
        // 樂觀鎖（#4/#34）：帶目前載入版本，偵測「載入後是否被其他來源改過」。
        saved = await doUpdate(note.version);
      } catch (e) {
        if (e instanceof ConflictError) {
          const reload = await confirm({
            title: '筆記已被修改',
            message:
              '此筆記已被其他來源修改。\n\n' +
              '按「確定」重新載入最新版本（放棄本次修改）；\n' +
              '按「取消」以您目前的內容覆蓋。',
          });
          if (reload) {
            const latest = await getNote(slug);
            if (latest) {
              setNote(latest);
              setEditTitle(latest.title);
              setEditContent(latest.contentRaw);
              setEditCatIds((latest.categories ?? []).map((c) => c.id));
              setEditTagIds((latest.tags ?? []).map((t) => t.id));
            }
            setError('此筆記已被其他來源修改，已載入最新版本，請重新確認後再儲存。');
            return;
          }
          // 覆蓋：不帶 baseVersion 再送一次（last-write-wins）。
          saved = await doUpdate(undefined);
        } else {
          throw e;
        }
      }

      // 保存失敗（後端回 400 等，updateNote 會回 null）：維持編輯模式並提示，
      // 絕不可誤判成功而退出編輯、靜默丟失本次的內容／分類／標籤修改。
      if (!saved) {
        setError('保存失敗，請檢查內容後再試一次。');
        return;
      }

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

  // ── 編輯彈窗（獨立視窗）＋筆記頁即時預覽 ──
  /** 關閉編輯彈窗：關掉獨立視窗、釋放頻道、筆記頁回到「存檔版」閱讀畫面（丟棄未存的預覽）。冪等。 */
  const closeEditPopout = useCallback(() => {
    editChannelRef.current?.close();
    editChannelRef.current = null;
    try { editPopupRef.current?.close(); } catch { /* 跨視窗關閉可能受限 */ }
    editPopupRef.current = null;
    setEditPopoutContent(null);
  }, []);

  /**
   * 開啟「編輯彈窗」獨立視窗：以目前 DB 內容為起點；筆記頁改顯示即時預覽（渲染彈窗當前內容）。
   * 彈窗編輯 → 即時回推預覽；彈窗保存 → 存 DB 並重抓筆記（關窗後即是存檔版）；關窗 → 回存檔版閱讀。
   *
   * 隔離設計：每次開啟都產生一次性 token，用來（a）組出專屬 BroadcastChannel 名稱、
   * （b）當作獨立視窗名稱，避免「同源多個筆記分頁 / 多個彈窗」互相串頻道或搶同一視窗。
   * useCallback 綁定當前 note/slug；切換筆記時外層 effect 會先關掉舊彈窗（見下方 [slug] 清理）。
   */
  const openEditPopout = useCallback(() => {
    if (!note) return;
    if (editPopoutContent !== null) { editPopupRef.current?.focus(); return; }
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    // 一次性 session token：隔離本次「筆記頁 ↔ 彈窗」的頻道與視窗。
    const token =
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${note.id}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

    const ch = new BroadcastChannel(noteEditChannelName(token));
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as NoteEditMessage | null;
      if (d?.type === 'edit-ready') {
        ch.postMessage({
          type: 'edit-init',
          init: {
            noteId: note.id,
            slug,
            title: note.title,
            content: note.contentRaw,
            categoryIds: (note.categories ?? []).map((c) => c.id),
            tagIds: (note.tags ?? []).map((t) => t.id),
          },
        });
      } else if (d?.type === 'edit-content') {
        // 防呆：只接受字串、且長度在上限內（避免異常/惡意訊息灌爆渲染）。
        if (typeof d.content === 'string' && d.content.length <= NOTE_EDIT_MAX_CONTENT) {
          setEditPopoutContent(d.content);
        }
      } else if (d?.type === 'edit-saved') {
        getNote(slug).then((updated) => { if (updated) setNote(updated); }).catch(() => {});
      } else if (d?.type === 'edit-closing') {
        closeEditPopout();
      }
    };

    // 先開視窗，成功才進入即時預覽；被瀏覽器擋掉（回傳 null）就還原、提示，不留下「有預覽卻無彈窗」的死狀態。
    const popup = window.open(
      `/notes/edit-popout?ch=${encodeURIComponent(token)}`,
      `zonwiki-note-edit-${token}`,
      'width=1000,height=980,menubar=no,toolbar=no,location=no,status=no',
    );
    if (!popup) {
      ch.close();
      setError('編輯彈窗被瀏覽器阻擋，請允許此站開啟彈出視窗後再試，或改用「編輯頁」。');
      return;
    }
    editChannelRef.current = ch;
    editPopupRef.current = popup;
    setEditContent(note.contentRaw);
    setEditPopoutContent(note.contentRaw); // 起始即時預覽＝目前存檔內容
  }, [note, slug, editPopoutContent, closeEditPopout]);

  // 偵測編輯彈窗被關閉（使用者直接關視窗）→ 筆記頁回存檔版。
  // 注意：彈窗初次載入（尤其 dev 首次編譯 /notes/edit-popout 路由）可能數秒後才 attach，
  // 這段期間 window.open 回傳的參考其 `.closed` 可能短暫為 true。因此加上：
  //   1. 啟動寬限（前 GRACE 毫秒不判定），等彈窗真正 attach；
  //   2. 連續兩次讀到 closed 才視為關閉，避免單次瞬時誤判把即時預覽關掉。
  // 真正的關閉另有 pagehide/beforeunload → 'edit-closing' 訊息即時處理（見 edit-popout 頁）。
  useEffect(() => {
    if (editPopoutContent === null) return;
    const GRACE_MS = 3000;
    const startedAt = Date.now();
    let closedStreak = 0;
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt < GRACE_MS) return;
      if (editPopupRef.current?.closed) {
        closedStreak += 1;
        if (closedStreak >= 2) closeEditPopout();
      } else {
        closedStreak = 0;
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [editPopoutContent, closeEditPopout]);

  // 切換到不同筆記（App Router 重用本元件、只有 slug 變）或卸載時，關掉舊筆記的編輯彈窗與即時預覽，
  // 避免舊筆記的預覽/頻道/視窗殘留到新筆記頁（cleanup 在 slug 改變前與卸載時各跑一次）。
  useEffect(() => {
    return () => { closeEditPopout(); };
  }, [slug, closeEditPopout]);

  // 編輯選單開啟時，按 Esc 關閉（鍵盤可用性）。
  useEffect(() => {
    if (!showEditMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowEditMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showEditMenu]);

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
    if (!note || !(await confirm({ message: '確定要刪除此筆記嗎？', danger: true }))) return;

    try {
      await deleteNote(note.id);
      // 導向筆記清單
      window.location.href = '/notes';
    } catch {
      setError('無法刪除筆記，請稍後重試。');
    }
  };

  // 複製筆記（#7）：以本篇建立一則副本（標題加「(副本)」，帶內容/分類/標籤），成功後導向新筆記。
  const [duplicatingNote, setDuplicatingNote] = useState(false);
  const handleDuplicateNote = async () => {
    if (!note || duplicatingNote) return;
    setDuplicatingNote(true);
    try {
      const dup = await duplicateNote(note);
      if (dup?.slug) router.push(`/notes/${encodeURIComponent(dup.slug)}`);
      else setError('無法複製筆記，請稍後重試。');
    } catch {
      setError('無法複製筆記，請稍後重試。');
    } finally {
      setDuplicatingNote(false);
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
            onClick={async () => {
              // 編輯中：先確認未儲存變更（#16），放棄才退出編輯、切回閱讀（不走返回堆疊、不離開本頁）。
              if (isEditing) {
                if (await confirmDiscardIfDirty()) {
                  setIsEditing(false);
                }
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
              {/* 問題清單（只在預覽分頁顯示，因浮層問題只在預覽渲染）：點擊開/關由 NoteOverlay 渲染的問題面板。 */}
              {activeTab === 'preview' && (
                <button
                  onClick={() => setQuestionPanelOpen((v) => !v)}
                  className="btn-secondary"
                  title="檢視本篇所有問題（便利貼／T 文字框標記為問題者）"
                  aria-pressed={questionPanelOpen}
                >
                  ❓ 問題清單 ({questionCount})
                </button>
              )}
              {/* 一鍵收合／展開整頁摺疊區塊（單鈕切換；只在預覽分頁、且內容真的有 toggle 時才出現）。
                  toggle 是後端渲染的原生 <details>，直接設 .open 即可。 */}
              {activeTab === 'preview' && previewHtml.includes('md-toggle') && (
                <button
                  onClick={() => { setAllTogglesExpanded((v) => !v); setAllTogglesSeq((s) => s + 1); }}
                  className="btn-secondary"
                  title={allTogglesExpanded ? '收合整頁所有摺疊區塊' : '展開整頁所有摺疊區塊'}
                >
                  {allTogglesExpanded ? '⊟ 全部收合' : '⊞ 全部展開'}
                </button>
              )}
              {/* 「編輯」→ 展開兩種編輯方式：頁內編輯頁 或 獨立編輯彈窗。 */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setShowEditMenu((v) => !v)}
                  className="btn-primary"
                  style={{ minHeight: 44 }}
                  title="編輯此筆記（可選編輯頁或編輯彈窗）"
                  aria-haspopup="menu"
                  aria-expanded={showEditMenu}
                >
                  ✏️ 編輯 ▾
                </button>
                {showEditMenu && (
                  <>
                    {/* 點空白處關閉選單 */}
                    <div onClick={() => setShowEditMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div
                      role="menu"
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        zIndex: 41,
                        minWidth: 220,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setEditTitle(note.title);
                          setEditContent(note.contentRaw);
                          setEditCatIds((note.categories ?? []).map((c) => c.id));
                          setEditTagIds((note.tags ?? []).map((t) => t.id));
                          setIsEditing(true);
                          setShowEditMenu(false);
                        }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                          padding: '10px 14px', background: 'transparent', border: 'none',
                          borderBottom: '1px solid var(--border-default)', cursor: 'pointer',
                          textAlign: 'left', fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                        }}
                      >
                        📄 編輯頁
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>在本頁內直接編輯</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { setShowEditMenu(false); openEditPopout(); }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                          padding: '10px 14px', background: 'transparent', border: 'none',
                          cursor: 'pointer', textAlign: 'left', fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                        }}
                      >
                        🪟 編輯彈窗
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>獨立視窗；本頁即時預覽</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleDuplicateNote}
                className="btn-secondary"
                disabled={duplicatingNote}
                title="複製成一則新筆記（標題加「(副本)」，帶內容／分類／標籤）"
              >
                {duplicatingNote ? '複製中…' : '⧉ 複製'}
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

        {/* 編輯彈窗開啟中：筆記頁顯示「即時預覽」（渲染彈窗當前內容，非永久；關窗回存檔版）。 */}
        {editPopoutContent !== null ? (
          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', marginBottom: 'var(--spacing-4)', background: 'var(--bg-surface-secondary)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <span>✏️ 編輯視窗開啟中 — 以下為<b>即時預覽</b>（非永久）。在編輯視窗按「💾 保存」才會存檔；關閉編輯視窗即回到存檔版。</span>
              <span style={{ flex: 1 }} />
              <button className="btn-secondary" style={{ fontSize: 'var(--text-xs)' }} onClick={() => editPopupRef.current?.focus()}>切到編輯視窗</button>
              <button className="btn-secondary" style={{ fontSize: 'var(--text-xs)' }} onClick={closeEditPopout}>結束編輯</button>
            </div>
            <div ref={setLivePreviewNode} className="markdown-prose" style={{ background: 'var(--bg-surface)', padding: 'var(--spacing-6)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
              {editPopoutContent.trim() ? <ToggleAwareMarkdown value={editPopoutContent} /> : <span style={{ color: 'var(--text-tertiary)' }}>（空白）</span>}
            </div>
          </div>
        ) : isEditing ? (
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
                  onClick={async () => {
                    // 關閉編輯前，若有未儲存變更先詢問是否放棄（#16）。
                    if (await confirmDiscardIfDirty()) setIsEditing(false);
                  }}
                  className="btn-secondary"
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="btn-primary"
                  disabled={isSaving || aiBusy || uploadingCount > 0}
                  title={
                    aiBusy
                      ? 'AI 處理中，請稍候…'
                      : uploadingCount > 0
                        ? '圖片上傳中，請稍候…'
                        : undefined
                  }
                >
                  {isSaving ? '保存中...' : uploadingCount > 0 ? '圖片上傳中…' : '💾 保存'}
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
                        // 重新驗證共用快取，讓 Sidebar 等消費者立即看到新分類
                        mutateCategories();
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
                        // 重新驗證共用快取，讓 Sidebar 等消費者立即看到新標籤
                        mutateTags();
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
                disabled={isSaving || uploadingCount > 0}
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
              onUploadingChange={setUploadingCount}
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
                  dangerouslySetInnerHTML={previewHtmlObj}
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
                  questionPanelOpen={questionPanelOpen}
                  onQuestionPanelOpenChange={setQuestionPanelOpen}
                  onQuestionsChange={(qs) => setQuestionCount(qs.length)}
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
