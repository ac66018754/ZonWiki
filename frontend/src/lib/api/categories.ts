/**
 * API 領域模組 — 筆記分類（Category）。
 */

import { fetchJson } from "./client";

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
 * 列出所有筆記分類
 */
export async function listNoteCategories(): Promise<NoteCategory[]> {
  const r = await fetchJson<NoteCategory[]>("/api/categories");
  return r.data ?? [];
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
