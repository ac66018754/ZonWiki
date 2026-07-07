'use client';

import useSWR, { type ScopedMutator } from 'swr';
import {
  getCurrentUser,
  getHomePage,
  listNotes,
  listNoteCategories,
  listNoteTags,
  listTaskCards,
  listTaskGroups,
  listExpenses,
  listExpenseCategories,
  getExpenseStats,
  getExpenseAnalytics,
  listVocabulary,
  fetchDueVocabulary,
  listTtsVoices,
  getTtsSettings,
  type TtsVoice,
  type TtsSettings,
  type CurrentUser,
  type HomePageAggregate,
  type NoteSummary,
  type NoteCategory,
  type NoteTag,
  type TaskCard,
  type TaskGroup,
  type ExpenseListResult,
  type ExpenseCategory,
  type ExpenseStats,
  type ExpenseAnalytics,
  type VocabularyListResult,
  type VocabularyWord,
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
  /** 消費分類清單。 */
  expenseCategories: 'expense-categories',
  /**
   * 消費紀錄清單：依月份 / 分類 / 頁碼篩選，故 key 帶參數（不同篩選各自快取）。
   * @param month 月份篩選（YYYY-MM，可空）。
   * @param categoryId 分類篩選（可空）。
   * @param page 頁碼（可空，預設第 1 頁）。
   */
  expenses: (
    month?: string | null,
    categoryId?: string | null,
    page?: number | null,
    pageSize?: number | null,
  ) => ['expenses', month ?? '', categoryId ?? '', page ?? 1, pageSize ?? 0] as const,
  /**
   * 消費本月統計。
   * @param month 月份（YYYY-MM）。
   */
  expenseStats: (month: string) => ['expense-stats', month] as const,
  /**
   * 記帳分析彙總：依月份 / 近 N 月 / 商家 Top N 各自快取。
   * 第一個元素固定為 'expense-analytics'，供 global mutate 以 matcher 一次撤銷。
   * @param month 月份（YYYY-MM）。
   * @param months 近 N 月。
   * @param topN 商家 Top N。
   */
  expenseAnalytics: (month: string, months: number, topN: number) =>
    ['expense-analytics', month, months, topN] as const,
  /**
   * 分析頁「下鑽明細」：重用清單端點，依 UTC 區間 / 分類各自快取。
   * @param from 起（含）ISO。
   * @param to 迄（含）ISO。
   * @param categoryId 分類篩選（可空）。
   */
  expenseDrilldown: (from: string, to: string, categoryId?: string | null) =>
    ['expense-drilldown', from, to, categoryId ?? ''] as const,
  /**
   * 單字清單：依狀態 / 搜尋 / 頁碼篩選，故 key 帶參數（不同篩選各自快取）。
   * 第一個元素固定為 'vocabulary'，供 global mutate 以 matcher 一次撤銷所有清單快取。
   * @param state 狀態篩選（可空）。
   * @param search 搜尋關鍵字（可空）。
   * @param page 頁碼（可空，預設第 1 頁）。
   * @param pageSize 每頁筆數（可空）。
   */
  vocabulary: (
    state?: string | null,
    search?: string | null,
    page?: number | null,
    pageSize?: number | null,
  ) => ['vocabulary', state ?? '', search ?? '', page ?? 1, pageSize ?? 0] as const,
  /** 單字到期複習佇列（/api/vocabulary/due）。 */
  vocabularyDue: 'vocabulary-due',
  /** TTS 30 聲清單（/api/tts/voices，幾乎不變，長快取）。 */
  ttsVoices: 'tts-voices',
  /** 使用者朗讀偏好（/api/me/tts-settings）。 */
  ttsSettings: 'tts-settings',
} as const;

/**
 * 撤銷所有單字相關快取（清單各分頁 + 到期佇列）。
 * 複習會改 due、CRUD 會改清單，兩者互相影響，故任一異動後一併重抓。
 * @param globalMutate `useSWRConfig().mutate`（全域 mutate）。
 */
