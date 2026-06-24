/**
 * 「AI 處理中」佇列即時更新工具。
 *
 * 任何 AI 生成動作（便利貼提問、框選提問、美化、排版、通用提問）觸發或完成時派發事件，
 * 讓 Header 的 AiProcessingMenu 立即重抓佇列（不必等輪詢），使「AI處理中(n)」即時更新。
 * 沿用本 app 既有的 window 自訂事件慣例（如 THEME_CHANGED_EVENT）。
 */

/** 佇列變動事件名稱。 */
export const AI_QUEUE_CHANGED_EVENT = 'zonwiki:ai-queue-changed';

/**
 * 通知「AI 處理中」佇列可能有變動（觸發重抓）。SSR 安全（無 window 時忽略）。
 */
export function notifyAiQueueChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AI_QUEUE_CHANGED_EVENT));
}

/**
 * 包裝一個會觸發 AI 的非同步呼叫：在「呼叫前」與「完成後」各派發一次佇列變動事件，
 * 讓 badge 在「開始（伺服器建立 Running）」與「結束（轉 Completed/Failed）」都能即時更新。
 * @typeParam T 內層呼叫的回傳型別。
 * @param fn 實際觸發 AI 的非同步函式。
 * @returns fn 的結果。
 */
export async function withAiQueueNotify<T>(fn: () => Promise<T>): Promise<T> {
  notifyAiQueueChanged();
  try {
    return await fn();
  } finally {
    notifyAiQueueChanged();
  }
}
