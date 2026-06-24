/**
 * API 客戶端 — 強型別、支援 SSR/CSR
 *
 * 後端基礎 URL: http://localhost:5009 (開發)
 * 環境變數:
 *   - NEXT_PUBLIC_API_URL: 瀏覽器用 (預設 http://localhost:5009)
 *   - API_INTERNAL_URL: SSR 用 (容器內服務名稱，可選)
 *
 * 回應格式: { success: boolean, data: T, error?: string, statusCode?: number }
 */

const BROWSER_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5009";

/**
 * 取得 API 基礎 URL
 * - SSR 時可用內部服務名稱
 * - 瀏覽器時用公開 URL
 */
function apiBase(): string {
  if (typeof window === "undefined") {
    return (
      process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:5009"
    );
  }
  return BROWSER_API_BASE;
}

// ============================================================================
// API 回應包裝
// ============================================================================

/**
 * API 統一回應格式
 */
export interface ApiResponse<T = unknown> {
  /** 請求是否成功 */
  success: boolean;
  /** 回傳資料 (成功時) */
  data?: T | null;
  /** 錯誤訊息 (失敗時) */
  error?: string | null;
  /** HTTP 狀態碼 */
  statusCode?: number;
}

// ============================================================================
// 資料型別 — User / Settings
// ============================================================================

/**
 * 當前使用者
 */
export interface CurrentUser {
  /** 使用者 ID (GUID 字串) */
  userId: string;
  /** Email */
  email: string;
  /** 顯示名稱 */
  displayName: string;
  /** 頭像 URL (可選) */
  avatarUrl?: string | null;
  /** 時區 (IANA, e.g. "Asia/Taipei") */
  timeZone?: string;
  /** 顯示模式 (warmpaper|light|dark|night) */
  displayMode?: "warmpaper" | "light" | "dark" | "night";
}

/**
 * 使用者設定
 */
export interface UserSettings {
  /** 時區 (IANA) */
  timeZone: string;
  /** 顯示模式 */
  displayMode: "warmpaper" | "light" | "dark" | "night";
  /** 快捷鍵自訂覆寫的 JSON 字串（{ "動作ID": "按鍵" }）；null/缺省＝沿用預設 */
  shortcutsJson?: string | null;
}

// ============================================================================
// 資料型別 — Note (筆記)
// ============================================================================

/**
 * 筆記分類
 */
export interface NoteCategory {
  /** 分類 ID */
  id: string;
  /** 父分類 ID (階層結構) */
  parentId?: string | null;
  /** 分類名稱 */
  name: string;
  /** 該分類下的筆記數 */
  noteCount: number;
  /** 該分類的標籤 */
  tags?: { id: string; name: string }[];
  /** @deprecated 相容舊欄位名 */
  articleCount?: number;
  /** @deprecated 相容舊欄位名 */
  folderPath?: string;
}

/**
 * 筆記標籤（用於筆記編輯）
 */
export interface NoteTagDetail {
  /** 標籤 ID */
  id: string;
  /** 標籤名稱 */
  name: string;
}

/**
 * 筆記標籤（用於過濾與清單）
 */
export interface NoteTag {
  /** 標籤 ID */
  id: string;
  /** 標籤名稱 */
  name: string;
  /** 該標籤下的筆記數 */
  noteCount: number;
}

/**
 * 筆記摘要 (列表檢視)
 */
export interface NoteSummary {
  /** 筆記 ID */
  id: string;
  /** 標題 */
  title: string;
  /** URL 友善的 slug */
  slug: string;
  /** 所屬分類（多對多；清單批次操作的衝突判斷與顯示用） */
  categories?: { id: string; name: string }[];
  /** 貼上的標籤（多對多；清單批次操作判斷選取狀態用） */
  tags?: { id: string; name: string }[];
  /** 所屬分類 ID */
  categoryId?: string | null;
  /** 所屬分類名稱 */
  categoryName?: string;
  /** 更新時間 (UTC) */
  updatedDateTime: string;
  /** 是否為草稿 */
  isDraft?: boolean;
  /** @deprecated 相容舊欄位名 */
  filePath?: string;
}

/**
 * 筆記詳細資訊
 */
export interface NoteDetail {
  /** 筆記 ID */
  id: string;
  /** 標題 */
  title: string;
  /** URL slug */
  slug: string;
  /** 原始 Markdown 內容 */
  contentRaw: string;
  /** 渲染後的 HTML 內容 */
  contentHtml: string;
  /** 所屬分類 */
  categories?: NoteCategory[];
  /** 標籤列表 */
  tags?: NoteTag[];
  /** 建立時間 (UTC) */
  createdDateTime: string;
  /** 更新時間 (UTC) */
  updatedDateTime: string;
  /** 留言數量 */
  commentCount: number;
  /** 是否為草稿 */
  isDraft?: boolean;
  /** @deprecated 相容舊欄位名 */
  categoryId?: string;
  /** @deprecated 相容舊欄位名 */
  categoryName?: string;
  /** @deprecated 相容舊欄位名 */
  filePath?: string;
}

/**
 * 留言
 */
export interface Comment {
  /** 留言 ID */
  id: string;
  /** 所屬筆記 ID */
  noteId: string;
  /** 留言者使用者 ID */
  userId: string;
  /** 留言者名稱 */
  authorName: string;
  /** 留言者頭像 URL */
  authorAvatarUrl?: string | null;
  /** 留言內容 */
  content: string;
  /** 建立時間 (UTC) */
  createdDateTime: string;
}

// ============================================================================
// 資料型別 — Task (任務)
// ============================================================================

/**
 * 任務卡片
 */
export interface TaskCard {
  /** 任務 ID */
  id: string;
  /** 標題 */
  title: string;
  /** 內容 (Markdown) */
  content?: string;
  /** 狀態 (todo|doing|done) */
  status: string;
  /** 優先級 (0-3) */
  priority?: number;
  /** 計畫完成時間 (UTC, 可選) */
  plannedDateTime?: string | null;
  /** 截止時間 (UTC, 可選) */
  dueDateTime?: string | null;
  /** 所屬群組 ID */
  groupId?: string | null;
  /** 排序序號 */
  sortOrder?: number;
  /** 重複規則 (iCal RRULE) */
  recurrenceRule?: string | null;
  /** 父任務 ID（null = 頂層任務；非 null = 某任務的子任務）。#8：子任務＝有父任務的任務 */
  parentId?: string | null;
  /** 子任務總數 (清單/看板卡片顯示進度用) */
  subTaskTotal?: number;
  /** 已完成的子任務數 */
  subTaskDone?: number;
  /** 子任務清單 (清單/看板卡片在外層直接顯示，詳情也會帶回) */
  subTasks?: SubTask[];
  /** 標籤 (與筆記共用標籤庫；清單與詳情都會帶回) */
  tags?: { id: string; name: string }[];
  /** 建立時間 (UTC) */
  createdDateTime: string;
  /** 更新時間 (UTC) */
  updatedDateTime: string;
}

/**
 * 子任務（任務卡片底下的檢核清單項目）
 */
export interface SubTask {
  /** 子任務 ID */
  id: string;
  /** 所屬任務卡片 ID */
  taskCardId: string;
  /** 標題 */
  title: string;
  /** 是否已完成 */
  isDone: boolean;
  /** 卡片內排序序號 */
  sortOrder: number;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime?: string;
  /** 完成時間 (UTC ISO 字串；未完成為 null) */
  completedDateTime?: string | null;
}

