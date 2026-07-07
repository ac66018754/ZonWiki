"use client";

import { useEffect, type ReactElement } from "react";
import type { VocabToast } from "../lib/useCoachConnection";

/** 每則提示自動關閉的毫秒數。 */
const AUTO_DISMISS_MS = 4000;

/**
 * 「已加入單字本」提示小卡（計畫 §6）。收到 vocab_added 由 hook 推入佇列，這裡渲染並自動淡出。
 *
 * @param toasts 提示佇列。
 * @param onDismiss 關閉某則。
 */
export function VocabAddedToast({
  toasts,
  onDismiss,
}: {
  toasts: VocabToast[];
  onDismiss: (id: number) => void;
}): ReactElement {
  return (
    <div
      className="coach-vocab-toasts"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-2)",
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * 單則提示（自動淡出）。
 * @param toast 提示資料。
 * @param onDismiss 關閉回呼。
 */
function ToastCard({
  toast,
  onDismiss,
}: {
  toast: VocabToast;
  onDismiss: (id: number) => void;
}): ReactElement {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className="coach-vocab-toast"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--status-success-fg)",
        borderRadius: "var(--radius-md)",
        padding: "var(--spacing-2) var(--spacing-3)",
        boxShadow: "var(--shadow-md)",
        fontSize: "var(--text-sm)",
        color: "var(--text-primary)",
      }}
    >
      <span aria-hidden>➕</span>
      <span>
        已加入單字本：<strong style={{ color: "var(--status-success-fg)" }}>{toast.word}</strong>
      </span>
      <button
        type="button"
        className="coach-icon-btn"
        aria-label={`關閉「${toast.word}」提示`}
        onClick={() => onDismiss(toast.id)}
        style={{ marginLeft: "auto" }}
      >
        ✕
      </button>
    </div>
  );
}
