/**
 * 輕量級全域 Toast（小彈窗）系統。
 *
 * 設計：
 * - 任何元件呼叫 {@link showToast} 即可派發一則提示；無需把 Provider 串到每個頁面。
 * - 透過 window 自訂事件廣播，由掛在版面根層的 `<ToastHost/>` 接收並渲染。
 * - 彈窗會在 `durationMs` 內「先快速浮現、再漸漸淡出消失」，且**沒有關閉按鈕**
 *   （依使用者需求：自己消失、0～2 秒漸漸不見）。
 */

/** Toast 類型（決定配色）。 */
export type ToastType = "success" | "error" | "info";

/** 廣播 Toast 用的 window 事件名稱。 */
export const TOAST_EVENT = "zonwiki:toast";

/**
 * 單則 Toast 的內容（事件 detail）。
 */
export interface ToastDetail {
  /** 顯示文字。 */
  message: string;
  /** 類型，影響配色。 */
  type: ToastType;
  /** 總顯示毫秒數（含淡出）。 */
  durationMs: number;
}

/**
 * 顯示 Toast 的可選參數。
 */
export interface ToastOptions {
  /** 類型（預設 success）。 */
  type?: ToastType;
  /** 總顯示毫秒數（預設 2000；含「漸漸淡出」的時間）。 */
  durationMs?: number;
}

/**
 * 派發一則 Toast（小彈窗）。
 * @param message 顯示文字。
 * @param options 類型與持續時間等選項。
 */
export function showToast(message: string, options: ToastOptions = {}): void {
  // SSR 時無 window；直接略過（Toast 只在瀏覽器有意義）。
  if (typeof window === "undefined") return;
  const detail: ToastDetail = {
    message,
    type: options.type ?? "success",
    durationMs: options.durationMs ?? 2000,
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
