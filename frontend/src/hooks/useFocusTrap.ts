"use client";

import { RefObject, useEffect, useRef } from "react";

/**
 * useFocusTrap 的選項。
 */
interface UseFocusTrapOptions {
  /**
   * 按下 Esc 時的回調（通常用來關閉對話框）。
   * 未提供時不處理 Esc。
   */
  onEscape?: () => void;
}

/**
 * 可聚焦元素的 CSS 選擇器。
 * 涵蓋按鈕、連結、表單控件與帶有 tabindex 的元素；排除 disabled 與 tabindex="-1"。
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * 焦點陷阱 Hook（無障礙）。
 *
 * 在對話框（dialog / modal）啟用期間：
 * 1. 記住開啟前的焦點元素，並把焦點移到容器內第一個可聚焦元素；
 * 2. 攔截 Tab／Shift+Tab，讓焦點在容器內循環（不會跑到背景頁面）；
 * 3. 按 Esc 觸發 onEscape（若有提供）；
 * 4. 關閉（isActive 轉為 false）或卸載時，把焦點還原回開啟前的元素。
 *
 * @param containerRef 對話框容器的 ref（焦點循環的範圍）
 * @param isActive     是否啟用陷阱（對話框是否開啟）
 * @param options      額外選項（例如 Esc 回調）
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  options?: UseFocusTrapOptions
): void {
  // 以 ref 保存 onEscape，避免它在每次 render 產生新函式而反覆重掛監聽器
  const onEscapeRef = useRef<UseFocusTrapOptions["onEscape"]>(options?.onEscape);
  onEscapeRef.current = options?.onEscape;

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    // 記住開啟前的焦點元素，關閉時還原
    const previouslyFocused = document.activeElement as HTMLElement | null;

    /**
     * 取得目前容器內所有可聚焦元素（每次即時查詢，涵蓋動態內容）。
     */
    const getFocusable = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(
        (element) =>
          element.offsetParent !== null || element === document.activeElement
      );

    // 進入時聚焦第一個可聚焦元素；若沒有則聚焦容器本身
    const focusableOnOpen = getFocusable();
    if (focusableOnOpen.length > 0) {
      focusableOnOpen[0].focus();
    } else {
      container.focus();
    }

    /**
     * 鍵盤處理：Esc 關閉、Tab 在容器內循環。
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (onEscapeRef.current) {
          event.preventDefault();
          onEscapeRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // 沒有可聚焦元素時，Tab 不應離開容器
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        // Shift+Tab：從第一個往前 → 循環到最後一個
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab：從最後一個往後 → 循環回第一個
        if (active === last || !container.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // 還原焦點到開啟前的元素（若仍在文件中）
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, isActive]);
}
