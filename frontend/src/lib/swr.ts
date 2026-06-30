'use client';

import useSWR from 'swr';
import {
  getCurrentUser,
  getHomePage,
  listNotes,
  listNoteCategories,
  listNoteTags,
  listTaskCards,
  listTaskGroups,
  type CurrentUser,
  type HomePageAggregate,
  type NoteSummary,
  type NoteCategory,
  type NoteTag,
  type TaskCard,
  type TaskGroup,
} from './api';

/**
 * SWR 快取鍵（集中管理）。
 * 集中定義是為了讓任一元件都能用 SWR 的 global `mutate(key)` 撤銷快取／觸發重抓，
 * 不必各自硬編字串而失準。
 */
export const swrKeys = {
  /** 目前登入使用者（/api/me）。 */
  currentUser: 'me',
  /** 首頁聚合資料（/api/home）。 */
  homePage: 'home',
  /** 筆記分類清單。 */
  noteCategories: 'note-categories',
  /** 筆記標籤清單。 */
  noteTags: 'note-tags',
  /** 任務卡片清單。 */
  taskCards: 'task-cards',
  /** 任務群組清單。 */
  taskGroups: 'task-groups',
  /**
   * 筆記清單：依分類 / 標籤篩選，故 key 帶參數（不同篩選各自快取）。
   * @param categoryId 分類篩選（可空）。
   * @param tagId 標籤篩選（可空）。
   */
  notes: (categoryId?: string | null, tagId?: string | null) =>
    ['notes', categoryId ?? '', tagId ?? ''] as const,
} as const;

/**
 * 目前登入使用者（客戶端快取版）。
 */
export function useCurrentUser() {
  return useSWR<CurrentUser | null>(swrKeys.currentUser, () => getCurrentUser());
}

/**
 * 首頁聚合資料（客戶端快取版）。
 */
export function useHomePage() {
  return useSWR<HomePageAggregate | null>(swrKeys.homePage, () => getHomePage());
}

/**
 * 筆記分類清單（客戶端快取版）。
 */
export function useNoteCategories() {
  return useSWR<NoteCategory[]>(swrKeys.noteCategories, () => listNoteCategories());
}

/**
 * 筆記標籤清單（客戶端快取版）。
 */
export function useNoteTags() {
  return useSWR<NoteTag[]>(swrKeys.noteTags, () => listNoteTags());
}

/**
 * 筆記清單（依分類 / 標籤篩選；客戶端快取版）。
 * @param categoryId 分類篩選（可空）。
 * @param tagId 標籤篩選（可空）。
 */
export function useNotes(categoryId?: string | null, tagId?: string | null) {
  return useSWR<NoteSummary[]>(swrKeys.notes(categoryId, tagId), () =>
    listNotes({ categoryId: categoryId || undefined, tagId: tagId || undefined }),
  );
}

/**
 * 任務卡片清單（客戶端快取版）。
 */
export function useTaskCards() {
  return useSWR<TaskCard[]>(swrKeys.taskCards, () => listTaskCards());
}

/**
 * 任務群組清單（客戶端快取版）。
 */
export function useTaskGroups() {
  return useSWR<TaskGroup[]>(swrKeys.taskGroups, () => listTaskGroups());
}
