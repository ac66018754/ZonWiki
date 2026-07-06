"use client";

import { useMemo, useState } from "react";
import {
  useCurrentUser,
  useExpenseCategories,
  useExpenses,
  useExpenseStats,
} from "@/lib/swr";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { SkeletonListItem } from "@/components/Skeleton";
import { Button } from "@/components/Button";
import { AiCaptureBox } from "./components/AiCaptureBox";
import { ManualExpenseForm } from "./components/ManualExpenseForm";
import { ExpenseRow, PendingExpenseRow } from "./components/ExpenseRow";
import { formatCurrency, currentMonthInTimeZone } from "./expenseUtils";

/** 清單每頁筆數。 */
const PAGE_SIZE = 20;

/**
 * 記帳頁（/others/expense，設計書 §5.5 Phase 1 範圍）。
 *
 * 版面（由上而下）：本月總額 stat tile → AI 一句話記帳 → 手動新增表單 →
 * 「待確認」置頂佇列 → 消費清單（分頁）。Phase 1 不引入圖表庫（Recharts 屬 Phase 2）。
 */
export default function ExpensePage() {
  const { data: userData } = useCurrentUser();
  const user = userData ?? null;
  const timeZone = user?.timeZone || DEFAULT_TIMEZONE;
  const currentMonth = useMemo(() => currentMonthInTimeZone(timeZone), [timeZone]);

  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data: categoriesData, mutate: mutateCategories } = useExpenseCategories();
  const categories = categoriesData ?? [];

  const {
    data: listData,
    error: listError,
    isLoading: listLoading,
    mutate: mutateExpenses,
  } = useExpenses(null, categoryFilter || null, page, PAGE_SIZE);
  const { data: statsData, mutate: mutateStats } = useExpenseStats(currentMonth);

  const items = listData?.items ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 待確認置頂佇列 vs 一般清單（設計書 §5.5：needsConfirmation 置頂）。
  // 註：Phase 1 由「目前頁」資料衍生（待確認多為剛以 AI 記入的近期項目，通常落在第 1 頁）。
  const pendingItems = items.filter((expense) => expense.needsConfirmation);
  const normalItems = items.filter((expense) => !expense.needsConfirmation);

  /** 任一異動後重抓清單與統計。 */
  const handleChanged = () => {
    void mutateExpenses();
    void mutateStats();
  };

  /** 分類異動後重抓分類清單（並讓下拉刷新）。 */
  const handleCategoriesChanged = () => {
    void mutateCategories();
  };

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
        {/* 頁首：標題 + 本月總額 stat tile */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "var(--spacing-4)",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>記帳</h1>
          <div
            style={{
              textAlign: "right",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--spacing-3) var(--spacing-4)",
              minWidth: "160px",
            }}
          >
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
              本月總額（{currentMonth}）
            </div>
            <div
              style={{
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {/* 後端 ExpenseStatsDto 無幣別欄，統一以 TWD 格式化。 */}
              {statsData ? formatCurrency(statsData.total, "TWD") : "—"}
            </div>
            {/* 後端 stats 以 UTC 月界分桶（Phase 1 取捨）：月初 8 小時內（UTC+8）的帳可能落到上月桶，
                先用說明對齊使用者預期，避免誤會金額少算。 */}
            <div
              style={{
                marginTop: "var(--spacing-1)",
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              以 UTC 月界統計
            </div>
          </div>
        </div>

        {/* AI 一句話記帳 */}
        <AiCaptureBox user={user} onChanged={handleChanged} />

        {/* 手動新增 */}
        <ManualExpenseForm
          user={user}
          categories={categories}
          onCreated={handleChanged}
          onCategoriesChanged={handleCategoriesChanged}
        />

        {/* 待確認置頂佇列 */}
        {pendingItems.length > 0 && (
          <section aria-label="待確認">
            <h2
              style={{
                margin: "0 0 var(--spacing-2)",
                fontSize: "var(--text-base)",
                fontWeight: 700,
                color: "var(--status-warning-fg)",
              }}
            >
              待確認（{pendingItems.length}）
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              {pendingItems.map((expense) => (
                <PendingExpenseRow
                  key={expense.id}
                  expense={expense}
                  categories={categories}
                  timeZone={timeZone}
                  onChanged={handleChanged}
                />
              ))}
            </div>
          </section>
        )}

        {/* 消費清單（分頁） */}
        <section aria-label="消費清單">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--spacing-3)",
              marginBottom: "var(--spacing-2)",
              flexWrap: "wrap",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "var(--text-base)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              消費清單
            </h2>
            {/* 分類篩選 */}
            <select
              className="input"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              aria-label="依分類篩選"
              style={{ width: "auto" }}
            >
              <option value="">全部分類</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                </option>
              ))}
            </select>
          </div>

          {listError ? (
            <div
              role="alert"
              style={{
                padding: "var(--spacing-4)",
                background: "var(--status-danger-bg)",
                color: "var(--status-danger-fg)",
                borderRadius: "var(--radius-lg)",
              }}
            >
              無法載入消費清單，請稍後重試。
            </div>
          ) : listLoading && items.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              <SkeletonListItem />
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          ) : normalItems.length === 0 && pendingItems.length === 0 ? (
            <div
              style={{
                padding: "var(--spacing-8)",
                textAlign: "center",
                color: "var(--text-secondary)",
                background: "var(--bg-surface)",
                borderRadius: "var(--radius-lg)",
                border: "1px dashed var(--border-default)",
              }}
            >
              <span style={{ fontSize: "var(--text-2xl)", display: "block", marginBottom: "var(--spacing-2)" }}>
                💰
              </span>
              <p style={{ margin: 0, fontWeight: 500 }}>本月尚無紀錄</p>
              <p style={{ margin: "var(--spacing-2) 0 0", fontSize: "var(--text-sm)" }}>
                用上方「一句話記帳」或「手動新增」開始記帳。
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
              {normalItems.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  categories={categories}
                  timeZone={timeZone}
                  onChanged={handleChanged}
                />
              ))}
            </div>
          )}

          {/* 分頁控制 */}
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--spacing-3)",
                marginTop: "var(--spacing-4)",
              }}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← 上一頁
              </Button>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                第 {page} / {totalPages} 頁
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一頁 →
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
