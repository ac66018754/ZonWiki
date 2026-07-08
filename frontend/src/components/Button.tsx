/**
 * Button 元件 — 填充、軟按鈕、Ghost 等變體
 */

import React, { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按鈕變體 */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** 按鈕大小 */
  size?: "sm" | "md" | "lg";
  /** 是否為全寬 */
  fullWidth?: boolean;
  /** 是否為載入中 */
  isLoading?: boolean;
}

/**
 * Button 元件
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md">
 *   保存
 * </Button>
 *
 * <Button variant="secondary" disabled>
 *   已禁用
 * </Button>
 * ```
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      fullWidth = false,
      isLoading = false,
      children,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const variantClass =
      variant === "primary"
        ? "btn-primary"
        : variant === "secondary"
          ? "btn-secondary"
          : variant === "danger"
            ? "btn-danger"
            : "btn-ghost";

    const sizeClass =
      size === "sm"
        ? "btn-sm"
        : size === "lg"
          ? "btn-lg"
          : "";

    return (
      <button
        ref={ref}
        className={`${variantClass} ${sizeClass} ${fullWidth ? "w-full" : ""} ${className || ""}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <span
              style={{
                display: "inline-block",
                width: "1em",
                height: "1em",
                borderRadius: "50%",
                borderTop: "2px solid currentColor",
                borderRight: "2px solid transparent",
                animation: "spin 0.6s linear infinite",
                marginRight: "0.5em",
              }}
            />
            處理中...
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

/**
 * 危險按鈕 CSS (補充到 globals.css)
 */
const dangerButtonStyles = `
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  background: var(--status-danger-fg);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.2s ease;
}

/* hover 用 filter 變暗（四主題一致的變暗回饋），取代原寫死暗紅 #ae2a19。 */
.btn-danger:hover {
  filter: brightness(0.9);
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--text-xs);
}

.btn-lg {
  padding: var(--spacing-3) var(--spacing-5);
  font-size: var(--text-base);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
`;
