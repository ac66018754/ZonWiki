"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { VocabularyListView } from "./components/VocabularyListView";
import { ReviewView } from "./components/ReviewView";

/**
 * 單字庫頁（/others/vocabulary，設計書 §3.4）。
 *
 * 兩種模式：清單模式（CRUD＋搜尋/篩選/分頁）與複習模式（SRS 到期卡片流＋四鍵評分）。
 * 排程一律後端計算（DB-as-truth）；本頁只負責顯示與送出評分。
 */
type VocabularyMode = "list" | "review";

/**
 * 單字庫頁元件（模式切換殼）。
 */
export default function VocabularyPage() {
  const [mode, setMode] = useState<VocabularyMode>("list");

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
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>單字庫</h1>
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
              variant={mode === "review" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMode("review")}
              aria-pressed={mode === "review"}
            >
              複習
            </Button>
          </div>
        </div>

        {mode === "list" ? (
          <VocabularyListView />
        ) : (
          <ReviewView onExit={() => setMode("list")} />
        )}
      </div>
    </div>
  );
}