/**
 * 任務群組（前端以「分類」呈現：用來把任務分到工作/SideProject/研究等情境）
 */
export interface TaskGroup {
  /** 群組（分類）ID */
  id: string;
  /** 名稱 */
  name: string;
  /** 顏色標籤 (可選，HEX 值) */
  color?: string;
  /** 該分類中的任務數 */
  taskCount: number;
}

// ============================================================================
// 資料型別 — 其他 (快速連結、捕捉等)
// ============================================================================

/**
 * 常用連結卡
 */
export interface QuickLink {
  /** 連結 ID */
  id: string;
  /** 標題 */
  title: string;
  /** URL */
  url: string;
  /** 圖示鍵 (可選) */
  iconKey?: string;
  /** 分類 (自由文字；常用連結自有、非與筆記共用；可空＝未分類) */
  category?: string | null;
  /** 標籤 (與筆記/任務共用標籤庫) */
  tags?: { id: string; name: string }[];
}

/**
 * 快速捕捉項目 (Inbox)
 */
export interface CaptureItem {
  /** 捕捉 ID */
  id: string;
  /** 來源 (web|voice|text) */
  source: "web" | "voice" | "text";
  /** 原始內容 (文字或轉錄) */
  rawContent: string;
  /** 錄音檔案路徑 (若為語音) */
  audioPath?: string | null;
  /** 狀態 (inbox|filed) */
  status: "inbox" | "filed";
  /** 歸檔目標類型 (note|taskcard，未歸檔時為空) */
  filedTargetType?: string | null;
  /** 歸檔目標 ID (未歸檔時為空) */
  filedTargetId?: string | null;
  /** 建立時間 (UTC) */
  createdDateTime: string;
}

/**
 * 當週簡化日曆資料（首頁用）
 */
export interface WeeklyCalendarSummary {
  /** 該週開始日期 (UTC) */
  startDate: string;
  /** 該週結束日期 (UTC) */
  endDate: string;
  /** 該週的任務卡片清單 */
  tasks: TaskCard[];
  /** 該週的日記清單 */
  journalNotes: NoteSummary[];
}

/**
 * 首頁聚合資料（一次回傳首頁所需的所有資料）
 */
export interface HomePageAggregate {
  /** 當週日曆精簡資料 */
  weeklyCalendar: WeeklyCalendarSummary;
  /** 今日待辦清單（狀態 = todo / doing） */
  todayTodos: TaskCard[];
  /** 常用連結卡清單 */
  quickLinks: QuickLink[];
  /** 最近 5 個捕捉項目 */
  recentCaptures: CaptureItem[];
}

// ============================================================================
// 搜尋相關
// ============================================================================

/**
 * 搜尋結果 (統合)
 */
export interface SearchResult {
  /** 類型 (note|task|canvas|node|quicklink) */
  type: "note" | "task" | "canvas" | "node" | "quicklink";
  /** 結果 ID */
  id: string;
  /** 標題 */
  title: string;
  /** 摘要 (可選) */
  snippet?: string;
  /** 關聯 URL */
  url: string;
}

// ============================================================================
// 內部函式 — 通用 fetch wrapper
// ============================================================================

/**
 * 通用 JSON fetch 函式，自動處理 ApiResponse 包裝
 */
async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  // SSR 時需手動帶入請求的 Cookie（瀏覽器 cookie 不會自動轉發到 Next 伺服器端的 fetch）
  cookieHeader?: string
): Promise<ApiResponse<T>> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include", // 遵守 cookie auth
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init?.headers ?? {}),
    },
  });

  // 401（未登入/登入失效）：在瀏覽器端廣播事件，讓全站提示「請先登入」彈窗（見 SessionExpiryPrompt）。
  // SSR（無 window）不廣播——那是 layout 正常判斷登入狀態。
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zonwiki:unauthorized"));
  }

  // 401/404/400 不視為例外，回傳已解析的 ApiResponse 主體（含 error 訊息）供呼叫端就地處理。
  // 400（client error）帶有明確錯誤訊息（如「目前密碼錯誤」），不應拋例外被當成連線失敗。
  if (!res.ok && res.status !== 401 && res.status !== 404 && res.status !== 400) {
    throw new Error(`API ${path} failed with ${res.status}`);
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      error: "Invalid JSON response",
      statusCode: res.status,
    };
  }
}

// ============================================================================
// API 方法 — User & Auth
// ============================================================================

/**
 * 取得當前使用者資訊
 */
export async function getCurrentUser(
  cookieHeader?: string
): Promise<CurrentUser | null> {
  try {
    const r = await fetchJson<CurrentUser>("/api/me", undefined, cookieHeader);
    return r.success ? r.data ?? null : null;
  } catch {
    return null;
  }
}

/**
 * 本機帳號註冊（以「帳號」登入，不需要 email、不需要驗證碼）
 */
export async function register(payload: {
  /** 帳號（登入識別字） */
  account: string;
  /** 密碼（最少 8 個字元） */
  password: string;
  /** 顯示名稱 */
  displayName: string;
}): Promise<CurrentUser | null> {
  const r = await fetchJson<CurrentUser>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.success ? r.data ?? null : null;
}

/**
 * 本機帳號登入（以「帳號」登入）
 */
export async function login(payload: {
  /** 帳號（登入識別字） */
  account: string;
  /** 密碼 */
  password: string;
}): Promise<CurrentUser | null> {
  const r = await fetchJson<CurrentUser>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.success ? r.data ?? null : null;
}

/**
 * 修改密碼的結果。
 * - ok=true：修改成功。
 * - ok=false：失敗，error 為可直接顯示的訊息（如「目前密碼錯誤」）。
 */
export interface ChangePasswordResult {
  /** 是否成功。 */
  ok: boolean;
  /** 失敗時的錯誤訊息（可為 undefined）。 */
  error?: string;
}

/**
 * 修改密碼。
 * 後端在「目前密碼錯誤」時回 400（而非 401），故不會觸發全域登入失效提示；
 * 呼叫端可依 {@link ChangePasswordResult.error} 就地顯示明確錯誤。
 * @param payload 目前密碼與新密碼。
 * @returns 修改結果（含錯誤訊息）。
 */
