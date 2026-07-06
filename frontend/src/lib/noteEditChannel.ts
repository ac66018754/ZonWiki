/**
 * 「編輯彈窗 ↔ 筆記頁」同源 BroadcastChannel 頻道名稱與訊息型別。
 *
 * 流程：筆記頁按「編輯」→ 開獨立編輯視窗（/notes/edit-popout）；筆記頁同時切成「即時預覽」
 * （渲染彈窗目前內容、非永久）。彈窗編輯 → 即時把 markdown 推回筆記頁預覽；彈窗按「保存」→ 存 DB、
 * 不關窗、通知筆記頁重抓；關閉彈窗 → 筆記頁回到存檔版閱讀畫面。
 */
export const NOTE_EDIT_CHANNEL = "zonwiki:note-edit";

/**
 * 依「每次開啟」的 session token 組出隔離的頻道名稱。
 *
 * 為什麼要隔離：BroadcastChannel 以「名稱」廣播給同源所有分頁。若固定用同一名稱，
 * 使用者同時開兩個筆記分頁、各自開編輯彈窗時，兩邊會收到彼此的 edit-init／edit-content，
 * 導致「彈窗初始化到錯的筆記」「A 筆記的預覽跑到 B 筆記頁」。用一次性 token 綁定每個彈窗 session，
 * 即可讓每個「筆記頁 ↔ 其彈窗」是專屬頻道、互不干擾。無 token 時退回基底名稱（向後相容）。
 *
 * @param token 每次開啟彈窗時產生的一次性識別碼（由筆記頁產生，經 URL 傳給彈窗）
 * @returns 隔離後的頻道名稱
 */
export function noteEditChannelName(token?: string | null): string {
  return token ? `${NOTE_EDIT_CHANNEL}:${token}` : NOTE_EDIT_CHANNEL;
}

/**
 * 即時預覽內容長度上限（字元）。
 * 防呆：避免異常長字串（或被同源惡意分頁灌爆）造成筆記頁渲染負擔；超過即忽略該訊息。
 */
export const NOTE_EDIT_MAX_CONTENT = 2_000_000;

/** 編輯彈窗初始化資料（筆記頁在彈窗 ready 時送出）。 */
export interface NoteEditInit {
  noteId: string;
  slug: string;
  title: string;
  content: string;
  categoryIds: string[];
  tagIds: string[];
}

/** 頻道訊息：popout→page 或 page→popout。 */
export type NoteEditMessage =
  | { type: "edit-ready" } // popout→page：我準備好了，請送初始資料
  | { type: "edit-init"; init: NoteEditInit } // page→popout：初始資料
  | { type: "edit-content"; content: string } // popout→page：目前編輯內容（供即時預覽）
  | { type: "edit-saved"; content: string } // popout→page：已存 DB（請重抓，不關窗）
  | { type: "edit-closing" }; // popout→page：彈窗關閉（筆記頁回存檔版）
