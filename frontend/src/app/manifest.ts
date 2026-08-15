import type { MetadataRoute } from "next";

/**
 * PWA manifest（Next.js App Router 原生支援；Next 服務於 /manifest.webmanifest）。
 *
 * 設計書 §8.4 PWA 地基：供 iPhone「加入主畫面」以 standalone web app 開啟。
 *
 * token 例外（設計書 §11「只用 token」的合理例外）：manifest 是 JSON、無法讀 CSS 變數，
 * 故 background_color／theme_color 只能寫死 hex；取值直接對應 warmpaper 主題 token 的實際值
 * （--bg-canvas 與 --action-primary-bg，已於 globals.css 核對）。此例外需在 docs/DECISIONS.md 記一筆（監工整合時）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZonWiki — 個人知識與任務工作區",
    short_name: "ZonWiki",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f7", // 對應 warmpaper --bg-canvas
    theme_color: "#2d5016", // 對應 --action-primary-bg（品牌綠）
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
