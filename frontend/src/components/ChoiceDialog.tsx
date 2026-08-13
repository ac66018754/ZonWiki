"use client";

/**
 * ChoiceDialog — 多選一對話框（2026-08-13，供「拖曳筆記到分類：切換/增加」等
 * 超過二元確認的情境；沿用 ConfirmDialog 的 modal 樣式與焦點陷阱慣例）。
 *
 * 與 ConfirmDialog 的差異：不是「確認/取消」二元，而是 N 個具名選項；
 * 點選項回傳其 key，Esc / 點背景 / 取消鈕＝放棄（onCancel）。
 */

import { ReactNode, useRef } from "react";
import { Button } from "./Button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/** 對話框的單一選項。 */
export interface ChoiceOption {
  /** 選項識別碼（onSelect 回傳值）。 */
  key: string;
  /** 選項主文字。 */
  label: string;
  /** 補充說明（小字，可空）。 */
  description?: string;
}

interface ChoiceDialogProps {
  /** 是否開啟。 */
  isOpen: boolean;
  /** 標題。 */
  title: string;
  /** 內容說明（可空；字串保留換行）。 */
  message?: ReactNode;
  /** 選項清單（依序渲染為按鈕）。 */
  options: ChoiceOption[];
  /** 點選某選項。 */
  onSelect: (key: string) => void;
  /** 放棄（Esc / 點背景 / 取消鈕）。 */
  onCancel: () => void;
}

export function ChoiceDialog({
  isOpen,
  title,
  message,
  options,
  onSelect,
  onCancel,
}: ChoiceDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦點陷阱：開啟時聚焦首個可聚焦元素、Tab 循環、Esc 取消、關閉後還原焦點。
  useFocusTrap(dialogRef, isOpen, { onEscape: onCancel });

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay modal-overlay--top"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-dialog-title"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="modal__header">
          <h2 id="choice-dialog-title" className="modal__title">
            {title}
          </h2>
        </div>

        <div className="modal__body" style={{ whiteSpace: "pre-wrap" }}>
          {message}
          <div style={{ display: "grid", gap: "var(--spacing-2)", marginTop: message ? "var(--spacing-3)" : 0 }}>
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onSelect(option.key)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--spacing-3)",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-default)";
                }}
              >
                <span style={{ fontWeight: 600 }}>{option.label}</span>
                {option.description && (
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: "var(--text-xs)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {option.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="modal__footer">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
