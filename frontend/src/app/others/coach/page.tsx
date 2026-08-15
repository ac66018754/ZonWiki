import type { ReactElement } from "react";
import { CoachClientEntry } from "./CoachClientEntry";

/**
 * 英文教練頁（Phase 3，即時語音對話）。
 *
 * 【SSR 定案｜計畫 §5/§6 審修-F1】
 * 本檔保持 **Server Component**（App Router 內不可自行 `dynamic(ssr:false)`，會 build 報錯），
 * 僅渲染 client wrapper `<CoachClientEntry>`；再由該 wrapper 對 `<CoachLiveWorkspace>`
 * 做 dynamic(ssr:false)，把 AudioContext/window 相依的音訊層限制在瀏覽器求值。
 *
 * 【滿版｜計畫 §8】
 * 路由 `/others/coach` 走滿版：Sidebar 為此路由回 `sidebar--hidden`（保留 MobileSectionNav），
 * globals.css 以 `html[data-route="coach"]` 白名單把 `.main-content` margin 歸零、隱藏側欄控制器；
 * RouteAttr 特例把 `/others/coach` 的 data-route 設為 `coach`（其餘 /others/* 仍為 others、保留側欄）。
 *
 * 登入：未登入者由 layout 的 AuthGuard 統一導向登入頁（returnUrl 回本頁），此處不另處理。
 */
export default function CoachPage(): ReactElement {
  return <CoachClientEntry />;
}