export function revalidateAllVocabulary(globalMutate: ScopedMutator): void {
  // 清單：以 matcher 命中所有 ['vocabulary', ...] 陣列鍵。
  void globalMutate((key) => Array.isArray(key) && key[0] === 'vocabulary');
  // 到期佇列：字串鍵直接失效。
  void globalMutate(swrKeys.vocabularyDue);
}

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

/**
 * 消費分類清單（客戶端快取版）。
 */
export function useExpenseCategories() {
  return useSWR<ExpenseCategory[]>(swrKeys.expenseCategories, () => listExpenseCategories());
}

/**
 * 消費紀錄清單（依月份 / 分類 / 頁碼篩選；客戶端快取版）。
 * @param month 月份篩選（YYYY-MM，可空）。
 * @param categoryId 分類篩選（可空）。
 * @param page 頁碼（可空，預設第 1 頁）。
 * @param pageSize 每頁筆數（可空；不傳則後端套預設上限 50——分頁要正確運作必須明確傳入）。
 */
export function useExpenses(
  month?: string | null,
  categoryId?: string | null,
  page?: number | null,
  pageSize?: number | null,
) {
  return useSWR<ExpenseListResult>(
    swrKeys.expenses(month, categoryId, page, pageSize),
    () => listExpenses({ month, categoryId, page, pageSize }),
  );
}

/**
 * 消費本月統計（客戶端快取版）。
 * @param month 月份（YYYY-MM）。
 */
export function useExpenseStats(month: string) {
  return useSWR<ExpenseStats | null>(swrKeys.expenseStats(month), () => getExpenseStats(month));
}

/**
 * 記帳分析彙總（客戶端快取版）。
 * @param month 月份（YYYY-MM）；為空時不發請求。
 * @param months 近 N 月趨勢窗。
 * @param topN 商家 Top N。
 */
export function useExpenseAnalytics(month: string, months: number, topN: number) {
  return useSWR<ExpenseAnalytics | null>(
    month ? swrKeys.expenseAnalytics(month, months, topN) : null,
    () => getExpenseAnalytics(month, { months, topN }),
  );
}

/**
 * 分析頁「下鑽明細」（重用清單端點；客戶端快取版）。
 * `from` 為空時不發請求（尚未選取任何切片/日）。
 * @param from 起（含）ISO。
 * @param to 迄（含）ISO。
 * @param categoryId 分類篩選（可空）。
 */
export function useExpenseDrilldown(
  from: string | null,
  to: string | null,
  categoryId?: string | null,
) {
  return useSWR<ExpenseListResult>(
    from && to ? swrKeys.expenseDrilldown(from, to, categoryId) : null,
    () => listExpenses({ from, to, categoryId, pageSize: 200 }),
  );
}

/**
 * 單字清單（依狀態 / 搜尋 / 頁碼篩選；客戶端快取版）。
 * @param state 狀態篩選（可空）。
 * @param search 搜尋關鍵字（可空）。
 * @param page 頁碼（可空，預設第 1 頁）。
 * @param pageSize 每頁筆數（可空；不傳則後端套預設上限——分頁要正確運作必須明確傳入）。
 */
export function useVocabulary(
  state?: string | null,
  search?: string | null,
  page?: number | null,
  pageSize?: number | null,
) {
  return useSWR<VocabularyListResult>(
    swrKeys.vocabulary(state, search, page, pageSize),
    () => listVocabulary({ state, search, page, pageSize }),
  );
}

/**
 * 單字到期複習佇列（客戶端快取版）。
 */
export function useDueVocabulary() {
  return useSWR<VocabularyWord[]>(swrKeys.vocabularyDue, () => fetchDueVocabulary());
}

/**
 * TTS 30 聲清單（客戶端快取版）。
 * 聲音清單幾乎不變 → 關掉焦點/重連自動重抓，依賴 SWR 預設快取即可。
 */
export function useTtsVoices() {
  return useSWR<TtsVoice[]>(swrKeys.ttsVoices, () => listTtsVoices(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
}

/**
 * 使用者朗讀偏好（客戶端快取版）。
 * 端點未就緒（404）時 getTtsSettings 回 null，元件降級用系統預設。
 */
export function useTtsSettings() {
  return useSWR<TtsSettings | null>(swrKeys.ttsSettings, () => getTtsSettings());
}
