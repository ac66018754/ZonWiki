"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail, type ToastType } from "@/lib/toast";

/**
 * 全域 Toast 容器（無 UI 控制鈕；掛在版面根層一次即可）。
 *
 * 行為：
 * - 監聽 {@link TOAST_EVENT}，把每則提示放進佇列並渲染於畫面頂端置中。
 * - 每則提示用 CSS 動畫「快速浮現 → 維持 → 漸漸淡出」，於 `durationMs` 後自動移除；
 *   **沒有關閉按鈕**（依需求自己消失）。
 * - 多則提示同時出現時自動往下堆疊。
 */

/** 佇列中的單則 Toast（含唯一 id 供 React key 與移除）。 */
interface ActiveToast extends ToastDetail {
  /** 單調遞增的唯一識別碼。 */
  id: number;
}

/** 模組層遞增計數器（避免用 Date.now/Math.random 產生 key）。 */
let toastSeq = 0;

/** 依類型決定配色（背景／文字／邊框）。 */
function colorsFor(type: ToastType): { bg: string; fg: string; border: string } {
  switch (type) {
    case "error":
      return {
        bg: "var(--status-error-bg)",
        fg: "var(--status-error-fg)",
        border: "var(--status-error-fg)",
      };
    case "info":
      return {
        bg: "var(--bg-elevated)",
        fg: "var(--text-primary)",
        border: "var(--border-default)",
      };
    case "success":
    default:
      return {
        bg: "var(--status-success-bg)",
        fg: "var(--status-success-fg)",
        border: "var(--status-success-fg)",
      };
  }
}

/** 依類型決定前綴圖示。 */
function iconFor(type: ToastType): string {
  switch (type) {
    case "error":
      return "⚠️";
    case "info":
      return "ℹ️";
    case "success":
    default:
      return "✅";
  }
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail || !detail.message) return;
      const id = ++toastSeq;
      const toast: ActiveToast = {
        id,
        message: detail.message,
        type: detail.type,
        durationMs: detail.durationMs,
      };
      setToasts((prev) => [...prev, toast]);
      // 動畫結束（durationMs）後自動移除。
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, detail.durationMs);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(var(--header-height, 56px) + var(--spacing-3))",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--spacing-2)",
        zIndex: 5000,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const c = colorsFor(toast.type);
        return (
          <div
            key={toast.id}
            role="status"
            style={{
              // 自訂時長透過 CSS 變數帶入 keyframes（zonwiki-toast）。
              animation: `zonwiki-toast ${toast.durationMs}ms ease forwards`,
              background: c.bg,
              color: c.fg,
              border: `1px solid ${c.border}`,
              borderRadius: "var(--radius-full)",
              padding: "var(--spacing-2) var(--spacing-5)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              alignItems: "center",
              gap: "var(--spacing-2)",
              maxWidth: "min(90vw, 420px)",
              textAlign: "center",
            }}
          >
            <span aria-hidden>{iconFor(toast.type)}</span>
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
