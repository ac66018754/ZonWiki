"use client";

import { memo, useMemo, useState, type ReactElement } from "react";
import type { CoachCorrection } from "@/lib/api/coach";
import { diffWords } from "../lib/wordDiff";
import { useThemeColors } from "../lib/useThemeColors";

/** 需即時解析的 diff 顏色 token（禁硬編色票）。 */
const DIFF_COLOR_VARS = ["--status-danger-fg", "--status-success-fg"] as const;

/**
 * 糾錯卡（計畫 §7，四主題 WCAG AA）。
 *
 * 設計要點：
 *  - 逐字 diff，**雙載體**（顏色＋形狀＋圖示，色盲友善）：
 *      刪除處 `--status-danger-fg` ＋ `line-through` ＋ ✗；
 *      修正處 `--status-success-fg` ＋ `underline` ＋ ✓。
 *  - diff **render 在中性 surface（--bg-surface-secondary）**，非染色氣泡——
 *    fg 色的 WCAG 只在中性 -bg 上驗過（四主題 ≥4.5:1，見交付說明）。
 *  - 顏色以 getComputedStyle 解析 CSS 變數＋MutationObserver 監 data-theme（useThemeColors），
 *    首渲染以 var() 後備；主題切換即時重上色。
 *  - 三明治三層可摺疊：diff（永遠可見）／中文說明／更道地講法。
 */
function CorrectionCardInner({
  correction,
}: {
  correction: CoachCorrection;
}): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const colors = useThemeColors(DIFF_COLOR_VARS);
  const dangerFg = colors?.["--status-danger-fg"] ?? "var(--status-danger-fg)";
  const successFg = colors?.["--status-success-fg"] ?? "var(--status-success-fg)";

  const segments = useMemo(
    () => diffWords(correction.original, correction.corrected),
    [correction.original, correction.corrected],
  );

  const hasDetails = Boolean(correction.explanationZh || correction.betterVersion);

  return (
    <section
      className="coach-correction"
      aria-label="文法糾錯卡"
      style={{
        border: "1px solid var(--border-default)",
        borderLeft: "3px solid var(--status-danger-fg)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-surface)",
        padding: "var(--spacing-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-2)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
        <span aria-hidden style={{ fontSize: "var(--text-base)" }}>
          📝
        </span>
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          糾錯
        </span>
      </header>

      {/* Layer 1：逐字 diff（中性 surface，非染色氣泡）。 */}
      <div
        className="coach-correction__diff"
        style={{
          background: "var(--bg-surface-secondary)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--spacing-2) var(--spacing-3)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.8,
          color: "var(--text-primary)",
          wordBreak: "break-word",
        }}
      >
        {segments.map((seg, index) => {
          if (seg.type === "equal") {
            return <span key={index}>{seg.text} </span>;
          }
          if (seg.type === "removed") {
            return (
              <span
                key={index}
                style={{
                  color: dangerFg,
                  textDecoration: "line-through",
                  fontWeight: 600,
                }}
              >
                <span className="coach-sr-only">刪除：</span>
                <span aria-hidden>✗</span>
                {seg.text}{" "}
              </span>
            );
          }
          // added
          return (
            <span
              key={index}
              style={{
                color: successFg,
                textDecoration: "underline",
                fontWeight: 600,
              }}
            >
              <span className="coach-sr-only">修正：</span>
              <span aria-hidden>✓</span>
              {seg.text}{" "}
            </span>
          );
        })}
      </div>

      {/* 摺疊控制（有說明才顯示）。 */}
      {hasDetails && (
        <button
          type="button"
          className="coach-correction__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            padding: "var(--spacing-1) 0",
            color: "var(--action-secondary-fg)",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {expanded ? "收合說明 ▲" : "展開說明 ▼"}
        </button>
      )}

      {/* Layer 2 / 3：中文說明與更道地講法。 */}
      {hasDetails && expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
          {correction.explanationZh && (
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                lineHeight: 1.7,
                color: "var(--text-secondary)",
              }}
            >
              {correction.explanationZh}
            </p>
          )}
          {correction.betterVersion && (
            <div
              style={{
                background: "var(--bg-surface-secondary)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--spacing-2) var(--spacing-3)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.7,
                color: "var(--text-primary)",
              }}
            >
              <span
                aria-hidden
                style={{ marginRight: "var(--spacing-2)", color: "var(--action-secondary-fg)" }}
              >
                ✨
              </span>
              <span className="coach-sr-only">更道地的講法：</span>
              {correction.betterVersion}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 糾錯卡（memo 包裝）：correction 物件穩定時，父層 40Hz 音量重繪不會重繪本卡（審修 M2）。
 */
export const CorrectionCard = memo(CorrectionCardInner);
