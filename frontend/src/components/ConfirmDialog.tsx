"use client";

/**
 * ConfirmDialog 元件 — 取代原生 window.confirm 的無障礙確認對話框
 *
 * 特色：
 * - 沿用 Modal 的 .modal / .modal-overlay 樣式（外觀與站內其他對話框一致）
 * - 破壞性操作用 danger（紅色）主要按鈕
 * - Enter 確認、Esc 取消
 * - 焦點陷阱（useFocusTrap）：進入聚焦首個可聚焦元素、Tab 循環、關閉後還原焦點
 */

import React, { ReactNode, useRef } from "react";
import { Button } from "./Button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ConfirmDialogProps {
  /** 是否開啟 */
  isOpen: boolean;
  /** 標題 */
  title: string;
  /** 內容（字串會保留換行 \n 呈現；也可傳入 ReactNode） */
  message: ReactNode;
  /** 確認按鈕文字 */
  confirmLabel?: string;
  /** 取消按鈕文字 */
  cancelLabel?: string;
  /** 是否為破壞性操作（紅色確認按鈕） */
  danger?: boolean;
  /** 按下確認的回調 */
  onConfirm: () => void;
  /** 按下取消 / Esc / 點背景的回調 */
  onCancel: () => void;
}

/**
 * ConfirmDialog 確認對話框
 *
 * @example
 * ```tsx
 * <ConfirmDialog
 *   isOpen={isOpen}
 *   title="確認刪除"
 *   message="此操作無法復原。"
 *   danger
 *   onConfirm={handleDelete}
 *   onCancel={() => setIsOpen(false)}
 * />
 * ```
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 對話框容器 ref：作為焦點陷阱的循環範圍
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦點陷阱：開啟時聚焦首個可聚焦元素、Tab 循環、Esc 取消、關閉後還原焦點
  useFocusTrap(dialogRef, isOpen, { onEscape: onCancel });

  if (!isOpen) return null;

  /**
   * 對話框層級的鍵盤處理：
   * - Enter：確認（避免焦點在取消鈕時仍能快速確認）
   * - Esc 已由 useFocusTrap 處理，這裡不重複攔截
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    // 暗背景：點擊（僅背景本身）視為取消。對話框內容置於其內，靠 overlay 的 flex 置中。
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="presentation"
    >
      {/* 對話框內容 */}
      <div
        ref={dialogRef}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="modal__header">
          <h2 id="confirm-dialog-title" className="modal__title">
            {title}
          </h2>
        </div>

        {/* 內文：字串保留換行（pre-wrap），中文行高沿用站內基礎樣式 */}
        <div className="modal__body" style={{ whiteSpace: "pre-wrap" }}>
          {message}
        </div>

        <div className="modal__footer">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
