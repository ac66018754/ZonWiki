import type { ReactElement } from "react";

/**
 * 「即將推出」佔位頁共用元件。
 *
 * 用於「其他」功能群中尚未進入開發的功能頁（單字庫＝Phase 2、英文教練＝Phase 3）：
 * 置中卡片、大 emoji、標題、階段徽章與功能預告清單。純展示、無互動，故為 server component。
 * 一律使用既有 CSS 變數 token，四主題自動適配（設計書 §11）。
 */
export interface ComingSoonProps {
  /** 功能圖示（emoji）。 */
  icon: string;
  /** 功能標題。 */
  title: string;
  /** 開發階段（2＝Phase 2、3＝Phase 3）。 */
  phase: number;
  /** 功能預告點（3-4 點）。 */
  previewPoints: string[];
}

/**
 * 佔位頁卡片。
 * @param props 圖示、標題、階段與預告清單。
 * @returns 置中的「即將推出」卡片。
 */
export function ComingSoon({
  icon,
  title,
  phase,
  previewPoints,
}: ComingSoonProps): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "var(--spacing-6) var(--spacing-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          textAlign: "center",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--spacing-8) var(--spacing-6)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div
          aria-hidden
          style={{ fontSize: "48px", lineHeight: 1, marginBottom: "var(--spacing-4)" }}
        >
          {icon}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-xl)",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h1>
        {/* 階段徽章：文字明示「開發中」，顏色非唯一資訊載體（§11 色盲友善）。 */}
        <div
          style={{
            display: "inline-block",
            marginTop: "var(--spacing-3)",
            padding: "var(--spacing-1) var(--spacing-3)",
            background: "var(--action-secondary-bg)",
            color: "var(--action-secondary-fg)",
            borderRadius: "var(--radius-full)",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
          }}
        >
          Phase {phase} 開發中
        </div>
        <p
          style={{
            margin: "var(--spacing-5) 0 var(--spacing-3)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          即將推出的功能預告：
        </p>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-2)",
          }}
        >
          {previewPoints.map((point) => (
            <li
              key={point}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--spacing-2)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}
            >
              <span aria-hidden style={{ color: "var(--action-secondary-fg)", flexShrink: 0 }}>
                ✦
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
