import type React from "react";
import type { NoteCategory, NoteSummary, NoteTag } from "@/lib/api";

/**
 * 分類拖曳的落點區：
 * - before / after：同層級調整順序（插到目標分類前 / 後）。
 * - inside：改掛到目標分類底下（變成其子分類）。
 */
export type CatDropZone = "before" | "after" | "inside";

/**
 * 分類拖曳目前的放置目標與落點區（供高亮與放下時判斷）。
 */
export interface CatDrop {
  /** 游標所在的目標分類 ID。 */
  id: string;
  /** 落點區（前 / 後 / 內）。 */
  zone: CatDropZone;
}

/**
 * 分類編輯器（新增或編輯）的開啟狀態。
 */
export interface CatEditorState {
  /** 模式：新增或編輯。 */
  mode: "add" | "edit";
  /** 編輯時的分類 ID（新增時為 undefined）。 */
  id?: string;
  /** 上層分類 ID（null＝最上層）。 */
  parentId: string | null;
}

/**
 * 分類樹（CategoryNode）所需的「穩定回呼與資料存取」集合。
 *
 * 這組物件由 Sidebar 以 useMemo/useCallback 產生並保持參考穩定，透過 prop 沿遞迴往下傳，
 * 讓 React.memo 的 CategoryNode 在「與樹無關的父層狀態變更（如編輯器輸入、忙碌旗標、錯誤訊息）」
 * 發生時，因所有 prop 參考不變而略過整棵子樹的重繪（審查 finding #22）。
 */
export interface SidebarTreeHandlers {
  /** 取某上層底下的直接子分類（parentId 為 null＝最上層）。 */
  childrenOf: (parentId: string | null) => NoteCategory[];
  /** 取某分類底下的筆記（已排序）。 */
  notesOf: (categoryId: string) => NoteSummary[];
  /** 取某分類的所有子孫 ID（防循環用）。 */
  descendantIds: (id: string) => Set<string>;
  /** 切換某分類的展開 / 收合。 */
  toggleCollapse: (id: string) => void;
  /** 依游標縱向位置判斷分類列的落點區。 */
  dropZoneFromEvent: (event: React.DragEvent, el: HTMLElement) => CatDropZone;
  /** 設定正在拖曳的分類 ID。 */
  setDragCatId: (id: string | null) => void;
  /** 設定分類拖曳的放置目標與落點區。 */
  setCatDrop: (drop: CatDrop | null) => void;
  /** 設定筆記拖入時游標所在的分類 ID（高亮用）。 */
  setNoteDropCatId: (id: string | null) => void;
  /** 把分類改掛到新的上層（變子分類 / 移到頂層）。 */
  reparentCategory: (childId: string, newParentId: string | null) => void;
  /** 把分類插到目標分類的同層級前 / 後（調順序）。 */
  reorderCategorySibling: (dragId: string, targetId: string, zone: "before" | "after") => void;
  /** 把一篇筆記加入某分類（來自筆記清單頁的拖曳）。 */
  handleDropNoteOnCategory: (noteId: string, categoryId: string) => void;
  /** 把分類在同層兄弟中往上移一位。 */
  moveCategoryUp: (cat: NoteCategory) => void;
  /** 把分類在同層兄弟中往下移一位。 */
  moveCategoryDown: (cat: NoteCategory) => void;
  /** 開啟「編輯分類」編輯器。 */
  openEditCategory: (cat: NoteCategory) => void;
  /** 開啟分類「＋」的中央彈窗（新增筆記 / 新增子分類）。 */
  openCategoryAction: (cat: NoteCategory) => void;
  /** 刪除分類（軟刪除，經確認）。 */
  handleDeleteCategory: (cat: NoteCategory) => void;
}

/**
 * 分類編輯器表單（CategoryEditor）所需的受控狀態與回呼。
 *
 * 這組值只由「當前唯一開啟的編輯器」透過 context 消費（見 categoryEditorContext），
 * 因此在編輯器輸入時只會重繪那一個表單，不會牽動整棵 CategoryNode 樹（finding #22）。
 */
export interface CategoryEditorContextValue {
  /** 目前開啟的編輯器狀態（null＝未開啟）。 */
  editor: CatEditorState | null;
  /** 分類名稱輸入值。 */
  catName: string;
  /** 設定分類名稱。 */
  setCatName: (value: string) => void;
  /** 上層分類 ID（null＝最上層）。 */
  catParentId: string | null;
  /** 設定上層分類 ID。 */
  setCatParentId: (value: string | null) => void;
  /** 目前勾選的標籤 ID 清單。 */
  catTagIds: string[];
  /** 切換某標籤是否指派給此分類。 */
  toggleCatTag: (tagId: string) => void;
  /** 全部標籤（供勾選）。 */
  tags: NoteTag[];
  /** 上層下拉選項（已排除自己與子孫，避免循環）。 */
  parentDropdownOptions: NoteCategory[];
  /** 儲存分類。 */
  saveCategory: () => void;
  /** 關閉編輯器。 */
  closeCatEditor: () => void;
  /** 是否正在儲存中（禁用按鈕）。 */
  busy: boolean;
}