export async function changePassword(payload: {
  /** 當前密碼 */
  currentPassword: string;
  /** 新密碼（最少 8 個字元） */
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const r = await fetchJson<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { ok: r.success, error: r.success ? undefined : r.error ?? undefined };
}

// ============================================================================
// 個人頁 (Profile) — 資料 / 統計 / 每日活動 / 改 email / 刪帳號
// ============================================================================

/** 個人資料（含建立時間、是否綁定 Google） */
export interface MyProfile {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  /** 帳號建立時間 (UTC ISO 字串) */
  createdDateTime: string;
  /** 是否已綁定 Google 帳號 */
  googleLinked: boolean;
}

/** 個人統計數據 */
export interface MyStats {
  notes: number;
  tasks: number;
  canvases: number;
  nodes: number;
  quickLinks: number;
  captures: number;
  tags: number;
  categories: number;
}

/** 單日活動量（依使用者時區歸日） */
export interface MyActivityDay {
  /** 日期 yyyy-MM-dd（使用者時區） */
  date: string;
  notes: number;
  tasks: number;
  canvases: number;
  nodes: number;
  captures: number;
  total: number;
}

/**
 * 取得個人資料
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const r = await fetchJson<MyProfile>("/api/me/profile");
  return r.success ? r.data ?? null : null;
}

/**
 * 修改暱稱（顯示名稱），後端會重發 Cookie 讓 Header 立即反映
 */
export async function updateMyProfile(displayName: string): Promise<boolean> {
  const r = await fetchJson<{ displayName: string }>("/api/me/profile", {
    method: "PUT",
    body: JSON.stringify({ displayName }),
  });
  return r.success;
}

/**
 * 取得個人統計數據
 */
export async function getMyStats(): Promise<MyStats | null> {
  const r = await fetchJson<MyStats>("/api/me/stats");
  return r.success ? r.data ?? null : null;
}

/**
 * 取得每日活動（近 N 天，預設 30 天）
 */
export async function getMyActivity(days = 30): Promise<MyActivityDay[]> {
  const r = await fetchJson<MyActivityDay[]>(`/api/me/activity?days=${days}`);
  return r.success ? r.data ?? [] : [];
}

/** 活動明細的一筆紀錄（誰、何時、對哪個實體做了什麼，標題級）。 */
export interface ActivityLogEntry {
  /** 紀錄 Id */
  id: string;
  /** 動作：created（新增）/ updated（編輯）/ deleted（刪除）/ restored（還原） */
  action: "created" | "updated" | "deleted" | "restored" | string;
  /** 實體型別：note / taskcard / subtask / node / aimodel / capture / quicklink / prompt */
  entityType: string;
  /** 實體 Id */
  entityId: string;
  /** 動作當下的標題 / 名稱（標題級） */
  title: string;
  /** 動作發生時間（UTC ISO；前端依裝置時區顯示） */
  at: string;
}

/**
 * 取得活動明細（近 N 天逐筆操作紀錄，預設 30 天、上限 200 筆）。
 */
export async function getActivityLog(days = 30, take = 200): Promise<ActivityLogEntry[]> {
  const r = await fetchJson<ActivityLogEntry[]>(
    `/api/me/activity-log?days=${days}&take=${take}`
  );
  return r.success ? r.data ?? [] : [];
}

/**
 * 刪除帳號（軟刪除）並立即登出
 */
export async function deleteMyAccount(): Promise<boolean> {
  const r = await fetchJson<void>("/api/me", { method: "DELETE" });
  return r.success;
}

/**
 * 取得登入 URL
 */
export function getLoginUrl(returnUrl = "/"): string {
  return `${BROWSER_API_BASE}/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/**
 * 取得登出 URL
 */
export function getLogoutUrl(): string {
  return `${BROWSER_API_BASE}/api/auth/logout`;
}

/**
 * 取得使用者設定（顯示模式、時區、快捷鍵覆寫）。
 */
export async function getUserSettings(): Promise<UserSettings | null> {
  const r = await fetchJson<UserSettings>("/api/me/settings");
  return r.data ?? null;
}

/**
 * 更新使用者設定
 */
export async function updateUserSettings(
  settings: Partial<UserSettings>
): Promise<UserSettings | null> {
  const r = await fetchJson<UserSettings>("/api/me/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return r.data ?? null;
}

// ============================================================================
// API 方法 — Note (筆記)
// ============================================================================

/**
 * 列出所有筆記分類
 */
export async function listNoteCategories(): Promise<NoteCategory[]> {
  const r = await fetchJson<NoteCategory[]>("/api/categories");
  return r.data ?? [];
}

/**
 * 列出所有筆記標籤
 */
export async function listNoteTags(): Promise<NoteTag[]> {
  const r = await fetchJson<NoteTag[]>("/api/notes/tags");
  return r.data ?? [];
}

/**
 * 更新標籤（用於分配給筆記）
 */
export async function updateNoteTags(
  noteId: string,
  tagIds: string[]
): Promise<boolean> {
  // 後端 PUT /api/notes/{id}/tags 的 body 直接是「標籤 ID 陣列」(List<Guid>)，
  // 不是 { tagIds } 物件——送錯外層會 400。
  const r = await fetchJson(`/api/notes/${encodeURIComponent(noteId)}/tags`, {
    method: 'PUT',
    body: JSON.stringify(tagIds),
  });
  return r.success;
}

/**
 * 將「單一」標籤加到筆記（冪等、原子）。
 * 相對於 updateNoteTags（整組取代），本函式不需先讀目前標籤再整組送，
 * 可避免讀-改-寫競態覆蓋其它變更。供清單編輯模式勾選 / 批次加標籤用。
 */
export async function addNoteTag(noteId: string, tagId: string): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tags/${encodeURIComponent(tagId)}`,
    { method: 'POST' }
  );
  return r.success;
}

/**
 * 從筆記移除「單一」標籤（冪等、原子）。
 */
export async function removeNoteTag(noteId: string, tagId: string): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tags/${encodeURIComponent(tagId)}`,
    { method: 'DELETE' }
  );
  return r.success;
}

/**
 * 建立筆記分類
 */
export async function createNoteCategory(payload: {
  name: string;
  parentId?: string | null;
}): Promise<NoteCategory | null> {
  const r = await fetchJson<NoteCategory>("/api/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新筆記分類（重新命名、重新歸檔）
 */
export async function updateNoteCategory(
  id: string,
  payload: {
    name: string;
    parentId?: string | null;
  }
): Promise<NoteCategory | null> {
  const r = await fetchJson<NoteCategory>(
    `/api/categories/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return r.data ?? null;
}

/**
 * 刪除筆記分類
 * 若分類還有子分類或筆記，伺服器會回傳 409 並在 error 欄位提供訊息
 */
export async function deleteNoteCategory(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/categories/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  // 若伺服器回傳 409 (衝突)，拋出錯誤讓呼叫者處理 error 訊息
  if (!r.success && r.statusCode === 409 && r.error) {
    throw new Error(r.error);
  }

  return r.success;
}

/**
 * 設定分類的標籤（全量替換）
 */
export async function setNoteCategoryTags(
  categoryId: string,
  tagIds: string[]
): Promise<boolean> {
  const r = await fetchJson(
    `/api/categories/${encodeURIComponent(categoryId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify({ tagIds }),
    }
  );
  return r.success;
}

/**
 * 重新排序筆記分類（依傳入順序，後端把每個分類的 SortOrder 設為其索引）。
 * @param orderedIds 依新順序排列的分類 ID（通常是同一層級的兄弟分類）
 */
export async function reorderNoteCategories(orderedIds: string[]): Promise<boolean> {
  const r = await fetchJson("/api/categories/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
  return r.success;
}

/**
 * 將一篇筆記加入「單一」分類（冪等；供「拖曳筆記直接進某分類」用）。
 * 只新增一個關聯，不影響該筆記既有的其它分類。
 */
export async function addNoteToCategory(
  noteId: string,
  categoryId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/categories/${encodeURIComponent(
      categoryId
    )}`,
    { method: "POST" }
  );
  return r.success;
}

/**
 * 建立筆記標籤
 */
