/**
 * API 領域模組 — 使用者 / 認證 / 個人頁 / 存取權杖 / AI 動作軌跡 / 精煉成筆記。
 */

import { apiBase, BROWSER_API_BASE, fetchJson } from "./client";

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
  /** 「精煉成筆記」轉錄引擎："gemini"（預設）或 "groq" */
  transcriptionEngine?: "gemini" | "groq";
  /** 是否已設定 Groq 金鑰（唯讀；後端絕不回傳金鑰本身） */
  groqKeySet?: boolean;
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

// ============================================================================
// API 個人存取權杖（PAT）— 給外部 AI 助理以 Bearer 權杖呼叫 API
// ============================================================================

/** 一把 API 權杖的資訊（不含明碼與雜湊）。 */
export interface ApiTokenInfo {
  /** 權杖 Id。 */
  id: string;
  /** 名稱（辨識用途，例如 "Claude Code"）。 */
  name: string;
  /** 明碼前綴（辨識用，例如 "zwk_Ab12cd"）。 */
  tokenPrefix: string;
  /** 建立時間（UTC ISO 字串）。 */
  createdDateTime: string;
  /** 最後使用時間（UTC ISO，可空＝尚未使用）。 */
  lastUsedDateTime?: string | null;
  /** 到期時間（UTC ISO，可空＝永不過期）。 */
  expiresDateTime?: string | null;
  /** 權限範圍（資訊性）。 */
  scopes: string;
}

/** 產生權杖的回應：明碼權杖（只回傳這一次）+ 權杖資訊。 */
export interface CreatedApiToken {
  /** 完整明碼權杖（請立即複製保存；離開頁面後無法再取得）。 */
  token: string;
  /** 權杖資訊。 */
  info: ApiTokenInfo;
}

// ============================================================================
// 首頁「AI 最近動作」— AI 透過 MCP/權杖對知識庫做的 CRUD 軌跡
// ============================================================================

/** 一筆 AI 操作軌跡。 */
export interface AiActivityItem {
  /** 紀錄 Id。 */
  id: string;
  /** 來源："web"（人）或權杖名稱（例如 "Claude Code"）。 */
  source: string;
  /** 動作：created / updated / deleted / restored。 */
  action: string;
  /** 實體型別：note / taskcard / subtask / node / capture / quicklink / prompt / aimodel。 */
  entityType: string;
  /** 實體 Id。 */
  entityId: string;
  /** 操作當下的標題（標題級）。 */
  title: string;
  /** 操作時間（UTC ISO；前端依時區顯示）。 */
  at: string;
}

/** AI 操作軌跡查詢結果（含分頁總數與來源清單）。 */
export interface AiActivityResult {
  /** 本頁項目。 */
  items: AiActivityItem[];
  /** 符合條件的總筆數（分頁用）。 */
  total: number;
  /** 近窗內的 AI 來源清單（含筆數），供前端做來源下拉。 */
  sources: { source: string; count: number }[];
}

/**
 * 查詢「AI 最近動作」軌跡。
 * @param opts 篩選條件（source 留空＝只看 AI；"all"＝含人類網頁；或指定來源名）。
 */
export async function getAiActivity(opts?: {
  source?: string;
  entityType?: string;
  action?: string;
  q?: string;
  days?: number;
  take?: number;
  skip?: number;
}): Promise<AiActivityResult> {
  const params = new URLSearchParams();
  if (opts?.source) params.append("source", opts.source);
  if (opts?.entityType) params.append("entityType", opts.entityType);
  if (opts?.action) params.append("action", opts.action);
  if (opts?.q) params.append("q", opts.q);
  if (opts?.days != null) params.append("days", String(opts.days));
  if (opts?.take != null) params.append("take", String(opts.take));
  if (opts?.skip != null) params.append("skip", String(opts.skip));
  const r = await fetchJson<AiActivityResult>(`/api/home/ai-activity?${params}`);
  return r.success && r.data ? r.data : { items: [], total: 0, sources: [] };
}

/**
 * 列出「我的」API 權杖（不含明碼）。
 */
export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const r = await fetchJson<ApiTokenInfo[]>("/api/me/tokens");
  return r.success ? r.data ?? [] : [];
}

/**
 * 產生一把新權杖。回傳的 token 為明碼、只會出現這一次。
 * @param name 權杖名稱（辨識用途）。
 * @param expiresInDays 幾天後過期（可空＝永不過期）。
 */
export async function createApiToken(
  name: string,
  expiresInDays?: number | null
): Promise<CreatedApiToken | { error: string }> {
  const r = await fetchJson<CreatedApiToken>("/api/me/tokens", {
    method: "POST",
    body: JSON.stringify({ name, expiresInDays: expiresInDays ?? null }),
  });
  if (r.success && r.data) return r.data;
  return { error: r.error ?? "產生權杖失敗" };
}

/**
 * 撤銷（軟刪除）一把權杖。
 */
export async function revokeApiToken(id: string): Promise<boolean> {
  const r = await fetchJson<void>(`/api/me/tokens/${id}`, { method: "DELETE" });
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

/**
 * 更新「精煉成筆記」轉錄設定：引擎與（可選）Groq 金鑰。
 * @param payload transcriptionEngine（gemini/groq）；groqApiKey（非 null 才更新；空字串＝清除）。
 */
export async function updateTranscriptionSettings(payload: {
  transcriptionEngine?: "gemini" | "groq";
  groqApiKey?: string;
}): Promise<UserSettings | null> {
  const r = await fetchJson<UserSettings>("/api/me/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return r.data ?? null;
}

/**
 * 「精煉成筆記」：丟一個 URL，後端非同步抓字幕/音訊轉錄後整理成分類筆記。
 * 立即回傳（含 sessionId）；進度顯示在「AI 處理中」佇列。
 */
export async function refineUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetchJson<{ sessionId: string }>("/api/refine", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  return { ok: r.success, error: r.success ? undefined : r.error ?? undefined };
}

/**
 * 上傳音訊／影片檔精煉成筆記（multipart/form-data）。
 *
 * 不走 fetchJson（它固定送 application/json）；改用 FormData，讓瀏覽器自帶 multipart boundary。
 * 適合「手機/電腦自己抓下來的 IG/影片檔」：上傳後 ZonWiki 轉錄＋整理成分類筆記。
 * @param file 使用者選的音訊/影片檔
 * @returns ok=是否已加入處理佇列；error=失敗訊息
 */
export async function refineUpload(file: File): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`${apiBase()}/api/refine/upload`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zonwiki:unauthorized"));
    }
    const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (res.ok && body?.success) {
      return { ok: true };
    }
    return { ok: false, error: body?.error ?? `上傳失敗（${res.status}）` };
  } catch {
    return { ok: false, error: "上傳失敗，請稍後再試。" };
  }
}
