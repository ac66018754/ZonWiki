'use client';

/**
 * 任務（日程規劃）相關的「型別化事件匯流排」。
 *
 * 與 {@link import('./noteEvents')} 同一套做法：暫態的跨元件 UI 訊號集中成 emit / subscribe helper，
 * 底層仍是 window CustomEvent，但事件名稱與 payload 型別只有一個來源，呼叫端不再各自硬編字串。
 *
 * 為什麼需要它：左側欄（TasksSidebar）與 Todo 頁（/tasks 的 page.tsx）是兩棵獨立的 React 樹
 * （側欄由版面外殼渲染），沒有共同的父層可以傳 callback，故以事件連通。
 */

/** 事件名稱：請求開啟「新增任務」表單。 */
const NEW_TASK_EVENT = 'zonwiki:new-task';

/**
 * 「請求新增任務」事件的 payload。
 */
export interface NewTaskRequestDetail {
  /** 是否預先勾選「置頂（Todo 側欄）」（由側欄的「置頂的任務」分頁按＋新增時帶 true）。 */
  pinnedToTodo?: boolean;
}

/**
 * 請求 Todo 頁彈出「新增任務」表單。
 * @param detail 預填選項（目前只有「是否預先勾選置頂」）。
 */
export function emitNewTaskRequest(detail: NewTaskRequestDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NewTaskRequestDetail>(NEW_TASK_EVENT, { detail }));
}

/**
 * 訂閱「請求新增任務」事件（由 Todo 頁監聽並開啟快速新增表單）。
 * @param handler 收到事件時的回呼，帶入預填選項。
 * @returns 取消訂閱函式（於 effect cleanup 呼叫）。
 */
export function subscribeNewTaskRequest(
  handler: (detail: NewTaskRequestDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<NewTaskRequestDetail>).detail ?? {});
  };
  window.addEventListener(NEW_TASK_EVENT, listener);
  return () => window.removeEventListener(NEW_TASK_EVENT, listener);
}
