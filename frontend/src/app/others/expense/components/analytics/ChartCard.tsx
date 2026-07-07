"use client";

import type { ReactNode } from "react";

/**
 * ChartCard 屬性。
 */
export interface ChartCardProps {
  /** 卡片標題。 */
  title: string;
  /** 該切片是否為空（顯示 mini 空狀態而非圖表）。 */
  isEmpty?: boolean;
  /** 空狀態文字。 */
  emptyText?: string;
  /** 圖表內容。 */
  children: ReactNode;
}

/**
 * 分析區塊的共用卡片外框：標題 ＋（切片為空時）mini 空狀態。
 *
 * 各子圖自帶「該切片為空」的 mini 空狀態（審查 MEDIUM：本月零消費但有歷史時，趨勢圖仍渲染，
 * 其它子圖各自顯示 mini 空狀態，不整頁藏掉）。
 * @param props title／isEmpty／emptyText／children。
 * @returns 卡片節點。
 */
export function ChartCard({ title, isEmpty, emptyText, children }: ChartCardProps) {
  return (
    <section
      className="card"
      aria-label={title}
      style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)", minWidth: 0 }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "var(--text-base)",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </h3>
      {isEmpty ? (
        <div
          style={{
            padding: "var(--spacing-8) var(--spacing-4)",
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
          }}
        >
          {emptyText ?? "此區間尚無資料"}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
