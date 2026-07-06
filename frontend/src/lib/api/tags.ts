/**
 * API 領域模組 — 標籤庫（Tag）。
 *
 * 標籤庫由筆記、任務、常用連結共用；本檔負責標籤本身的 CRUD 與排序。
 * 各實體「貼／取消貼標籤」的關聯操作放在各自的領域模組（notes / tasks / home）。
 */

import { fetchJson } from "./client";

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
 * 列出所有筆記標籤
 */
export async function listNoteTags(): Promise<NoteTag[]> {
  const r = await fetchJson<NoteTag[]>("/api/notes/tags");
  return r.data ?? [];
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
