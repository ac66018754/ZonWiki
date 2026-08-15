"use client";

import {
  buildCalendarGrid,
  bucketFor,
  quantileThresholds,
  type DailyPoint,
  type DayCell,
} from "@/lib/expenseAnalytics";
import { HEATMAP_BUCKETS, HEATMAP_OPACITY_LADDER } from "./chartPalette";
import { formatCurrency } from "../../expenseUtils";
import { ChartCard } from "./ChartCard";

/** 週標題（週日起，對齊 UTC getUTCDay 0=週日）。 */
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * CalendarHeatmap 屬性。
 */
export interface CalendarHeatmapProps {
  /** 分析月份 `YYYY-MM`。 */
  month: string;
  /** 每日總額（UTC 日）。 */
  daily: DailyPoint[];
  /** 點某日 → 下鑽當日明細。 */
  onDrill: (date: string) => void;
}

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
 * 日曆熱圖（Tailwind/CSS grid 手刻；Recharts 無此圖）。
 *
 * 深淺為**單一色相＋明度**（base=`--action-primary-bg` ＋ opacity 階梯，token 衍生、四主題自動跟隨、
 * 天生 CVD 安全）；**所有日格一律同款外框**（審查 MEDIUM：修顯著性反轉——過去是「空日有實框、消費日
 * 無框」讓最低消費日看起來比無消費日還空；現在每格都有 border，綠色填充當唯一差異載體），
 * 桶 0（無消費）僅 `--bg-surface-secondary`（最平），非零桶再疊綠 → 任何消費日一律 ≥ 無消費日。
 * **色非唯一載體**：每格 `aria-label`＋原生 tooltip 給金額，下方離散 legend「少→多」。
 * 一律用 **UTC 日**分桶（與 stats/月總額一致）。
 * @param props month／daily／onDrill。
 * @returns 熱圖卡片。
 */
export function CalendarHeatmap({ month, daily, onDrill }: CalendarHeatmapProps) {
  const grid = buildCalendarGrid(month, daily);
  const thresholds = quantileThresholds(
    daily.map((point) => point.total),
    HEATMAP_BUCKETS,
  );
  const isEmpty = daily.every((point) => point.total === 0) || daily.length === 0;
  const cells: DayCell[] = grid.weeks.flat();

  /** 某桶的填色樣式（桶 0 特殊處理）。 */
  const renderCell = (cell: DayCell, index: number) => {
    if (cell.date === null) {
      // padding 格（非本月）：佔位、不可互動。
      return <div key={`pad-${index}`} aria-hidden="true" style={{ aspectRatio: "1", minWidth: 0 }} />;
    }
    const bucket = bucketFor(cell.total, thresholds);
    const hasSpend = cell.total > 0;
    const amountWithCount = `${formatCurrency(cell.total, "TWD")}（${cell.count} 筆）`;
    const label = hasSpend
      ? `${chineseDayLabel(cell.date)}：${amountWithCount}，點擊查看當日明細`
      : `${chineseDayLabel(cell.date)}：無消費`;
    return (
      <button
        key={cell.date}
        type="button"
        onClick={() => onDrill(cell.date as string)}
        title={hasSpend ? amountWithCount : "無消費"}
        aria-label={label}
        style={{
          position: "relative",
          aspectRatio: "1",
          minWidth: 0,
          padding: 0,
          borderRadius: "var(--radius-sm)",
          // 所有日格一律同款外框（審查 MEDIUM：修顯著性反轉，不再只有空日有框、消費日無框）。
          border: "1px solid var(--border-default)",
          background: bucket === 0 ? "var(--bg-surface-secondary)" : "transparent",
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {bucket > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              // 深淺 token 衍生：主題感知綠 ＋ 依桶 opacity（單一色相＋明度＝CVD 安全）。
              background: "var(--action-primary-bg)",
              opacity: HEATMAP_OPACITY_LADDER[bucket - 1],
              borderRadius: "inherit",
            }}
          />
        )}
      </button>
    );
  };

  return (
    <ChartCard title="每日消費熱圖" isEmpty={isEmpty} emptyText="本月尚無每日消費">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
        {/* 週標題列 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {WEEKDAY_LABELS.map((weekday) => (
            <div
              key={weekday}
              style={{
                textAlign: "center",
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              {weekday}
            </div>
          ))}
        </div>
        {/* 日格網格 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {cells.map(renderCell)}
        </div>
        {/* 離散 legend：少 → 多 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--spacing-1)",
            justifyContent: "flex-end",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>少</span>
          {HEATMAP_OPACITY_LADDER.map((opacity, index) => (
            <span
              key={`legend-${index}`}
              aria-hidden="true"
              style={{
                position: "relative",
                width: 12,
                height: 12,
                borderRadius: 3,
                overflow: "hidden",
                border: "1px solid var(--border-default)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--action-primary-bg)",
                  opacity,
                }}
              />
            </span>
          ))}
          <span>多</span>
        </div>
      </div>
    </ChartCard>
  );
}
