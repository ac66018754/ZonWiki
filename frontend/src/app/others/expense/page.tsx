"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { ExpenseListView } from "./components/ExpenseListView";
import { AnalyticsView } from "./components/AnalyticsView";

/**
 * 記帳頁模式：清單（CRUD＋記帳）／分析（圖表彙總）。
 */
type ExpenseMode = "list" | "analytics";

/**
 * 記帳頁（/others/expense，設計書 §5.5／§5.6）。
 *
 * 兩種模式（比照單字庫頁的清單/複習切換殼）：
 *   - 清單：AI/手動記帳 ＋ 待確認 ＋ 分頁清單（Phase 1 內容原樣）。
 *   - 分析：stat tile ＋ 近 N 月趨勢 ＋ 分類佔比環圈 ＋ 日曆熱圖 ＋ 商家 Top N（Phase 2）。
 * @returns 記帳頁（模式切換殼）。
 */
export default function ExpensePage() {
  const [mode, setMode] = useState<ExpenseMode>("list");

  return (
    <div style={{ width: "100%", overflowY: "auto" }}>
      <div
        style={{
          maxWidth: "var(--max-content-width)",
          margin: "0 auto",
          padding: "var(--spacing-6) var(--spacing-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-5)",
        }}
      >
        {/* 頁首：標題 + 模式切換 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--spacing-4)",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>記帳</h1>
          <div
            role="group"
            aria-label="模式切換"
            style={{ display: "flex", gap: "var(--spacing-2)" }}
          >
            <Button
              variant={mode === "list" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMode("list")}
              aria-pressed={mode === "list"}
            >
              清單
            </Button>
            <Button
              variant={mode === "analytics" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMode("analytics")}
              aria-pressed={mode === "analytics"}
            >
              分析
            </Button>
          </div>
        </div>

        {mode === "list" ? <ExpenseListView /> : <AnalyticsView />}
      </div>
    </div>
  );
}
