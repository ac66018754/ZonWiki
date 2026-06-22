"use client";

/**
 * Modal 元件 — 模態對話框
 */

import React, { ReactNode } from "react";
import { Button } from "./Button";

interface ModalProps {
  /** 是否開啟 */
  isOpen: boolean;
  /** 標題 */
  title: string;
  /** 內容 */
  children: ReactNode;
  /** 確認按鈕文字 */
  confirmLabel?: string;
  /** 取消按鈕文字 */
  cancelLabel?: string;
  /** 確認回調 */
  onConfirm?: () => void;
  /** 關閉回調 */
  onClose: () => void;
  /** 是否為危險操作 (紅色確認按鈕) */
  isDangerous?: boolean;
  /** 是否禁用確認按鈕 */
  isConfirmDisabled?: boolean;
}

/**
 * Modal 模態對話框
 *
 * @example
 * ```tsx
 * <Modal
 *   isOpen={isOpen}
 *   title="確認刪除"
 *   onClose={() => setIsOpen(false)}
 *   onConfirm={handleDelete}
 *   isDangerous
 * >
 *   此操作無法復原。
 * </Modal>
 * ```
 */
export function Modal({
  isOpen,
  title,
  children,
  confirmLabel = "確認",
  cancelLabel = "取消",
  onConfirm,
  onClose,
  isDangerous = false,
  isConfirmDisabled = false,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* 暗背景 */}
      <div
        className="modal-overlay"
        onClick={onClose}
        role="presentation"
      />

      {/* 模態內容 */}
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="modal-title" className="modal__title">
            {title}
          </h2>
        </div>

        <div className="modal__body">{children}</div>

        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDangerous ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={isConfirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
