import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * vitest 設定：只收 src 下的 *.test.ts。
 *
 * 限定範圍的原因：frontend/scripts 下已有自帶執行器的手寫驗證腳本
 * （drawGeometry.spec.mjs、toc.spec.mjs，直接 node 執行、自印 pass/fail），
 * 不是 vitest 套件的測試檔——若讓 vitest 依預設樣式（*.spec.*）收進來，
 * 會被當成「沒有註冊任何測試」的失敗檔。兩者各走各的，互不干擾。
 *
 * resolve.alias：對齊 tsconfig 的 "@/*" → "./src/*" 路徑別名，
 * 讓受測模組（如 overlayAnchor.ts import "@/lib/textAnchor"）在 vitest 下也解析得到。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // .test.ts＝純函式測試；.test.tsx＝React 元件測試（Testing Library＋jsdom）。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
