"use client";

import type { CSSProperties } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  foldCategories,
  type CategorySlice,
} from "@/lib/expenseAnalytics";
import { CATEGORY_MAX_SLOTS } from "./chartPalette";
import { formatCurrency } from "../../expenseUtils";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartColors } from "./useChartTheme";

/**
 * 分類佔比環圈點擊下鑽的回呼參數。
 */
export interface CategoryDrillTarget {
  /** 分類 Id（真實分類才可下鑽）。 */
  categoryId: string;
  /** 顯示標題（分類名）。 */
  label: string;
}

/**
 * CategoryDonut 屬性。
 */
export interface CategoryDonutProps {
  /** 分類佔比切片（後端已降冪）。 */
  categories: CategorySlice[];
  /** 本月總額（環圈中央顯示）。 */
  monthTotal: number;
  /** 已解析調色盤。 */
  colors: ChartColors;
  /** 點擊某（真實）分類 → 下鑽。 */
  onDrill: (target: CategoryDrillTarget) => void;
}

/**
 * 分類佔比環圈（Recharts PieChart donut ＋ 下鑽）。
 *
 * 識別**靠 legend（一律在場）＋ icon ＋ 文字，不靠色**（色盲友善）；色塊只是輔助。
 * 顏色取自四主題分類色陣列（非 Recharts 預設）。折疊「其他」與「未分類」無法用清單端點精準下鑽 →
 * 該列為非互動（其餘真實分類可點下鑽）。
 * @param props categories／monthTotal／colors／onDrill。
 * @returns 環圈圖卡片。
 */
export function CategoryDonut({
  categories,
  monthTotal,
  colors,
  onDrill,
}: CategoryDonutProps) {
  const folded = foldCategories(categories, CATEGORY_MAX_SLOTS);
  const sliceTotal = folded.reduce((sum, slice) => sum + slice.total, 0);
  const isEmpty = folded.length === 0 || sliceTotal === 0;

  /** 判斷某片是否可下鑽（僅真實分類）。 */
  const canDrill = (slice: CategorySlice): boolean =>
    typeof slice.categoryId === "string" && slice.isAggregate !== true;

  /** 點片/legend 列 → 下鑽（可下鑽時）。slice 可能為 undefined（見扇形 onClick 的索引防護）。 */
  const handleDrill = (slice: CategorySlice | undefined) => {
    if (slice && canDrill(slice)) {
      onDrill({ categoryId: slice.categoryId as string, label: slice.name ?? "未分類" });
    }
  };

  /** 某片顯示名（未分類 → 「未分類」）。 */
  const displayName = (slice: CategorySlice): string => slice.name ?? "未分類";

  /** 某片百分比字串。 */
  const percentText = (slice: CategorySlice): string =>
    sliceTotal > 0 ? `${Math.round((slice.total / sliceTotal) * 100)}%` : "0%";

  return (
    <ChartCard title="分類佔比" isEmpty={isEmpty} emptyText="本月尚無分類消費">
      <div style={{ position: "relative", width: "100%", height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={folded}
              dataKey="total"
              nameKey="name"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={2}
              stroke={colors.surface}
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(_, index) =>
                // recharts@3 注入的 index 型別不保證；越界／非數字時 folded[index]＝undefined，
                // handleDrill 已對 undefined 早退，避免讀 slice.categoryId 拋 TypeError 讓整頁崩（審查 LOW）。
                handleDrill(typeof index === "number" ? folded[index] : undefined)
              }
            >
              {folded.map((slice, index) => (
                <Cell
                  key={`slice-${index}`}
                  fill={colors.categorical[index % colors.categorical.length]}
                  style={{ cursor: canDrill(slice) ? "pointer" : "default", outline: "none" }}
                />
              ))}
            </Pie>
            <Tooltip
              content={
                <ChartTooltip
                  colors={colors}
                  formatValue={(value) => formatCurrency(value, "TWD")}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {/* 環圈中央：本月總額 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>本月</div>
          <div
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 700,
              color: "var(--text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatCurrency(monthTotal, "TWD")}
          </div>
        </div>
      </div>

      {/* Legend：色塊＋icon＋名＋金額＋%（主載體是 icon＋文字，色盲友善） */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
        {folded.map((slice, index) => {
          const drillable = canDrill(slice);
          const rowContent = (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  flexShrink: 0,
                  background: colors.categorical[index % colors.categorical.length],
                }}
              />
              {slice.icon && <span aria-hidden="true">{slice.icon}</span>}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName(slice)}
              </span>
              <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(slice.total, "TWD")}
              </span>
              <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
                {percentText(slice)}
              </span>
            </>
          );
          const rowStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-2)",
            width: "100%",
            padding: "4px 6px",
            border: "none",
            background: "transparent",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            color: "var(--text-primary)",
            textAlign: "left",
          };
          return (
            <li key={`legend-${index}`}>
              {drillable ? (
                <button
                  type="button"
                  onClick={() => handleDrill(slice)}
                  style={{ ...rowStyle, cursor: "pointer" }}
                  aria-label={`${displayName(slice)} ${formatCurrency(slice.total, "TWD")}，佔 ${percentText(slice)}，點擊查看明細`}
                >
                  {rowContent}
                </button>
              ) : (
                <div
                  style={rowStyle}
                  title="未分類／彙總無法下鑽明細"
                  aria-label={`${displayName(slice)} ${formatCurrency(slice.total, "TWD")}，佔 ${percentText(slice)}`}
                >
                  {rowContent}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
