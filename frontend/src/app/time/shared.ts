/**
 * /time 儀表板各區塊共用的樣式常數與小工具（純資料，無元件）。
 */

/** 區塊小標（全大寫間距感的小字）。 */
export const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "var(--text-secondary)",
  margin: 0,
};

/** 分類 chip（cap 寬度＋省略號：分類最長可到 128 字，不截斷會在 375px 撐出橫向捲軸）。 */
export const chipStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "var(--text-xs)",
  padding: "2px 8px",
  borderRadius: "var(--radius-full)",
  background: "var(--bg-surface-secondary)",
  border: "1px solid var(--border-default)",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  maxWidth: "10em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  verticalAlign: "bottom",
};

/** 卡片容器。 */
export const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--spacing-3) var(--spacing-4)",
};

/** 等寬數字（時長對齊用）。 */
export const numericStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
};

/** 緊湊時長（「1時23分」「45分」「30秒」；甜甜圈中心等窄空間用）。 */
export function compactDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時` : `${h}時${m}分`;
}
