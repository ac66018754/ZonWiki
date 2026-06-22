"use client";

import { useEffect, useRef, useState } from "react";
import { CurrentUser } from "@/lib/api";
import { Sidebar } from "./Sidebar";

/**
 * 手機版側欄抽屜
 * - 在 <768px 時顯示為抽屜而非固定側欄
 * - 包含遮罩、Esc 關閉、focus trap
 * - 無障礙支援
 */
export function MobileSidebar({
  isOpen,
  onClose,
  user,
}: {
  isOpen: boolean;
  onClose: () => void;
  user: CurrentUser | null;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const lastFocusableRef = useRef<HTMLButtonElement>(null);

  /**
   * 初始化 focus trap
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }

      // Focus trap
      if (e.key === "Tab") {
        const focusableElements = drawerRef.current?.querySelectorAll(
          'a, button, input, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements || focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusableElements[0] as HTMLElement;
        const last = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    firstFocusableRef.current?.focus();

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* 遮罩 */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 99,
            animation: "fadeIn 0.2s ease",
          }}
          onClick={onClose}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* 抽屜 */}
      <div
        ref={drawerRef}
        style={{
          position: "fixed",
          left: 0,
          top: "var(--header-height)",
          bottom: 0,
          width: "var(--sidebar-width, 260px)",
          maxWidth: "80vw",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-default)",
          zIndex: 100,
          overflow: "auto",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease",
          boxShadow: "var(--shadow-lg)",
        }}
        role="navigation"
        aria-label="行動導覽"
        aria-hidden={!isOpen}
      >
        <div style={{ padding: "var(--spacing-4)" }}>
          <Sidebar user={user} />
        </div>

        {/* 關閉按鈕 (可選) */}
        <button
          ref={firstFocusableRef}
          onClick={onClose}
          style={{
            position: "absolute",
            top: "var(--spacing-4)",
            right: "var(--spacing-4)",
            background: "transparent",
            border: "none",
            fontSize: "var(--text-2xl)",
            cursor: "pointer",
            color: "var(--text-primary)",
          }}
          aria-label="關閉側欄"
        >
          ✕
        </button>
      </div>
    </>
  );
}
