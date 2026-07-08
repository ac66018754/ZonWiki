/**
 * API 相容層 — 舊 API（用於過渡期）。
 * 這些函式與型別別名用於相容舊版頁面元件，最終應被移除。
 */

import { getLoginUrl, getLogoutUrl } from "./auth";
import { listNoteCategories, type NoteCategory } from "./categories";
import { addNoteComment, listNoteComments, type Comment } from "./comments";
import { listNotes, type NoteDetail, type NoteSummary } from "./notes";

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

// 舊型別別名 (用於相容性)
export type Category = NoteCategory;
export type ArticleSummary = NoteSummary;
