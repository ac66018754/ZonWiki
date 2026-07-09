"use client";

import type React from "react";

/**
 * 共用的「首頁釘選 ｜ 長期任務（＋粗粒度目標期）」欄位群組。
 *
 * 由完整任務編輯器（TaskEditorModal）與快速新增（QuickCreateTaskModal）共用，
 * 讓「首頁的＋待辦」也能設定釘選到首頁與長期任務（需求 #6），避免兩處各寫一份走樣。
 *
 * 純受控元件：值與變更回呼皆由父層傳入；父層可在各 onChange 內自行處理「標記為已修改」等額外邏輯。
 */
export function TaskScheduleFields({
  isPinnedToHome,
  onPinnedChange,
  isLongTerm,
  onLongTermChange,
  targetGranularity,
  onGranularityChange,
  targetIso,
  onTargetIsoChange,
}: {
  /** 是否釘選到首頁。 */
  isPinnedToHome: boolean;
  onPinnedChange: (value: boolean) => void;
  /** 是否為長期任務。 */
  isLongTerm: boolean;
  onLongTermChange: (value: boolean) => void;
  /** 目標期粒度："" / "month" / "quarter" / "year"。 */
  targetGranularity: string;
  onGranularityChange: (value: string) => void;
  /** 目標期代表日（UTC ISO；可為 null）。 */
  targetIso: string | null;
  onTargetIsoChange: (value: string | null) => void;
}) {
  // 目標期選單/輸入框的共用樣式。
  const ctlStyle: React.CSSProperties = {
    padding: "4px 6px", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: "var(--text-sm)",
  };

  // 把代表日（UTC）拆成 年/月(1-12)/季(1-4)；無代表日時用今年/本月當預設。
  const targetParts = (() => {
    const d = targetIso ? new Date(targetIso) : new Date();
    const m = d.getUTCMonth() + 1;
    return { year: d.getUTCFullYear(), month: m, quarter: Math.floor((m - 1) / 3) + 1 };
  })();

  /** 依粒度與年 + 月/季組出代表日（該期起始日 UTC）並回寫。 */
  const setTargetFromParts = (g: string, year: number, monthOrQuarter: number) => {
    const monthIndex = g === "month" ? monthOrQuarter - 1 : g === "quarter" ? (monthOrQuarter - 1) * 3 : 0;
    onTargetIsoChange(new Date(Date.UTC(year, monthIndex, 1)).toISOString());
  };

  return (
    <div className="tk-field">
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isPinnedToHome}
            onChange={(e) => onPinnedChange(e.target.checked)}
          />
          📌 釘選到首頁
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isLongTerm}
            onChange={(e) => onLongTermChange(e.target.checked)}
          />
          ♾️ 長期任務
        </label>
      </div>
      {isLongTerm && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>目標期（截止日難設定時用）</span>
          <select
            style={ctlStyle}
            value={targetGranularity}
            onChange={(e) => {
              const g = e.target.value;
              onGranularityChange(g);
              if (g && !targetIso) {
                setTargetFromParts(g, targetParts.year, g === "quarter" ? targetParts.quarter : targetParts.month);
              } else if (!g) {
                onTargetIsoChange(null);
              }
            }}
            aria-label="目標期粒度"
          >
            <option value="">不設定（純長期）</option>
            <option value="year">年</option>
            <option value="quarter">季</option>
            <option value="month">月</option>
          </select>
          {targetGranularity && (
            <input
              type="number"
              style={{ ...ctlStyle, width: 84 }}
              value={targetParts.year}
              onChange={(e) =>
                setTargetFromParts(
                  targetGranularity,
                  Number(e.target.value) || targetParts.year,
                  targetGranularity === "quarter" ? targetParts.quarter : targetParts.month
                )
              }
              aria-label="目標年份"
            />
          )}
          {targetGranularity === "quarter" && (
            <select
              style={ctlStyle}
              value={targetParts.quarter}
              onChange={(e) => setTargetFromParts("quarter", targetParts.year, Number(e.target.value))}
              aria-label="目標季"
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </select>
          )}
          {targetGranularity === "month" && (
            <select
              style={ctlStyle}
              value={targetParts.month}
              onChange={(e) => setTargetFromParts("month", targetParts.year, Number(e.target.value))}
              aria-label="目標月"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m} 月</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
