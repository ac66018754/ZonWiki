'use client';

/**
 * 「帳號大頭貼已更新」的型別化事件（同 lib/noteEvents、lib/taskEvents 的做法）。
 *
 * 為什麼需要：換大頭貼發生在個人頁（/profile），但要立刻反映的是 Header 右上角——
 * 兩者是各自獨立的 React 樹（Header 由版面外殼渲染），沒有共同父層可以傳 callback。
 * 不用「整頁重載」是因為那會把使用者正在填的其他欄位一起清掉。
 */

/** 事件名稱：帳號大頭貼已更新。 */
const AVATAR_CHANGED_EVENT = 'zonwiki:avatar-changed';

/**
 * 廣播「大頭貼已更新」。
 * @param avatarUrl 新的大頭貼 data URI；null 代表已移除（回到顯示名字首字）。
 */
export function emitAvatarChanged(avatarUrl: string | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<{ avatarUrl: string | null }>(AVATAR_CHANGED_EVENT, { detail: { avatarUrl } }),
  );
}

/**
 * 訂閱「大頭貼已更新」事件。
 * @param handler 收到事件時的回呼，帶入新的大頭貼（null＝已移除）。
 * @returns 取消訂閱函式（於 effect cleanup 呼叫）。
 */
export function subscribeAvatarChanged(handler: (avatarUrl: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<{ avatarUrl: string | null }>).detail?.avatarUrl ?? null);
  };
  window.addEventListener(AVATAR_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
}
