import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { SidebarResizer } from "@/components/SidebarResizer";
import { AuthGuard } from "@/components/AuthGuard";
import { SessionExpiryPrompt } from "@/components/SessionExpiryPrompt";
import { MobileNavOverlay } from "@/components/MobileNavOverlay";
import { ShortcutRuntime } from "@/components/ShortcutRuntime";
import { RouteAttr } from "@/components/RouteAttr";
import { CanvasToolbarProvider } from "@/components/CanvasToolbarContext";
import { getCurrentUser } from "@/lib/api";
import { cookies } from "next/headers";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZonWiki — 個人知識與任務工作區",
  description:
    "整合筆記、任務、行事曆與 AI 畫布的個人知識管理系統。支援多顯示模式、實時協作。",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
};

// 設定頁面為動態渲染 (每次請求都取最新的使用者資訊)
//
// ⚠️ 請勿移除 force-dynamic：它同時關閉 streaming。
// login/page.tsx 對「已登入者」會 redirect("/")；只有在非 streaming 下，
// redirect 才會在「外殼 HTML 送出前」就中止整個回應。若移除此設定 → 啟用 streaming →
// 外殼 HTML 會先送到瀏覽器、redirect 變成事後的 meta 標籤，
// 就會重現「登入表單套在登入後外殼裡」的嚴重 bug。
export const dynamic = "force-dynamic";

/**
 * 主題初始化腳本
 * - 從 localStorage 讀取主題偏好 (warmpaper|light|dark|night)
 * - 若無偏好，根據系統偏好選擇 light 或 dark
 * - 在 SSR 前應用，避免主題閃爍
 */
const themeInitScript = `
(function(){
  try{
    var theme = localStorage.getItem('zonwiki:theme');
    if(!theme || !['warmpaper','light','dark','night'].includes(theme)){
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'warmpaper';
    }
    document.documentElement.setAttribute('data-theme', theme);
  }catch(e){}
})();
`;

/**
 * 側欄寬度／隱藏狀態初始化腳本（在 paint 前套用，避免閃爍）
 * - 從 localStorage 讀取使用者調整過的側欄寬度與是否收起
 */
const sidebarInitScript = `
(function(){
  try{
    var w = parseInt(localStorage.getItem('zonwiki:sidebarWidth'),10);
    if(w && w>=180 && w<=560){ document.documentElement.style.setProperty('--sidebar-width', w+'px'); }
    if(localStorage.getItem('zonwiki:sidebarHidden')==='1'){ document.documentElement.setAttribute('data-sidebar-hidden',''); }
  }catch(e){}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // SSR 時把瀏覽器送來的 cookie 轉發給 API，讓伺服器端也能正確判斷登入狀態
  const cookieHeader = (await cookies()).toString();
  const user = await getCurrentUser(cookieHeader).catch(() => null);

  return (
    <html
      lang="zh-Hant"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body>
        {/* 把目前路由寫到 <html data-route>，供 CSS 調整版面 */}
        <RouteAttr />

        {/* 驗證守護：未登入時重導到登入頁 */}
        <AuthGuard user={user} />

        {/* 登入失效提示：任一 API 回 401 時彈出「請先登入」+前往登入按鈕（取代靜默彈回） */}
        <SessionExpiryPrompt />

        <CanvasToolbarProvider>
        {user ? (
          // 已登入：套用完整外殼（標題列 + 左側欄 + 主內容）
          <div className="layout-root">
            {/* 標題列 (固定) */}
            <Suspense fallback={<div className="header" />}>
              <Header user={user} />
            </Suspense>

            {/* 行動版抽屜遮罩：放在版面根層（非 Header 內），確保堆疊在抽屜之下 */}
            <MobileNavOverlay />

            {/* 全域鍵盤快捷鍵執行器（無 UI）：導覽 / 聚焦搜尋 / Todo 頁檢視切換等 */}
            <ShortcutRuntime />

            {/* 左側欄 + 主內容 */}
            <div style={{ display: "flex", flex: 1 }}>
              <Suspense fallback={<div className="sidebar" />}>
                <Sidebar user={user} />
              </Suspense>

              {/* 側欄可拖曳調寬 + 可隱藏控制器 */}
              <Suspense fallback={null}>
                <SidebarResizer />
              </Suspense>

              {/* 主內容區 */}
              <main className="main-content">{children}</main>
            </div>
          </div>
        ) : (
          // 未登入（登入頁）：不套外殼，讓登入頁以自己的滿版置中版面呈現
          children
        )}
        </CanvasToolbarProvider>
      </body>
    </html>
  );
}
