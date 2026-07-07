"use client";

import type { ChartColors } from "./useChartTheme";

/**
 * Recharts 注入的單筆 tooltip payload（跨版本形狀寬鬆化，避免綁死型別）。
 */
interface TooltipPayloadItem {
  /** 數值（度量）。 */
  value?: number | string;
  /** 系列/資料名稱。 */
  name?: string | number;
  /** 原始資料物件。 */
  payload?: unknown;
}

/**
 * 共用自訂 tooltip 屬性。
 */
export interface ChartTooltipProps {
  /** 已解析調色盤（主題感知）。 */
  colors: ChartColors;
  /** Recharts 注入：是否作用中。 */
  active?: boolean;
  /** Recharts 注入：payload 陣列。 */
  payload?: TooltipPayloadItem[];
  /** Recharts 注入：X 軸 label（趨勢圖為月標）。 */
  label?: string | number;
  /** 標題文字產生器（優先於 label／payload[0].name）。 */
  titleFor?: (item: TooltipPayloadItem | undefined, label: string | number | undefined) => string;
  /** 數值格式化（預設原樣）。 */
  formatValue?: (value: number) => string;
}

/**
 * 主題感知的共用 tooltip——底色/框/文字全走解析後的 token，**杜絕 Recharts 預設白底在暗主題失敗**。
 * @param props colors ＋ Recharts 注入的 active/payload/label ＋ 格式化器。
 * @returns tooltip 節點；非作用中或無資料回 null。
 */
export function ChartTooltip({
  colors,
  active,
  payload,
  label,
  titleFor,
  formatValue,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const first = payload[0];
  const title = titleFor
    ? titleFor(first, label)
    : String(label ?? first?.name ?? "");
  const rawValue = first?.value;
  const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
  const valueText =
    formatValue && Number.isFinite(numericValue)
      ? formatValue(numericValue)
      : String(rawValue ?? "");

  return (
    <div
      role="tooltip"
      style={{
        background: colors.tooltipBg,
        border: `1px solid ${colors.tooltipBorder}`,
        color: colors.text,
        borderRadius: "var(--radius-md)",
        padding: "var(--spacing-2) var(--spacing-3)",
        boxShadow: "var(--shadow-md)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.5,
      }}
    >
      {title && (
        <div style={{ color: colors.axisText, marginBottom: 2 }}>{title}</div>
      )}
      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{valueText}</div>
    </div>
  );
}
