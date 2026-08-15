"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMonthShort, type TrendPoint } from "@/lib/expenseAnalytics";
import { formatCurrency } from "../../expenseUtils";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartColors } from "./useChartTheme";

/**
 * TrendBarChart 屬性。
 */
export interface TrendBarChartProps {
  /** 月趨勢（由舊到新，含本月）。 */
  trend: TrendPoint[];
  /** 已解析調色盤。 */
  colors: ChartColors;
}

/**
 * 千位縮寫（軸刻度用）：1200 → "1.2k"、800 → "800"。
 * @param value 金額。
 * @returns 縮寫字串。
 */
function abbreviateAmount(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return String(value);
}

/**
 * 近 N 月趨勢柱狀圖（Recharts BarChart，單一序列）。
 *
 * 單一度量（每月總額）→ 全部同一色（accent，非分類色票）；**本月**全 opacity、過去月 opacity 後退
 *（明度後退＝次要，非用色相編碼身分）。所有色皆解析自 token。
 * 過去月 opacity 下限 0.75（審查 MEDIUM／§11）：柱本身即資料載體且無逐柱數值標籤，
 * 0.75 讓過去月柱 vs 卡面在四主題皆 ≥3:1（WCAG 1.4.11 非文字對比；實算 warmpaper 3.78／light 3.21 最低）。
 * @param props trend／colors。
 * @returns 趨勢圖卡片。
 */
export function TrendBarChart({ trend, colors }: TrendBarChartProps) {
  const lastIndex = trend.length - 1;
  const data = trend.map((point, index) => ({
    label: formatMonthShort(point.month),
    total: point.total,
    isCurrent: index === lastIndex,
  }));
  const isEmpty = trend.every((point) => point.total === 0);
  // 標題反映實際回傳月數（後端 `Expense:AnalyticsTrendMonths` 可調），不寫死。
  const title = trend.length > 0 ? `近 ${trend.length} 月趨勢` : "近月趨勢";

  return (
    <ChartCard title={title} isEmpty={isEmpty} emptyText="近幾個月尚無消費">
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: colors.axisText, fontSize: 12 }}
              axisLine={{ stroke: colors.axis }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: colors.axisText, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={abbreviateAmount}
            />
            <Tooltip
              cursor={{ fill: colors.grid, fillOpacity: 0.25 }}
              content={
                <ChartTooltip
                  colors={colors}
                  formatValue={(value) => formatCurrency(value, "TWD")}
                />
              }
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((entry, index) => (
                <Cell
                  key={`bar-${index}`}
                  fill={colors.accent}
                  fillOpacity={entry.isCurrent ? 1 : 0.75}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
