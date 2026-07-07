"use client";

import { useExpenseDrilldown } from "@/lib/swr";
import type { ExpenseCategory } from "@/lib/api";
import { SkeletonListItem } from "@/components/Skeleton";
import { Button } from "@/components/Button";
import { ExpenseRow } from "../ExpenseRow";

/**
 * CategoryDrilldownPanel 屬性。
 */
export interface CategoryDrilldownPanelProps {
  /** 標題（分類名／日期 明細）。 */
  title: string;
  /** 下鑽區間起（含）ISO。 */
  from: string;
  /** 下鑽區間迄（含）ISO。 */
  to: string;
  /** 分類篩選（分類下鑽時有值；日下鑽為 null）。 */
  categoryId?: string | null;
  /** 分類清單（供 ExpenseRow 就地編輯）。 */
  categories: ExpenseCategory[];
  /** 使用者時區。 */
  timeZone: string;
  /** 關閉面板。 */
  onClose: () => void;
  /** 明細異動後通知父層（重抓分析／清單／統計）。 */
  onChanged: () => void;
}

/**
 * 下鑽明細面板（inline 展開，重用既有清單端點與 `ExpenseRow`）。
 *
 * 分類下鑽用 `from/to/categoryId`；日下鑽用 `from/to`。逐筆用 `ExpenseRow` → 可直接編輯/刪除，
 * 異動後同時重抓「本面板」與「上層分析/清單/統計」。載入/空/錯誤三態。
 * @param props title／from／to／categoryId／categories／timeZone／onClose／onChanged。
 * @returns 下鑽面板。
 */
export function CategoryDrilldownPanel({
  title,
  from,
  to,
  categoryId,
  categories,
  timeZone,
  onClose,
  onChanged,
}: CategoryDrilldownPanelProps) {
  const { data, error, isLoading, mutate } = useExpenseDrilldown(from, to, categoryId);
  const items = data?.items ?? [];
  // 下鑽重用清單端點、固定抓 200 筆（見 useExpenseDrilldown）；總數更多時提示被截斷，避免使用者
  // 以為明細已全（審查 LOW：個人記帳單月單分類破 200 罕見，故僅提示不加分頁）。
  const total = data?.total ?? items.length;
  const isTruncated = total > items.length;

  /** 明細內編輯/刪除後：重抓本面板 ＋ 通知父層。 */
  const handleChanged = () => {
    void mutate();
    onChanged();
  };

  return (
    <section
      aria-label={title}
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--spacing-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--spacing-3)" }}>
        <h3 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)" }}>
          {title}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="關閉明細">
          關閉 ✕
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            padding: "var(--spacing-3)",
            background: "var(--status-danger-bg)",
            color: "var(--status-danger-fg)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
          }}
        >
          無法載入明細，請稍後重試。
        </div>
      ) : isLoading && items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: "var(--spacing-4)", textAlign: "center", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
          此區間尚無明細。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
          {items.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              categories={categories}
              timeZone={timeZone}
              onChanged={handleChanged}
            />
          ))}
          {isTruncated && (
            <p
              style={{
                margin: 0,
                textAlign: "center",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-xs)",
              }}
            >
              共 {total} 筆，僅顯示前 {items.length} 筆。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
