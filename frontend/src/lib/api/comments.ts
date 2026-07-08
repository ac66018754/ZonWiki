/**
 * API 領域模組 — 筆記留言（Comment）。
 */

import { fetchJson } from "./client";

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
