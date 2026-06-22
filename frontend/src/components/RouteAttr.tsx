"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * 把目前路由的第一段寫到 <html data-route="…">，
 * 讓 CSS 能依頁面調整版面（例如沒有左側欄的頁面把主內容改滿版）。
 * 用屬性選擇器而非 :has()，因為 :has() 會被 CSS 編譯器（lightningcss）依瀏覽器目標移除。
 */
export function RouteAttr() {
  const pathname = usePathname();

  useEffect(() => {
    const segment = pathname.split("/")[1] || "home";
    document.documentElement.setAttribute("data-route", segment);
  }, [pathname]);

  return null;
}
