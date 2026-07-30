import { noteHref } from "./noteHref";

/**
 * 組出「反向連結項目」的導航網址。
 *
 * 三種來源的跳轉語意不同：
 * - mark（框選段落關聯）：要跳回「來源筆記的那個段落」——在整篇連結後接 ?mark={markId} 深連結，
 *   筆記頁（notes/[...slug]）讀 ?mark= 後會捲動到該標註並短暫高亮（與提問佇列 /ai-queue 同慣例）。
 * - wiki／entity（整篇關聯），或 kind=mark 但 markId 缺失：退回整篇連結，
 *   且「不」拼 ?mark=，避免組出 ?mark=null 這種髒尾巴（防 query 注入與無效深連結）。
 *
 * 路徑一律經 noteHref 逐段編碼（處理 slug 內的「#」fragment 陷阱與「/」層級保留；詳見 noteHref JSDoc）；
 * markId 經 encodeURIComponent，避免含「&」「=」等字元污染 query。
 *
 * @param b 反向連結項目（必要 sourceNoteSlug；kind 與 markId 決定是否加 ?mark= 深連結）
 * @returns 導航網址字串（整篇連結，或整篇連結 + ?mark= 深連結）
 */
export function backlinkHref(b: {
  sourceNoteSlug: string;
  kind?: string | null;
  markId?: string | null;
}): string {
  const base = noteHref(b.sourceNoteSlug);
  // 僅 mark 來源且 markId 確有值時才加深連結；其餘一律退回整篇連結。
  if (b.kind === "mark" && b.markId) {
    return `${base}?mark=${encodeURIComponent(b.markId)}`;
  }
  return base;
}
