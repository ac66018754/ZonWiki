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
    const parts = pathname.split("/");
    // 特例：/others/coach 走滿版（隱藏側欄），但其餘 /others/* 需保留側欄。
    // 因 data-route 只取第一段（others）不足以區分，這裡把教練頁單獨標為 "coach"，
    // 讓 globals.css 的滿版白名單只命中教練頁（計畫 §8）。
    const segment =
      parts[1] === "others" && parts[2] === "coach" ? "coach" : parts[1] || "home";
    document.documentElement.setAttribute("data-route", segment);
  }, [pathname]);

  return null;
}
