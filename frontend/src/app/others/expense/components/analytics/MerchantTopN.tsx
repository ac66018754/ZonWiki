"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MerchantSlice } from "@/lib/expenseAnalytics";
import { formatCurrency } from "../../expenseUtils";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartColors } from "./useChartTheme";

/**
 * MerchantTopN 屬性。
 */
export interface MerchantTopNProps {
  /** 商家 Top N（後端已降冪）。 */
  merchants: MerchantSlice[];
  /** 已解析調色盤。 */
  colors: ChartColors;
}

/** 每筆商家 bar 的列高（px）。 */
const ROW_HEIGHT = 34;

/**
 * 商家 Top N（Recharts 橫向 BarChart，單一序列）。
 *
 * 單一度量（金額）＋商家為 nominal → 全部同一色（accent，非分類色票，避免用色相重編碼長度已表達的資訊）。
 * bar 端直接標金額。所有色皆解析自 token。
 * @param props merchants／colors。
 * @returns 商家圖卡片。
 */
export function MerchantTopN({ merchants, colors }: MerchantTopNProps) {
  const isEmpty = merchants.length === 0;
  const height = merchants.length * ROW_HEIGHT + 24;

  return (
    <ChartCard title="商家 Top N" isEmpty={isEmpty} emptyText="本月尚無具名商家消費">
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={merchants}
            margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="merchant"
              width={92}
              tick={{ fill: colors.axisText, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
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
            <Bar dataKey="total" radius={[0, 4, 4, 0]} isAnimationActive={false} fill={colors.accent}>
              {merchants.map((_, index) => (
                <Cell key={`merchant-${index}`} fill={colors.accent} />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                fill={colors.axisText}
                fontSize={12}
                formatter={(value) => formatCurrency(Number(value) || 0, "TWD")}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
