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
 * 拖曳筆記時攜帶「來源分類 ID」的第二個 MIME（2026-08-13「切換/增加」提示用）。
 * 只有「從側欄分類樹拖出」才會帶（NoteRow 知道自己屬於哪個分類節點）；
 * 筆記清單頁卡片沒有明確來源、不帶此 MIME——drop 端以「是否存在」區分兩種語意。
 * 刻意用第二個 MIME 而非把 NOTE_DND_MIME 改成 JSON：舊 payload（純 noteId 字串）
 * 天然向後相容，免 parse 防禦碼。
 */
export const NOTE_DND_SOURCE_MIME = "application/x-zonwiki-note-src-cat";

/**
 * 筆記區的預設瀏覽器分頁標題（document.title）。
 *
 * 由 `app/notes/layout.tsx` 的靜態 metadata 與筆記詳細頁共用：
 * 詳細頁載入筆記後會把分頁標題換成「筆記標題 — ZonWiki」（方便多分頁辨識），
 * 離開該篇時再還原成本常數，兩處字串必須一致，故抽出共用避免漂移。
 */
export const NOTES_DEFAULT_DOCUMENT_TITLE = "筆記 — ZonWiki";

/**
 * 瀏覽器分頁標題的品牌後綴（含前置分隔符號）。
 *
 * 筆記詳細頁組出「{筆記標題}{此後綴}」。刻意把筆記標題放最前面：
 * Chrome 分頁變窄時只顯示開頭幾個字，被截斷的應該是品牌而非筆記標題。
 */
export const DOCUMENT_TITLE_BRAND_SUFFIX = " — ZonWiki";

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
