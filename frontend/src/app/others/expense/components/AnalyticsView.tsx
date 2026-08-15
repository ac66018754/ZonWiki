"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { useCurrentUser, useExpenseAnalytics, useExpenseCategories } from "@/lib/swr";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import {
  drilldownRangeForDay,
  drilldownRangeForMonth,
  isCompletelyEmpty,
} from "@/lib/expenseAnalytics";
import { currentMonthInTimeZone } from "../expenseUtils";
import { MERCHANT_TOP_N, TREND_MONTHS } from "./analytics/chartPalette";
import { useChartTheme } from "./analytics/useChartTheme";
import { StatTile } from "./analytics/StatTile";
import { TrendBarChart } from "./analytics/TrendBarChart";
import { CategoryDonut, type CategoryDrillTarget } from "./analytics/CategoryDonut";
import { CalendarHeatmap } from "./analytics/CalendarHeatmap";
import { MerchantTopN } from "./analytics/MerchantTopN";
import { CategoryDrilldownPanel } from "./analytics/CategoryDrilldownPanel";

/**
 * 下鑽狀態：分類（月區間＋categoryId）或某日（日區間）。
 */
type DrillState =
  | { kind: "category"; categoryId: string; label: string }
  | { kind: "day"; date: string };

/**
 * 由 `YYYY-MM-DD` 取「M月D日」。
 * @param date 日期字串。
 * @returns 中文日標。
 */
function chineseDayLabel(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

/**
 * 分析視圖（協調者）：一次抓分析彙總，渲染 stat tile ＋ 四張圖 ＋ 下鑽面板。
 *
 * 四態：載入（含主題色未解析）／錯誤／not-ready 或完全為空／就緒。
 * 空狀態判定收嚴（審查 MEDIUM）：只有「完全無任何可呈現資料」才整頁空；本月零但有跨月歷史時仍渲染。
 * @returns 分析視圖。
 */
export function AnalyticsView() {
  const { data: userData } = useCurrentUser();
  const timeZone = userData?.timeZone || DEFAULT_TIMEZONE;
  const month = useMemo(() => currentMonthInTimeZone(timeZone), [timeZone]);

  const {
    data: analytics,
    error,
    isLoading,
    mutate: mutateAnalytics,
  } = useExpenseAnalytics(month, TREND_MONTHS, MERCHANT_TOP_N);
  const { data: categoriesData } = useExpenseCategories();
  const categories = categoriesData ?? [];
  const colors = useChartTheme();
  const { mutate: globalMutate } = useSWRConfig();

  const [drill, setDrill] = useState<DrillState | null>(null);

  /** 下鑽明細異動後：重抓分析＋清單＋統計（下鑽面板自身另會重抓）。 */
  const handleDrilldownChanged = () => {
    void mutateAnalytics();
    void globalMutate(
      (key) =>
        Array.isArray(key) && (key[0] === "expenses" || key[0] === "expense-stats"),
    );
  };

  const handleCategoryDrill = (target: CategoryDrillTarget) => {
    setDrill({ kind: "category", categoryId: target.categoryId, label: target.label });
  };

  const handleDayDrill = (date: string) => {
    setDrill({ kind: "day", date });
  };

  // ── 四態 ──────────────────────────────────────────────────────────────
  // 1. 載入中（SWR 載入，或主題色尚未於 client 解析）→ skeleton。
  if (isLoading || colors === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
        <div className="skeleton" style={{ height: 120, borderRadius: "var(--radius-lg)" }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "var(--spacing-4)",
          }}
        >
          <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-lg)" }} />
          <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-lg)" }} />
        </div>
      </div>
    );
  }

  // 2. 錯誤 → 友善框。
  if (error) {
    return (
      <div
        role="alert"
        style={{
          padding: "var(--spacing-4)",
          background: "var(--status-danger-bg)",
          color: "var(--status-danger-fg)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        無法載入分析資料，請稍後重試。
      </div>
    );
  }

  // 3. not-ready（端點未就緒回 null）或完全為空 → 置中友善空狀態。
  if (analytics === null || analytics === undefined || isCompletelyEmpty(analytics)) {
    return (
      <div
        style={{
          padding: "var(--spacing-12) var(--spacing-4)",
          textAlign: "center",
          color: "var(--text-secondary)",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-default)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <span style={{ fontSize: "var(--text-3xl)", display: "block", marginBottom: "var(--spacing-2)" }}>
          💡
        </span>
        <p style={{ margin: 0, fontWeight: 600, color: "var(--text-primary)" }}>本月尚無消費資料</p>
        <p style={{ margin: "var(--spacing-2) 0 0", fontSize: "var(--text-sm)" }}>
          開始記帳後，這裡會出現趨勢、分類、日曆與商家分析。
        </p>
      </div>
    );
  }

  // 4. 就緒 → 渲染 stat tile ＋ 四張圖 ＋ 下鑽面板。
  const drillProps =
    drill === null
      ? null
      : drill.kind === "category"
        ? {
            title: `${drill.label} 明細`,
            ...drilldownRangeForMonth(analytics.month),
            categoryId: drill.categoryId,
          }
        : {
            title: `${chineseDayLabel(drill.date)} 明細`,
            ...drilldownRangeForDay(drill.date),
            categoryId: null as string | null,
          };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
      <StatTile
        month={analytics.month}
        monthTotal={analytics.monthTotal}
        prevMonthTotal={analytics.prevMonthTotal}
        colors={colors}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "var(--spacing-4)",
          alignItems: "start",
        }}
      >
        <TrendBarChart trend={analytics.monthlyTrend} colors={colors} />
        <CategoryDonut
          categories={analytics.categoryBreakdown}
          monthTotal={analytics.monthTotal}
          colors={colors}
          onDrill={handleCategoryDrill}
        />
        <CalendarHeatmap month={analytics.month} daily={analytics.dailyTotals} onDrill={handleDayDrill} />
        <MerchantTopN merchants={analytics.merchantTopN} colors={colors} />
      </div>

      {drillProps && (
        <CategoryDrilldownPanel
          title={drillProps.title}
          from={drillProps.from}
          to={drillProps.to}
          categoryId={drillProps.categoryId}
          categories={categories}
          timeZone={timeZone}
          onClose={() => setDrill(null)}
          onChanged={handleDrilldownChanged}
        />
      )}
    </div>
  );
}
