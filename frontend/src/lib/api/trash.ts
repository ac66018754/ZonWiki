/**
 * API 領域模組 — 統一垃圾桶（Trash）。
 *
 * 跨模組（筆記 / 任務 / 開問啦畫布等）的軟刪除項目列出、還原與永久刪除。
 */

import { fetchJson } from "./client";

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
