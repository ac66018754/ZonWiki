/**
 * API 領域模組 — 筆記（Note）。
 *
 * 涵蓋筆記本體 CRUD、筆記與標籤/分類的關聯、文字標註（marks）、浮層元件（overlay）、
 * 版本歷史、反向連結，以及筆記相關的 AI 動作（框選提問、美化、排版）。
 */

import { withAiQueueNotify } from "../aiQueue";
import { ConflictError } from "../errors";
import { fetchJson } from "./client";
import type { NoteCategory } from "./categories";
import type { NoteTag } from "./tags";

// ============================================================================
// 資料型別 — Note (筆記)
// ============================================================================

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
  /** 更新時間 (UTC) — 最後編輯時間 */
  updatedDateTime: string;
  /** 建立時間 (UTC) */
  createdDateTime?: string;
  /** 最後打開（檢視）時間 (UTC，可空＝從未打開) */
  lastOpenedDateTime?: string | null;
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
  /** 樂觀鎖版本（PostgreSQL xmin，#4/#34）；保存時原封帶回為 baseVersion 供後端偵測併發衝突 */
  version?: number;
  /** @deprecated 相容舊欄位名 */
  categoryId?: string;
  /** @deprecated 相容舊欄位名 */
  categoryName?: string;
  /** @deprecated 相容舊欄位名 */
  filePath?: string;
}

// ============================================================================
// API 方法 — 筆記與標籤的關聯（標籤庫本身的 CRUD 見 tags.ts）
// ============================================================================

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

// ============================================================================
// API 方法 — Note (筆記)
// ============================================================================

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
 * 標記筆記「最後打開時間」（開啟筆記詳情時呼叫；輕量、不影響編輯時間）。
 * 失敗時靜默忽略（純排序輔助，不應打斷閱讀）。
 */
export async function markNoteOpened(noteId: string): Promise<void> {
  try {
    await fetchJson<{ id: string }>(`/api/notes/${noteId}/opened`, { method: "POST" });
  } catch {
    // 忽略
  }
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
    /** 樂觀鎖 baseVersion（#4/#34）：帶值時後端比對 xmin，衝突丟 ConflictError；不帶＝last-write-wins */
    baseVersion: number;
  }>
): Promise<NoteDetail | null> {
  const r = await fetchJson<NoteDetail>(
    `/api/notes/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  // 樂觀鎖衝突（#4/#34）：轉成 ConflictError 讓呼叫端提示「覆蓋或重新載入」。
  if (!r.success && r.statusCode === 409) {
    throw new ConflictError(r.error ?? undefined);
  }
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
  return withAiQueueNotify(async () => {
    const r = await fetchJson<AskSelectionResult>(
      `/api/notes/${encodeURIComponent(noteId)}/ask-selection`,
      { method: 'POST', body: JSON.stringify(input) }
    );
    return r.data ?? null;
  });
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
  return withAiQueueNotify(async () => {
    const r = await fetchJson<{ answer: string }>(
      `/api/notes/${encodeURIComponent(noteId)}/ask-selection-answer`,
      { method: 'POST', body: JSON.stringify(input) }
    );
    return r.data?.answer ?? null;
  });
}

/**
 * 通用 AI 提問（不綁定筆記/節點）：以呼叫端組好的 context + question 請 AI 回答。
 * 用於開問啦畫布便利貼的「繼續問」（沒有單一筆記脈絡）。
 */
export async function askAi(context: string, question: string): Promise<string | null> {
  return withAiQueueNotify(async () => {
    const r = await fetchJson<{ answer: string }>('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ context, question }),
    });
    return r.data?.answer ?? null;
  });
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
  /** "sticky" | "drawing" | "slide" | "text" */
  kind: 'sticky' | 'drawing' | 'slide' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** 便利貼底色 / 純文字框字色 */
  color?: string | null;
  /** 便利貼文字 / 純文字框內容 */
  text?: string | null;
  /** 型別專屬資料 JSON：drawing→筆畫；slide→圖片網址陣列；text→{bg,fontSize,rotation} */
  dataJson?: string | null;
}

/** 建立浮層元件的輸入。 */
export interface CreateNoteOverlayInput {
  kind: 'sticky' | 'drawing' | 'slide' | 'text';
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
  return withAiQueueNotify(async () => {
    const r = await fetchJson<AiTransformResult>(
      `/api/notes/${encodeURIComponent(noteId)}/reformat`,
      {
        method: 'POST',
        body: JSON.stringify({ contentRaw }),
      }
    );
    return r.data ?? null;
  });
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
  return withAiQueueNotify(async () => {
    const r = await fetchJson<AiTransformResult>(
      `/api/notes/${encodeURIComponent(noteId)}/beautify`,
      {
        method: 'POST',
        body: JSON.stringify({ contentRaw }),
      }
    );
    return r.data ?? null;
  });
}
