"use client";

import { createContext, useContext } from "react";
import type { CategoryEditorContextValue } from "./types";

/**
 * 分類編輯器 context：只供 CategoryEditor 表單消費。
 * 把「編輯器輸入狀態」與「分類樹」隔離，避免打字時重繪整棵樹（審查 finding #22）。
 */
export const CategoryEditorContext = createContext<CategoryEditorContextValue | null>(null);

/**
 * 取用分類編輯器 context。
 * @returns 編輯器的受控狀態與回呼。
 */
export function useCategoryEditor(): CategoryEditorContextValue {
  const ctx = useContext(CategoryEditorContext);
  if (!ctx) {
    throw new Error("useCategoryEditor 必須在 CategoryEditorContext.Provider 內使用");
  }
  return ctx;
}
