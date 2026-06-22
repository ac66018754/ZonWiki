"use client";

import { closeMobileNav } from "@/lib/mobileNav";

/**
 * 行動版側欄抽屜的遮罩（手機斷點且抽屜開啟時由 CSS 顯示；點擊關閉抽屜）。
 *
 * 重要：此遮罩必須渲染在「版面根層」（layout-root），不可放在 Header 內部。
 * Header 是 sticky + z-index，會自成一個堆疊環境（stacking context）；若遮罩放在 Header 裡，
 * 其 z-index:44 會被困在 Header 的堆疊環境內，反而疊到側欄抽屜（z-index:45，屬根堆疊環境）之上，
 * 導致點抽屜內的連結時其實點到遮罩 → 抽屜被關掉、頁面切換不了（卡在原頁）。
 * 放在根層後，遮罩(44) 與抽屜(45) 同屬根堆疊環境，抽屜才會正確蓋在遮罩之上。
 */
export function MobileNavOverlay() {
  return (
    <div
      className="mobnav-overlay"
      onClick={closeMobileNav}
      role="presentation"
      aria-hidden="true"
    />
  );
}
