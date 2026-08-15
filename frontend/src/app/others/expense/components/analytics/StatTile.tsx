"use client";

import { computeDelta, formatDeltaText } from "@/lib/expenseAnalytics";
import { formatCurrency } from "../../expenseUtils";
import type { ChartColors } from "./useChartTheme";

/**
 * StatTile 屬性。
 */
export interface StatTileProps {
  /** 分析月份 `YYYY-MM`。 */
  month: string;
  /** 本月總額。 */
  monthTotal: number;
  /** 上月總額。 */
  prevMonthTotal: number;
  /** 已解析調色盤（漲跌色）。 */
  colors: ChartColors;
}

/**
 * 本月總額＋與上月比（分析頁置頂）。
 *
 * 漲跌用**三載體**（§11 色盲友善，非顏色唯一）：顏色（danger/success/secondary）＋箭頭（▲▼—）＋文字。
 * `aria-label` 含方向詞，不倚賴顏色。上月為 0 時只顯示金額差、不顯示百分比。
 * @param props month／monthTotal／prevMonthTotal／colors。
 * @returns StatTile 卡片。
 */
export function StatTile({ month, monthTotal, prevMonthTotal, colors }: StatTileProps) {
  const formatMoney = (amount: number) => formatCurrency(amount, "TWD");
  const delta = computeDelta(monthTotal, prevMonthTotal);
  const deltaText = formatDeltaText(delta, formatMoney);

  const deltaColor =
    delta.direction === "up"
      ? colors.up
      : delta.direction === "down"
        ? colors.down
        : colors.flat;
  const arrow = delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—";

  return (
    <div
      className="card"
      role="group"
      aria-label={`本月總額 ${formatMoney(monthTotal)}，${deltaText}`}
      style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}
    >
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
        本月總額（{month}）
      </div>
      <div
        style={{
          fontSize: "clamp(var(--text-2xl), 1.4rem + 2vw, var(--text-3xl))",
          fontWeight: 700,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {formatMoney(monthTotal)}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-1)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: deltaColor,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "var(--text-xs)" }}>
          {arrow}
        </span>
        <span>{deltaText}</span>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
        以 UTC 月界統計
      </div>
    </div>
  );
}
