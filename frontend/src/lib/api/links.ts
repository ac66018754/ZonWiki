/**
 * API 領域模組 — 實體互連（EntityLink）。
 *
 * 任務 / 子任務 / 筆記 / 開問啦節點之間的雙向關聯（列出、建立、刪除、搜尋候選）。
 */

import { fetchJson } from "./client";

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
