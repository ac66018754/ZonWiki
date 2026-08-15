"use client";

import type { TimeEntrySummaryCategory } from "@/lib/api";
import { formatDuration } from "@/lib/timeTracking/period";
import { type DonutSlice, VizDonut } from "./charts";
import { compactDuration, numericStyle, sectionTitleStyle } from "./shared";

/**
 * /time 儀表板的「依分類」區塊：甜甜圈（前 4 大分類＋其他）＋清單。
 *
 * 清單兼任甜甜圈的圖例與表格視圖（色點＋名稱＋數值）——這是 dataviz 色盤
 * 驗證的附帶義務：亮主題第 3/4 槽對表面對比 <3:1，必須有可見標籤/表格。
 * 顏色跟著「分類實體」：前 4 大各佔一個驗證過的色槽，其餘（含折入「其他」）為灰。
 */
export function CategorySection({
  byCategory,
  elapsedSinceFetch,
  totalSeconds,
}: {
  /** 依分類彙總（後端已依秒數遞減排序）。 */
  byCategory: TimeEntrySummaryCategory[];
  /** 距快照已過秒數（進行中分類的即時補算）。 */
  elapsedSinceFetch: number;
  /** 期間總秒數（甜甜圈中心顯示）。 */
  totalSeconds: number;
}) {
  /** 分類的即時秒數（含進行中補算）。 */
  const liveSecondsOf = (cat: TimeEntrySummaryCategory): number =>
    cat.seconds + cat.runningCount * elapsedSinceFetch;

  /** 甜甜圈：前 4 大分類各佔一個驗證過的色槽，其餘折入「其他」（灰）。 */
  const DONUT_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];
  const top = byCategory.slice(0, 4).map((cat, i) => ({
    label: cat.category,
    seconds: liveSecondsOf(cat),
    color: DONUT_COLORS[i],
  }));
  const restSeconds = byCategory
    .slice(4)
    .reduce((sum, cat) => sum + liveSecondsOf(cat), 0);
  const donutSlices: DonutSlice[] =
    restSeconds > 0
      ? [...top, { label: "其他", seconds: restSeconds, color: "var(--viz-other)" }]
      : top;

  /** 分類 → 圖表色（清單色點與比例條共用；前 4 大以外為灰）。 */
  const categoryColor = (name: string): string => {
    const index = byCategory.findIndex((c) => c.category === name);
    return index >= 0 && index < 4 ? DONUT_COLORS[index] : "var(--viz-other)";
  };

  const maxSeconds = Math.max(1, ...byCategory.map(liveSecondsOf));

  return (
    <section style={{ marginBottom: "var(--spacing-8)" }}>
      <h2 style={{ ...sectionTitleStyle, marginBottom: "var(--spacing-3)" }}>依分類</h2>
      {/* 甜甜圈＋清單：窄螢幕自動換行堆疊 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--spacing-4)",
        }}
      >
        <VizDonut slices={donutSlices} centerLabel={compactDuration(totalSeconds)} />
        <div
          style={{
            flex: 1,
            minWidth: 240,
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-3)",
          }}
        >
          {byCategory.map((cat) => {
            const seconds = liveSecondsOf(cat);
            const ratio = Math.min(1, seconds / maxSeconds);
            const color = categoryColor(cat.category);
            return (
              <div key={cat.category}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "var(--spacing-2)",
                    marginBottom: "var(--spacing-1)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {/* 色點＝甜甜圈圖例（顏色跟著分類實體） */}
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 9,
                        height: 9,
                        borderRadius: "var(--radius-full)",
                        background: color,
                        marginRight: 6,
                      }}
                    />
                    {cat.runningCount > 0 && (
                      <span
                        aria-label="進行中"
                        style={{ color: "var(--status-success-fg)" }}
                      >
                        ▶{" "}
                      </span>
                    )}
                    {cat.category}
                  </span>
                  <span
                    style={{
                      ...numericStyle,
                      fontSize: "var(--text-sm)",
                      color: "var(--text-secondary)",
                      flexShrink: 0,
                    }}
                  >
                    {formatDuration(seconds)}
                  </span>
                </div>
                {/* 比例條：以「最大分類」為 100%，呈現相對占比（與甜甜圈同色） */}
                <div
                  aria-hidden="true"
                  style={{
                    height: 8,
                    borderRadius: "var(--radius-full)",
                    background: "var(--bg-surface-secondary)",
                    border: "1px solid var(--border-default)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(2, Math.round(ratio * 100))}%`,
                      borderRadius: "var(--radius-full)",
                      background: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
