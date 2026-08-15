"use client";

import type { ReactElement } from "react";
import type { CoachState } from "@/lib/api/coach";

/** 各狀態的呈現（圖示＋標籤＋token 色；顏色非唯一載體）。 */
const STATE_PRESENTATION: Record<
  CoachState,
  { icon: string; label: string; colorVar: string; pulse: boolean }
> = {
  connecting: { icon: "🔌", label: "連線中…", colorVar: "--text-secondary", pulse: true },
  listening: { icon: "🎧", label: "聆聽中", colorVar: "--action-secondary-fg", pulse: true },
  thinking: { icon: "💭", label: "思考中…", colorVar: "--text-secondary", pulse: true },
  speaking: { icon: "🗣️", label: "教練說話中", colorVar: "--status-success-fg", pulse: true },
  reconnecting: { icon: "🔄", label: "重新連線中…", colorVar: "--status-warning-fg", pulse: true },
  ended: { icon: "✅", label: "對話已結束", colorVar: "--text-secondary", pulse: false },
  fatal: { icon: "⚠️", label: "連線已中止", colorVar: "--status-danger-fg", pulse: false },
};

/**
 * 狀態指示器（計畫 §7 審修-F7）。
 *  - listening / thinking / speaking 三態脈動；每態有專屬圖示＋文字（色盲友善，非只靠顏色）。
 *  - listening 時外環大小隨麥克風音量回饋。
 *  - 無可靠 thinking 訊號時，狀態機自然只在 listening/speaking 間切換（不留未定義中間態）。
 *
 * @param state 目前狀態。
 * @param micVolume 麥克風音量（0..1）。
 */
export function StateIndicator({
  state,
  micVolume,
}: {
  state: CoachState;
  micVolume: number;
}): ReactElement {
  const p = STATE_PRESENTATION[state];
  // 聆聽時外環隨音量放大（1.0 ~ 1.6）；其餘態固定。
  const volumeScale = state === "listening" ? 1 + Math.min(1, micVolume * 4) * 0.6 : 1;

  return (
    <div
      className="coach-state"
      role="status"
      aria-live="polite"
      aria-label={p.label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--spacing-2)",
      }}
    >
      <div style={{ position: "relative", width: 96, height: 96 }}>
        {/* 音量/脈動外環。 */}
        <span
          aria-hidden
          className={p.pulse ? "coach-state__ring coach-state__ring--pulse" : "coach-state__ring"}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "var(--radius-full)",
            border: `2px solid var(${p.colorVar})`,
            transform: `scale(${volumeScale})`,
            transition: "transform 0.12s ease-out",
            opacity: 0.5,
          }}
        />
        {/* 核心圓。 */}
        <div
          style={{
            position: "absolute",
            inset: 12,
            borderRadius: "var(--radius-full)",
            background: "var(--bg-surface)",
            border: `2px solid var(${p.colorVar})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "32px",
            lineHeight: 1,
          }}
        >
          <span aria-hidden>{p.icon}</span>
        </div>
      </div>
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: `var(${p.colorVar})`,
        }}
      >
        {p.label}
      </span>
    </div>
  );
}
