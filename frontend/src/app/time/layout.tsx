import type { Metadata } from "next";

/**
 * /time（時間儀表板）的路由層 layout：
 * 只負責提供頁面標題等 metadata（page.tsx 是 client 元件、不能匯出 metadata）。
 * 版面「無外殼」（不顯示標題列與側欄）由 globals.css 的 html[data-route="time"] 規則處理。
 */
export const metadata: Metadata = {
  title: "時間 — ZonWiki",
  description:
    "今日／本週時間追蹤＋行程儀表板（獨立極簡頁，適合加到手機主畫面）。",
};

/**
 * 直接透傳子頁；不添加任何額外 DOM。
 */
export default function TimeDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
