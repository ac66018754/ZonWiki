/**
 * 全域常數定義
 */

/**
 * 預設時區 (IANA)
 */
export const DEFAULT_TIMEZONE = "Asia/Taipei";

/**
 * 支援的顯示模式
 */
export const DISPLAY_MODES = ["warmpaper", "light", "dark", "night"] as const;

/**
 * 拖曳筆記時，dataTransfer 用來攜帶「筆記 ID」的自訂 MIME 型別。
 * 筆記清單頁（拖曳來源）與側欄分類列（放置目標）共用此字串，
 * 用於在 dragover 階段辨識「這是一個筆記拖曳」（此時無法讀取資料、只能看 types）。
 */
export const NOTE_DND_MIME = "application/x-zonwiki-note";

/**
 * 任務優先級標籤對應
 */
export const PRIORITY_LABELS: Record<number, string> = {
  3: "高",
  2: "中",
  1: "低",
};

/**
 * 任務優先級顏色對應
 */
export const PRIORITY_COLORS: Record<number, string> = {
  3: "var(--status-danger-fg)",
  2: "var(--status-warning-fg)",
  1: "var(--action-secondary-fg)",
  0: "var(--text-tertiary)",
};

/**
 * 是否啟用調試模式
 * 可透過 localStorage 的 'zonwiki:debug' 鑰匙開啟
 */
export function isDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("zonwiki:debug") === "true";
}
