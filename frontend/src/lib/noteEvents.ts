'use client';

/**
 * 筆記相關的「型別化事件匯流排」（跨元件、非可快取的暫態 UI 訊號）。
 *
 * 背景（審查 finding #28）：先前各處直接以裸字串 `window.dispatchEvent(new CustomEvent(...))`
 * 廣播事件、又在別處手寫 `addEventListener` 監聽，事件名稱與 payload 型別四散、容易失準。
 * 這裡把「目前閱讀的筆記所屬分類」這種**暫態 UI 訊號**（無法快取、不屬於任何資料集）集中成
 * 型別化的 emit / subscribe helper：底層仍走 window CustomEvent（傳輸行為不變），但名稱與
 * 型別單一來源、呼叫端不再各自硬編字串。
 *
 * 註：屬於「資料集變更」的跨元件失效（例如筆記被歸類到某分類）不走這裡，一律改用 SWR 的
 * global mutate 撤銷對應快取（見 Sidebar 的 handleDropNoteOnCategory）。
 */

/** 事件名稱：目前閱讀的筆記所屬分類已變更。 */
const ACTIVE_CATEGORY_EVENT = 'zonwiki:note-active-category';

/**
 * 「目前閱讀的筆記所屬分類」事件的 payload。
 */
export interface NoteActiveCategoryDetail {
  /** 目前筆記所屬的分類 ID 清單（空陣列＝離開筆記或無分類）。 */
  categoryIds: string[];
}

/**
 * 廣播「目前閱讀的筆記所屬分類」給側欄（供其標示「📍 此筆記在這」）。
 * @param categoryIds 目前筆記所屬的分類 ID 清單。
 */
export function emitNoteActiveCategory(categoryIds: string[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<NoteActiveCategoryDetail>(ACTIVE_CATEGORY_EVENT, {
      detail: { categoryIds },
    }),
  );
}

/**
 * 訂閱「目前閱讀的筆記所屬分類」事件。
 * @param handler 收到事件時的回呼，帶入最新的分類 ID 清單。
 * @returns 取消訂閱函式（於 effect cleanup 呼叫）。
 */
export function subscribeNoteActiveCategory(
  handler: (categoryIds: string[]) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const ids = (event as CustomEvent<NoteActiveCategoryDetail>).detail?.categoryIds ?? [];
    handler(ids);
  };
  window.addEventListener(ACTIVE_CATEGORY_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_CATEGORY_EVENT, listener);
}
