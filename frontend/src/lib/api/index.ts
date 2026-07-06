/**
 * API 客戶端 — 強型別、支援 SSR/CSR（barrel 匯出）。
 *
 * 本檔為 lib/api 各領域模組的統一出口，維持既有 `@/lib/api` 匯入 100% 相容：
 * 呼叫端沿用 `import { ... } from "@/lib/api"` 不需改動。
 *
 * 領域拆分：
 *   - client   共用 fetchJson / apiBase / ApiResponse（僅 ApiResponse 對外）
 *   - auth     使用者 / 認證 / 個人頁 / 權杖 / AI 動作軌跡 / 精煉成筆記
 *   - notes    筆記本體 / 標註 / 浮層 / 版本 / 反向連結 / 筆記 AI
 *   - categories / tags / comments  筆記分類 / 標籤庫 / 留言
 *   - tasks    任務群組 / 卡片 / 子任務 / 關聯 / 筆記-任務連結
 *   - home     首頁聚合 / 常用連結 / 快速捕捉
 *   - search / graph / links / calendar / askQueue / trash
 *   - compat   舊 API 相容層
 *
 * 後端基礎 URL: http://localhost:5009 (開發)
 * 回應格式: { success: boolean, data: T, error?: string, statusCode?: number }
 */

// client 僅對外曝露回應型別；fetchJson / apiBase / BROWSER_API_BASE 為內部共用，不外露。
export type { ApiResponse } from "./client";

export * from "./auth";
export * from "./categories";
export * from "./tags";
export * from "./notes";
export * from "./comments";
export * from "./tasks";
export * from "./home";
export * from "./expense";
export * from "./search";
export * from "./graph";
export * from "./links";
export * from "./calendar";
export * from "./askQueue";
export * from "./trash";
export * from "./compat";
