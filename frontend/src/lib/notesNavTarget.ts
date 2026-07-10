/**
 * 計算「進入筆記頁」的導航目標（Header「筆記」連結與快捷鍵 N 共用）。
 *
 * 若 localStorage 記得「最後看的筆記」slug，就回到那一篇（含捲動位置由筆記頁自行還原）；
 * 否則退回筆記清單 /notes。slug 可能含「/」分段，逐段 encodeURIComponent 再組回，
 * 避免特殊字元破壞網址。每次呼叫都即時讀 localStorage，確保拿到最新一篇。
 * localStorage 不可用時（如隱私模式）安全退回 /notes。
 *
 * 抽成共用函式的目的（DRY）：讓 Header 的「筆記」連結與 ShortcutRuntime 的
 * 快捷鍵 N（openNotes）走同一套目的地計算邏輯，兩邊行為完全一致。
 *
 * @returns 導航目的地路徑字串（如 `/notes` 或 `/notes/foo/bar`）。
 */
export function getNotesNavTarget(): string {
  try {
    const slug = localStorage.getItem("zonwiki:last-note-slug");
    if (slug) {
      return `/notes/${slug.split("/").map(encodeURIComponent).join("/")}`;
    }
  } catch {
    /* localStorage 不可用 → 進清單 */
  }
  return "/notes";
}
