import { defineConfig } from "vitest/config";

/**
 * vitest 設定：只收 src 下的 *.test.ts。
 *
 * 限定範圍的原因：frontend/scripts 下已有自帶執行器的手寫驗證腳本
 * （drawGeometry.spec.mjs、toc.spec.mjs，直接 node 執行、自印 pass/fail），
 * 不是 vitest 套件的測試檔——若讓 vitest 依預設樣式（*.spec.*）收進來，
 * 會被當成「沒有註冊任何測試」的失敗檔。兩者各走各的，互不干擾。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