export async function createNoteTag(name: string): Promise<NoteTag | null> {
  const r = await fetchJson<NoteTag>("/api/notes/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

  // 若伺服器回傳 409 (重複)，拋出錯誤讓呼叫者處理 error 訊息
  if (!r.success && r.statusCode === 409 && r.error) {
    throw new Error(r.error);
  }

  return r.data ?? null;
}

/**
 * 更新筆記標籤名稱
 */
export async function updateNoteTag(id: string, name: string): Promise<NoteTag | null> {
  const r = await fetchJson<NoteTag>(`/api/notes/tags/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
  return r.data ?? null;
}

/**
 * 刪除筆記標籤
 */
export async function deleteNoteTag(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/notes/tags/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 重新排序筆記標籤（依傳入順序，後端把每個標籤的 SortOrder 設為其索引）。
 * @param orderedIds 依新順序排列的標籤 ID
 */
export async function reorderNoteTags(orderedIds: string[]): Promise<boolean> {
  const r = await fetchJson("/api/notes/tags/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
  return r.success;
}

/**
 * 列出筆記 (含分頁/篩選)
 * @param categoryId 分類過濾 (可選)
 * @param tagId 標籤過濾 (可選)
 * @param isDraft 是否為草稿
 */
export async function listNotes(params?: {
  categoryId?: string;
  tagId?: string;
  isDraft?: boolean;
}): Promise<NoteSummary[]> {
  const query = new URLSearchParams();
  if (params?.categoryId) query.append("categoryId", params.categoryId);
  if (params?.tagId) query.append("tagId", params.tagId);
  if (params?.isDraft !== undefined)
    query.append("isDraft", String(params.isDraft));

  const path = `/api/notes${query.toString() ? `?${query.toString()}` : ""}`;
  const r = await fetchJson<NoteSummary[]>(path);
  return r.data ?? [];
}

/**
 * 取得單一筆記詳細資訊
 */
export async function getNote(slug: string): Promise<NoteDetail | null> {
  // slug 可能含「/」（對應子資料夾層級）。逐段 encode、保留「/」當路徑分隔，
  // 對應後端 catch-all 路由 GET /api/notes/{*slug}（整段 slash 視為 slug 的一部分）。
  const encodedSlug = slug
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const r = await fetchJson<NoteDetail>(`/api/notes/${encodedSlug}`);
  return r.data ?? null;
}

/**
 * 建立筆記
 */
export async function createNote(payload: {
  title: string;
  contentRaw: string;
  categoryIds?: string[];
  tagIds?: string[];
  isDraft?: boolean;
}): Promise<NoteDetail | null> {
  const r = await fetchJson<NoteDetail>("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新筆記
 */
export async function updateNote(
  id: string,
  payload: Partial<{
    title: string;
    contentRaw: string;
    categoryIds: string[];
    tagIds: string[];
    isDraft: boolean;
  }>
): Promise<NoteDetail | null> {
  const r = await fetchJson<NoteDetail>(
    `/api/notes/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return r.data ?? null;
}

/**
 * 刪除筆記
 */
export async function deleteNote(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 列出筆記留言
 */
export async function listNoteComments(noteId: string): Promise<Comment[]> {
  const r = await fetchJson<Comment[]>(
    `/api/notes/${encodeURIComponent(noteId)}/comments`
  );
  return r.data ?? [];
}

/**
 * 新增留言到筆記
 */
export async function addNoteComment(
  noteId: string,
  content: string
): Promise<Comment | null> {
  const r = await fetchJson<Comment>(
    `/api/notes/${encodeURIComponent(noteId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    }
  );
  return r.data ?? null;
}

// ============================================================================
// API 方法 — Task (任務)
// ============================================================================

/**
 * 列出任務群組
 */
export async function listTaskGroups(): Promise<TaskGroup[]> {
  const r = await fetchJson<TaskGroup[]>("/api/task-groups");
  return r.data ?? [];
}

/**
 * 建立任務群組
 */
export async function createTaskGroup(payload: {
  name: string;
  color?: string;
}): Promise<TaskGroup | null> {
  const r = await fetchJson<TaskGroup>("/api/task-groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新任務群組
 */
export async function updateTaskGroup(
  id: string,
  payload: Partial<TaskGroup>
): Promise<TaskGroup | null> {
  const r = await fetchJson<TaskGroup>(`/api/task-groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除任務群組
 */
export async function deleteTaskGroup(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/task-groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 列出任務卡片
 */
export async function listTaskCards(params?: {
  groupId?: string;
  status?: "todo" | "doing" | "done";
}): Promise<TaskCard[]> {
  const query = new URLSearchParams();
  if (params?.groupId) query.append("groupId", params.groupId);
  if (params?.status) query.append("status", params.status);

  const path = `/api/tasks${query.toString() ? `?${query.toString()}` : ""}`;
  const r = await fetchJson<TaskCard[]>(path);
  return r.data ?? [];
}

/**
 * 取得單張任務卡片詳情（含內容與子任務清單）。
 */
export async function getTaskCard(id: string): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>(`/api/tasks/${encodeURIComponent(id)}`);
  return r.data ?? null;
}

/**
 * 建立任務卡片
 */
export async function createTaskCard(payload: {
  title: string;
  content?: string;
  status?: "todo" | "doing" | "done";
  priority?: number;
  groupId?: string;
  plannedDateTime?: string | null;
  dueDateTime?: string | null;
  /** 父任務 ID（建立為某任務的子任務時帶入） */
  parentId?: string | null;
}): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新任務卡片的請求酬載。
 * 日期/分類欄位：傳值＝設定；對應的 clearXxx=true＝清空為 null；兩者皆不傳＝維持原值。
 */
export interface UpdateTaskCardPayload {
  title?: string;
  content?: string;
  status?: "todo" | "doing" | "done";
  priority?: number;
  groupId?: string;
  plannedDateTime?: string;
  dueDateTime?: string;
  sortOrder?: number;
  /** 父任務 ID（設定父子關係）；改為頂層任務請用 clearParentId */
  parentId?: string | null;
  clearPlannedDateTime?: boolean;
  clearDueDateTime?: boolean;
  clearGroupId?: boolean;
  clearParentId?: boolean;
}

/**
 * 更新任務卡片
 */
export async function updateTaskCard(
  id: string,
  payload: UpdateTaskCardPayload
): Promise<TaskCard | null> {
  const r = await fetchJson<TaskCard>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除任務卡片
 */
export async function deleteTaskCard(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 設定任務卡片的標籤（整組取代；與筆記共用標籤庫）。
 * 標籤本身的建立/列出沿用筆記的 createNoteTag / listNoteTags。
 */
export async function assignTaskTags(
  taskId: string,
  tagIds: string[]
): Promise<boolean> {
  const r = await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "PUT",
    body: JSON.stringify(tagIds),
  });
  return r.success;
}

// ============================================================================
// API 方法 — SubTask (子任務 / 檢核清單)
// ============================================================================

/**
 * 列出某張卡片底下的子任務（依排序）。
 */
export async function listSubTasks(taskId: string): Promise<SubTask[]> {
  const r = await fetchJson<SubTask[]>(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks`
  );
  return r.data ?? [];
}

/**
 * 在某張卡片底下新增子任務（自動排到最後）。
 */
export async function createSubTask(
  taskId: string,
  title: string
): Promise<SubTask | null> {
  const r = await fetchJson<SubTask>(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks`,
    { method: "POST", body: JSON.stringify({ title }) }
  );
  return r.data ?? null;
}

/**
 * 更新子任務（標題 / 完成狀態 / 排序，皆選擇性）。
 */
export async function updateSubTask(
  id: string,
  payload: { title?: string; isDone?: boolean; sortOrder?: number }
): Promise<SubTask | null> {
  const r = await fetchJson<SubTask>(`/api/subtasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除子任務（軟刪除）。
 */
export async function deleteSubTask(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/subtasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 重新排序某張卡片底下的子任務。
 */
export async function reorderSubTasks(
  taskId: string,
  orderedIds: string[]
): Promise<boolean> {
  const r = await fetchJson(
    `/api/tasks/${encodeURIComponent(taskId)}/subtasks/reorder`,
    { method: "PUT", body: JSON.stringify({ orderedIds }) }
  );
  return r.success;
}

// ============================================================================
// API 方法 — Quick Link & Capture
// ============================================================================

/**
 * 列出常用連結
 */
export async function listQuickLinks(): Promise<QuickLink[]> {
  const r = await fetchJson<QuickLink[]>("/api/quick-links");
  return r.data ?? [];
}

/**
 * 建立常用連結
 */
export async function createQuickLink(payload: {
  title: string;
  url: string;
  iconKey?: string;
  category?: string;
}): Promise<QuickLink | null> {
  const r = await fetchJson<QuickLink>("/api/quick-links", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 更新常用連結（欄位皆選擇性；category 傳空字串＝清為未分類，傳 null/不傳＝不更新）
 */
export async function updateQuickLink(
  id: string,
  payload: { title?: string; url?: string; iconKey?: string; category?: string }
): Promise<QuickLink | null> {
  const r = await fetchJson<QuickLink>(`/api/quick-links/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 設定常用連結的標籤（整批取代；與筆記/任務共用標籤庫）
 */
export async function assignQuickLinkTags(id: string, tagIds: string[]): Promise<boolean> {
  const r = await fetchJson(`/api/quick-links/${encodeURIComponent(id)}/tags`, {
    method: "PUT",
    body: JSON.stringify(tagIds),
  });
  return r.success;
}

/**
 * 刪除常用連結
 */
export async function deleteQuickLink(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/quick-links/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

/**
 * 列出快速捕捉 (Inbox)
 */
export async function listCaptures(): Promise<CaptureItem[]> {
  const r = await fetchJson<CaptureItem[]>("/api/captures");
  return r.data ?? [];
}

/**
 * 新增快速捕捉
 */
export async function createCapture(payload: {
  source: "web" | "voice" | "text";
  rawContent: string;
  audioPath?: string;
}): Promise<CaptureItem | null> {
  const r = await fetchJson<CaptureItem>("/api/captures", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除快速捕捉（軟刪除，會進垃圾桶）
 */
export async function deleteCapture(id: string): Promise<boolean> {
  await fetchJson(`/api/captures/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true; // 204 無 body：未丟例外即視為成功
}

/**
 * 捕捉衍生出的筆記 / 任務
 */
export interface CaptureLink {
  /** 關聯 ID */
  id: string;
  /** 目標型別 (note|taskcard) */
  targetType: "note" | "taskcard";
  /** 目標 ID */
  targetId: string;
  /** 目標標題 */
  title: string;
  /** 筆記 slug（任務為 null） */
  slug?: string | null;
  /** 目標是否已被刪除 */
  isDeleted: boolean;
}

/**
 * 列出某捕捉衍生的筆記 / 任務
 */
export async function listCaptureLinks(captureId: string): Promise<CaptureLink[]> {
  const r = await fetchJson<CaptureLink[]>(
    `/api/captures/${encodeURIComponent(captureId)}/links`
  );
  return r.data ?? [];
}

/**
 * 為捕捉新增一筆衍生關聯（筆記/任務先以既有端點建立後回填）
 */
export async function addCaptureLink(
  captureId: string,
  targetType: "note" | "taskcard",
  targetId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/captures/${encodeURIComponent(captureId)}/links`,
    { method: "POST", body: JSON.stringify({ targetType, targetId }) }
  );
  return r.success;
}

// ============================================================================
// API 方法 — Home (首頁)
// ============================================================================

/**
 * 取得首頁聚合資料（當週日曆 + 今日待辦 + 常用連結 + 最近捕捉）
 */
export async function getHomePage(): Promise<HomePageAggregate | null> {
  const r = await fetchJson<HomePageAggregate>("/api/home");
  return r.data ?? null;
}

// ============================================================================
// API 方法 — Search (搜尋)
// ============================================================================

/**
 * 全域搜尋
 */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const r = await fetchJson<SearchResult[]>(
    `/api/search?q=${encodeURIComponent(query)}`
  );
  return r.data ?? [];
}

// ============================================================================
// API 方法 — Graph (知識圖譜)
// ============================================================================

/**
 * 知識圖譜節點（筆記）
 */
export interface GraphNode {
  /** 節點 ID (筆記 ID) */
  id: string;
  /** 節點標題 */
  title: string;
  /** 節點 slug */
  slug: string;
  /** 節點類型 (note|journal) */
  kind: string;
}

/**
 * 知識圖譜邊（連結）
 */
export interface GraphEdge {
  /** 來源筆記 ID */
  sourceNoteId: string;
  /** 目標筆記 ID (可能為空字串表示未建立的筆記) */
  targetNoteId?: string | null;
  /** 連結文字 */
  anchorText: string;
}

/**
 * 知識圖譜資料
 */
export interface KnowledgeGraph {
  /** 圖譜節點 */
  nodes: GraphNode[];
  /** 圖譜邊 */
  edges: GraphEdge[];
}

/**
 * 取得知識圖譜資料（所有筆記與連結）
 */
export async function getKnowledgeGraph(): Promise<KnowledgeGraph | null> {
  const r = await fetchJson<KnowledgeGraph>("/api/graph");
  return r.data ?? null;
}

// ============================================================================
// API 方法 — EntityLink（任務/子任務/筆記/節點 互連）
// ============================================================================

/** 連結的「另一端」實體型別。 */
export type LinkEntityType = "taskcard" | "subtask" | "note" | "node";

/** 連結的另一端顯示資料（給彈窗列出 + 導覽）。 */
export interface LinkedEntity {
  /** 此連結的 Id（用於刪除） */
  linkId: string;
  /** 另一端型別 */
  type: LinkEntityType;
  /** 另一端 Id */
  id: string;
  /** 顯示標題 */
  title: string;
  /** 前端導覽 URL */
  url: string;
  /** 副標（如「任務」「開問啦節點 · 畫布名」） */
  subText?: string | null;
}

/** 列出某實體的所有連結（雙向）。 */
export async function listLinks(type: LinkEntityType, id: string): Promise<LinkedEntity[]> {
  const r = await fetchJson<LinkedEntity[]>(
    `/api/links?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
  );
  return r.success ? r.data ?? [] : [];
}

/** 刪除一筆連結。 */
export async function deleteLink(linkId: string): Promise<boolean> {
  const r = await fetchJson<void>(`/api/links/${encodeURIComponent(linkId)}`, { method: "DELETE" });
  return r.success;
}

/** 從某實體建立並連結一篇筆記（標題帶入；草稿）。 */
export async function createNoteFromEntity(
  sourceType: LinkEntityType,
  sourceId: string,
  title: string
): Promise<{ noteId: string; slug: string } | null> {
  const r = await fetchJson<{ noteId: string; slug: string; linkId: string }>("/api/links/note-from", {
    method: "POST",
    body: JSON.stringify({ sourceType, sourceId, title }),
  });
  return r.success ? r.data ?? null : null;
}

/** 從某實體建立並連結一張畫布 + 初始節點（內容帶入；不問 AI）。 */
export async function createCanvasFromEntity(
  sourceType: LinkEntityType,
  sourceId: string,
  title: string
): Promise<{ canvasId: string; nodeId: string } | null> {
  const r = await fetchJson<{ canvasId: string; nodeId: string; linkId: string }>("/api/links/canvas-from", {
    method: "POST",
    body: JSON.stringify({ sourceType, sourceId, title }),
  });
  return r.success ? r.data ?? null : null;
}

/** 可關聯的候選既有實體（搜尋既有項目來建立關聯時使用）。 */
export interface LinkCandidate {
  /** 候選的型別 */
  type: LinkEntityType;
  /** 候選的 Id */
  id: string;
  /** 顯示標題 */
  title: string;
  /** 副標（如「任務」「筆記」「開問啦節點 · 畫布名」） */
  subText?: string | null;
  /** 是否已與來源關聯（前端用以標示、避免重複） */
  alreadyLinked: boolean;
}

/**
 * 搜尋「可關聯的既有實體」（依來源型別決定要搜尋的目標型別）。
 * q 為空字串時回傳各型別最近更新的項目。
 */
export async function searchLinkCandidates(
  sourceType: LinkEntityType,
  sourceId: string,
  q: string
): Promise<LinkCandidate[]> {
  const r = await fetchJson<LinkCandidate[]>(
    `/api/links/candidates?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(
      sourceId
    )}&q=${encodeURIComponent(q)}`
  );
  return r.success ? r.data ?? [] : [];
}

/** 在兩個既有實體之間建立關聯（去重；若曾軟刪除則復活）。回傳 linkId。 */
export async function createLink(
  sourceType: LinkEntityType,
  sourceId: string,
  targetType: LinkEntityType,
  targetId: string
): Promise<string | null> {
  const r = await fetchJson<{ linkId: string }>("/api/links", {
    method: "POST",
    body: JSON.stringify({ sourceType, sourceId, targetType, targetId }),
  });
  return r.success ? r.data?.linkId ?? null : null;
}

// ============================================================================
// API 方法 — Calendar (行事曆)
// ============================================================================

/**
 * 行事曆視圖資料
 */
export interface CalendarViewData {
  /** 時間範圍內的任務卡片 */
  tasks: TaskCard[];
  /** 時間範圍內的日記筆記 */
  journalNotes: NoteSummary[];
  /** 起始日期 (UTC) */
  from: string;
  /** 結束日期 (UTC) */
  to: string;
}

/**
 * 取得特定時間範圍內的行事曆資料
 * @param from 開始日期 (UTC)
 * @param to 結束日期 (UTC)
 */
export async function getCalendarView(
  from: Date,
  to: Date
): Promise<CalendarViewData | null> {
  const r = await fetchJson<CalendarViewData>(
    `/api/calendar?from=${encodeURIComponent(
      from.toISOString()
    )}&to=${encodeURIComponent(to.toISOString())}`
  );
  return r.data ?? null;
}

// ============================================================================
// 資料型別 — Note 編輯歷史與反向連結
// ============================================================================

/**
 * 筆記版本紀錄
 */
export interface NoteRevision {
  /** 版本 ID */
  id: string;
  /** 版本號 */
  revisionNo: number;
  /** 變更類型 (create|update|reformat|beautify) */
  changeKind: string;
  /** 該版本的標題 */
  title: string;
  /** 該版本的原始內容 */
  contentRaw: string;
  /** 建立時間 (UTC) */
  createdDateTime: string;
  /** 建立者 ID */
  createdUser: string;
}

/**
 * 反向連結（有哪些筆記指向本筆記）
 */
export interface Backlink {
  /** 反向連結 ID */
  id: string;
  /** 來源筆記 ID */
  sourceNoteId: string;
  /** 來源筆記標題 */
  sourceNoteTitle: string;
  /** 來源筆記 slug */
  sourceNoteSlug: string;
  /** 連結文字 (anchor text，來自 [[X]] 中的 X) */
  anchorText: string;
}

/**
 * AI 美化 / 排版請求回應
 */
export interface AiTransformResult {
  /** 轉換後的原始內容 */
  contentRaw: string;
  /** 轉換後的 HTML 內容 */
  contentHtml: string;
}

// ============================================================================
// API 方法 — Note 編輯與 AI
// ============================================================================

/**
 * 筆記文字標註（畫重點 / 做關聯 / 寫備註）。以錨點（文字＋位移＋前後文）定位。
 */
export interface NoteMark {
  id: string;
  /** 種類："highlight" | "link" | "annotation" */
  kind: 'highlight' | 'link' | 'annotation';
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  anchorPrefix: string;
  anchorSuffix: string;
  detached: boolean;
  /** 重點顏色（highlight 用） */
  color?: string | null;
  /** 關聯目標型別（link 用："note"|"taskcard"|"node"|"url"） */
  targetType?: string | null;
  /** 關聯目標實體 Id（link 用） */
  targetId?: string | null;
  /** 外部網址（link 用） */
  targetUrl?: string | null;
  /** 關聯目標顯示名稱（伺服器解析，hover 浮窗顯示用） */
  targetTitle?: string | null;
  /** 關聯目標 slug（note 用，前端導航） */
  targetSlug?: string | null;
  /** 備註文字（annotation 用） */
  text?: string | null;
}

/** 建立筆記標註的請求內容。 */
export interface CreateNoteMarkInput {
  kind: 'highlight' | 'link' | 'annotation';
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  anchorPrefix: string;
  anchorSuffix: string;
  color?: string;
  targetType?: string;
  targetId?: string;
  targetUrl?: string;
  text?: string;
}

/** 框選提問的結果（新建的答案筆記 + 建立的關聯標註）。 */
export interface AskSelectionResult {
  answerNoteId: string;
  answerSlug: string;
  markId: string;
}

/**
 * 框選提問：針對筆記內選取的一段文字提問，AI 回答後建立「答案筆記」並以錨點關聯回來。
 */
export async function askNoteSelection(
  noteId: string,
  input: {
    anchorText: string;
    anchorStart: number;
    anchorEnd: number;
    anchorPrefix: string;
    anchorSuffix: string;
    question: string;
  }
): Promise<AskSelectionResult | null> {
  const r = await fetchJson<AskSelectionResult>(
    `/api/notes/${encodeURIComponent(noteId)}/ask-selection`,
    { method: 'POST', body: JSON.stringify(input) }
  );
  return r.data ?? null;
}

/**
 * 框選提問（便利貼模式）：以「整篇筆記 + 框選文字」為脈絡向 AI 提問，
 * 只取回答案文字（不建答案筆記），由前端放進便利貼浮層。
 */
export async function askNoteSelectionAnswer(
  noteId: string,
  input: {
    anchorText: string;
    anchorStart: number;
    anchorEnd: number;
    anchorPrefix: string;
    anchorSuffix: string;
    question: string;
  }
): Promise<string | null> {
  const r = await fetchJson<{ answer: string }>(
    `/api/notes/${encodeURIComponent(noteId)}/ask-selection-answer`,
    { method: 'POST', body: JSON.stringify(input) }
  );
  return r.data?.answer ?? null;
}

/**
 * 通用 AI 提問（不綁定筆記/節點）：以呼叫端組好的 context + question 請 AI 回答。
 * 用於開問啦畫布便利貼的「繼續問」（沒有單一筆記脈絡）。
 */
export async function askAi(context: string, question: string): Promise<string | null> {
  const r = await fetchJson<{ answer: string }>('/api/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ context, question }),
  });
  return r.data?.answer ?? null;
}

/** 列出某筆記的所有文字標註。 */
export async function listNoteMarks(noteId: string): Promise<NoteMark[]> {
  const r = await fetchJson<NoteMark[]>(`/api/notes/${encodeURIComponent(noteId)}/marks`);
  return r.data ?? [];
}

/** 建立一筆筆記文字標註。 */
export async function createNoteMark(
  noteId: string,
  input: CreateNoteMarkInput
): Promise<NoteMark | null> {
  const r = await fetchJson<NoteMark>(`/api/notes/${encodeURIComponent(noteId)}/marks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return r.data ?? null;
}

/** 更新筆記標註（編輯備註文字 / 重點顏色）。 */
export async function updateNoteMark(
  markId: string,
  patch: { text?: string; color?: string }
): Promise<boolean> {
  const r = await fetchJson(`/api/notes/marks/${encodeURIComponent(markId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return r.success;
}

/** 刪除筆記標註（軟刪除）。 */
export async function deleteNoteMark(markId: string): Promise<boolean> {
  const r = await fetchJson(`/api/notes/marks/${encodeURIComponent(markId)}`, { method: 'DELETE' });
  return r.success;
}

/**
 * 筆記浮層元件（便利貼 / 塗鴉 / 圖片輪播；疊在內文最上層，持久化於 DB）。
 */
export interface NoteOverlayItem {
  id: string;
  /** "sticky" | "drawing" | "slide" */
  kind: 'sticky' | 'drawing' | 'slide';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** 便利貼底色 */
  color?: string | null;
  /** 便利貼文字 */
  text?: string | null;
  /** 型別專屬資料 JSON：drawing→筆畫；slide→圖片網址陣列 */
  dataJson?: string | null;
}

/** 建立浮層元件的輸入。 */
export interface CreateNoteOverlayInput {
  kind: 'sticky' | 'drawing' | 'slide';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  color?: string;
  text?: string;
  dataJson?: string;
}

/** 列出某筆記的所有浮層元件。 */
export async function listNoteOverlay(noteId: string): Promise<NoteOverlayItem[]> {
  const r = await fetchJson<NoteOverlayItem[]>(`/api/notes/${encodeURIComponent(noteId)}/overlay`);
  return r.data ?? [];
}

/** 建立一個浮層元件。 */
export async function createNoteOverlay(
  noteId: string,
  input: CreateNoteOverlayInput
): Promise<NoteOverlayItem | null> {
  const r = await fetchJson<NoteOverlayItem>(`/api/notes/${encodeURIComponent(noteId)}/overlay`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return r.data ?? null;
}

/** 更新浮層元件（位置/尺寸/內容；欄位皆選擇性。id/kind 會被後端忽略）。 */
export async function updateNoteOverlay(
  itemId: string,
  patch: Partial<NoteOverlayItem>
): Promise<boolean> {
  const r = await fetchJson(`/api/notes/overlay/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return r.success;
}

/** 刪除浮層元件（軟刪除）。 */
export async function deleteNoteOverlay(itemId: string): Promise<boolean> {
  const r = await fetchJson(`/api/notes/overlay/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  return r.success;
}

/**
 * 取得筆記編輯歷史（版本列表）
 */
export async function getNoteRevisions(noteId: string): Promise<NoteRevision[]> {
  const r = await fetchJson<NoteRevision[]>(
    `/api/notes/${encodeURIComponent(noteId)}/revisions`
  );
  return r.data ?? [];
}

/**
 * 取得筆記的反向連結（哪些筆記指向本筆記）
 */
export async function getNoteBacklinks(noteId: string): Promise<Backlink[]> {
  const r = await fetchJson<Backlink[]>(
    `/api/notes/${encodeURIComponent(noteId)}/backlinks`
  );
  return r.data ?? [];
}

/**
 * AI 排版調整。對「編輯器目前的內容」做轉換（不是伺服器已存版本），
 * 後端僅回傳轉換結果、不寫入 DB；由使用者自行按保存才落地（避免覆蓋未存編輯與競態）。
 * @param noteId 筆記 ID
 * @param contentRaw 目前編輯器內容
 */
export async function reformatNote(
  noteId: string,
  contentRaw: string
): Promise<AiTransformResult | null> {
  const r = await fetchJson<AiTransformResult>(
    `/api/notes/${encodeURIComponent(noteId)}/reformat`,
    {
      method: 'POST',
      body: JSON.stringify({ contentRaw }),
    }
  );
  return r.data ?? null;
}

/**
 * AI 整體美化。語意同 {@link reformatNote}：對目前內容轉換、後端不落地、回傳結果供前端套用。
 * @param noteId 筆記 ID
 * @param contentRaw 目前編輯器內容
 */
export async function beautifyNote(
  noteId: string,
  contentRaw: string
): Promise<AiTransformResult | null> {
  const r = await fetchJson<AiTransformResult>(
    `/api/notes/${encodeURIComponent(noteId)}/beautify`,
    {
      method: 'POST',
      body: JSON.stringify({ contentRaw }),
    }
  );
  return r.data ?? null;
}

// ============================================================================
// API 方法 — Ask Queue (提問佇列)
// ============================================================================

/**
 * 提問佇列項目（來自 AiSession）
 *
 * 注意：後端使用 .NET System.Text.Json 預設的 camelCase 命名（PascalCase property 轉 camelCase JSON）。
 * 因此 JSON 中是 camelCase，但 TypeScript interface 仍使用 camelCase 以符合習慣。
 */
export interface AskQueueItemDto {
  /** 工作階段 ID */
  sessionId: string;
  /** 狀態："Running" | "Completed" | "Failed" */
  status: 'Running' | 'Completed' | 'Failed';
  /** 提問種類："floatingnote" | "node" */
  kind: 'floatingnote' | 'node';
  /** 提問文字（來源框選提問內容） */
  questionText: string | null;
  /** 框選片段文字 */
  anchorText: string | null;
  /** 來源筆記 ID */
  noteId?: string | null;
  /** 來源筆記 slug（用於導航；筆記被刪時為 null） */
  noteSlug?: string | null;
  /** 來源筆記標題（用於顯示；筆記被刪時為 null） */
  noteTitle?: string | null;
  /** 答案筆記 ID（Completed 才有） */
  answerNoteId?: string | null;
  /** 答案筆記 slug（用於「看答案」連結；筆記被刪時為 null） */
  answerNoteSlug?: string | null;
  /** 來源筆記上的錨點 mark ID（用於跳轉到框選位置） */
  markId?: string | null;
  /** 畫布 ID（node 提問用） */
  canvasId?: string | null;
  /** 畫布上的 ask 節點 ID（node 提問用，用於聚焦） */
  askNodeId?: string | null;
  /** 建立時間 (UTC ISO 字串) */
  createdDateTime: string;
  /** 失敗錯誤訊息（Failed 狀態時） */
  errorText?: string | null;
}

/**
 * 取得提問佇列（已認證使用者的 AiSession 記錄）
 * @param status 狀態篩選（可選："Running" | "Completed" | "Failed"）
 * @param kind 種類篩選（可選："floatingnote" | "node"）
 * @param limit 返回筆數（預設 50，上限 200）
 */
export async function getAskQueue(params?: {
  status?: 'Running' | 'Completed' | 'Failed';
  kind?: 'floatingnote' | 'node';
  limit?: number;
}): Promise<AskQueueItemDto[]> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.kind) query.append('kind', params.kind);
  if (params?.limit) query.append('limit', String(params.limit));

  const path = `/api/ask-queue${query.toString() ? `?${query.toString()}` : ''}`;
  const r = await fetchJson<AskQueueItemDto[]>(path);
  return r.success ? r.data ?? [] : [];
}

// ============================================================================
// 相容層 — 舊 API (用於過渡期)
// ============================================================================
// 這些函式用於相容舊版頁面元件，最終應被移除

/**
 * @deprecated 使用 listNotes() 替代
 */
export async function listArticles(categoryId?: string): Promise<NoteSummary[]> {
  return listNotes(categoryId ? { categoryId } : undefined);
}

/**
 * @deprecated 使用 getNote() 替代
 */
export async function getArticle(slug: string[]): Promise<NoteDetail | null> {
  // 轉換 slug 陣列為 ID (原舊邏輯)
  // 實際應透過 URL 路由取得
  return null;
}

/**
 * @deprecated 使用 listNoteCategories() 替代
 */
export async function listCategories(): Promise<NoteCategory[]> {
  return listNoteCategories();
}

/**
 * @deprecated 使用 listNoteComments() 替代
 */
export async function listComments(noteId: string): Promise<Comment[]> {
  return listNoteComments(noteId);
}

/**
 * @deprecated 使用 addNoteComment() 替代
 */
export async function postComment(
  noteId: string,
  content: string
): Promise<Comment | null> {
  return addNoteComment(noteId, content);
}

/**
 * @deprecated 使用 getLoginUrl() 替代
 */
export function loginUrl(returnUrl = "/"): string {
  return getLoginUrl(returnUrl);
}

/**
 * @deprecated 使用 getLogoutUrl() 替代
 */
export function logoutUrl(): string {
  return getLogoutUrl();
}

// ============================================================================
// 資料型別 — Task Relations (任務關聯)
// ============================================================================

/**
 * 任務關聯（卡片間的關係）
 */
export interface TaskRelation {
  /** 關聯 ID */
  id: string;
  /** 來源任務 ID */
  sourceTaskId: string;
  /** 目標任務 ID */
  targetTaskId: string;
  /** 關聯類型 (depends|blocks|relates|subtask) */
  relationType: "depends" | "blocks" | "relates" | "subtask";
  /** 建立時間 (UTC) */
  createdDateTime: string;
}

// ============================================================================
// API 方法 — Task Relations (任務關聯)
// ============================================================================

/**
 * 列出任務的所有關聯（入站和出站）
 */
export async function listTaskRelations(taskId: string): Promise<TaskRelation[]> {
  const r = await fetchJson<TaskRelation[]>(
    `/api/tasks/${encodeURIComponent(taskId)}/relations`
  );
  return r.data ?? [];
}

/**
 * 建立任務關聯
 */
export async function createTaskRelation(payload: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: "depends" | "blocks" | "relates" | "subtask";
}): Promise<TaskRelation | null> {
  const r = await fetchJson<TaskRelation>("/api/task-relations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 刪除任務關聯
 */
export async function deleteTaskRelation(id: string): Promise<boolean> {
  const r = await fetchJson(`/api/task-relations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.success;
}

// ============================================================================
// API 方法 — Note-Task Links (筆記與任務的連結)
// ============================================================================

/**
 * 列出筆記連結的任務
 */
export async function listNoteTaskLinks(noteId: string): Promise<TaskCard[]> {
  const r = await fetchJson<TaskCard[]>(
    `/api/notes/${encodeURIComponent(noteId)}/tasks`
  );
  return r.data ?? [];
}

/**
 * 建立筆記與任務的連結
 */
export async function createNoteTaskLink(
  noteId: string,
  taskId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({ taskId }),
    }
  );
  return r.success;
}

/**
 * 移除筆記與任務的連結
 */
export async function deleteNoteTaskLink(
  noteId: string,
  taskId: string
): Promise<boolean> {
  const r = await fetchJson(
    `/api/notes/${encodeURIComponent(noteId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    }
  );
  return r.success;
}

// ============================================================================
// API 方法 — 全站搜尋
// ============================================================================

/**
 * 執行全站搜尋
 * 搜尋筆記、任務、畫布、節點，回傳統合結果
 *
 * @param q 搜尋關鍵字
 * @param limit 結果數量限制 (預設 50)
 * @returns 搜尋結果清單
 */
export async function searchAll(
  q: string,
  limit: number = 50
): Promise<SearchResult[]> {
  if (!q.trim()) return [];

  const params = new URLSearchParams();
  params.append("q", q);
  if (limit !== 50) params.append("limit", String(limit));

  const r = await fetchJson<SearchResult[]>(
    `/api/search?${params.toString()}`
  );
  return r.data ?? [];
}

// ============================================================================
// API 方法 — 統一垃圾桶 (Trash)
// ============================================================================

/**
 * 垃圾桶項目（跨模組統一）
 */
export interface TrashItem {
  /** 項目 ID */
  id: string;
  /** 還原/永久刪除用的型別字串 (Note/Category/Tag/TaskCard/TaskGroup/CaptureItem/QuickLink/Whiteboard/Canvas/Node) */
  type: string;
  /** 所屬模組（分區標題，例如 筆記 / 任務 / 開問啦・畫布） */
  group: string;
  /** 標題 */
  title: string;
  /** 內容預覽片段（可空） */
  preview?: string | null;
  /** 刪除時間 (UTC) */
  deletedDateTime: string;
  /** 還原後會回到哪裡（例：「筆記《X》」「畫布《Y》」「排程於 6/24」；可空） */
  context?: string | null;
}

/**
 * 列出垃圾桶所有項目（依刪除時間倒序）
 */
export async function listTrash(): Promise<TrashItem[]> {
  const r = await fetchJson<TrashItem[]>("/api/trash");
  return r.data ?? [];
}

/**
 * 還原垃圾桶項目
 */
export async function restoreTrashItem(type: string, id: string): Promise<boolean> {
  const r = await fetchJson(
    `/api/trash/${encodeURIComponent(type)}/${encodeURIComponent(id)}/restore`,
    { method: "POST" }
  );
  return r.success;
}

/**
 * 永久刪除垃圾桶項目（不可復原）。
 * 後端成功回 204（無 body）；fetchJson 在真正錯誤時會丟例外，故未丟例外即視為成功
 * （不可用回傳的 success——204 無 body 會被解析為 success=false）。
 */
export async function purgeTrashItem(type: string, id: string): Promise<boolean> {
  await fetchJson(
    `/api/trash/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  return true;
}

// 舊型別別名 (用於相容性)
export type Category = NoteCategory;
export type ArticleSummary = NoteSummary;
