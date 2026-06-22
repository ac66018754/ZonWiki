/**
 * Card 元件 — 容器、邊框、陰影、內間距
 */

import React, { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 是否顯示陰影 */
  shadow?: "none" | "sm" | "md" | "lg";
  /** 內間距大小 */
  padding?: "sm" | "md" | "lg";
  /** 邊框圓角大小 */
  rounded?: "sm" | "md" | "lg";
  /** 邊框顏色 */
  border?: boolean;
}

/**
 * Card 元件 — 通用卡片容器
 *
 * @example
 * ```tsx
 * <Card padding="md" shadow="sm">
 *   <h3>卡片標題</h3>
 *   <p>卡片內容</p>
 * </Card>
 * ```
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      shadow = "sm",
      padding = "md",
      rounded = "md",
      border = true,
      children,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const shadowMap = {
      none: "0",
      sm: "var(--shadow-sm)",
      md: "var(--shadow-md)",
      lg: "var(--shadow-lg)",
    };

    const paddingMap = {
      sm: "var(--spacing-3)",
      md: "var(--spacing-4)",
      lg: "var(--spacing-6)",
    };

    const radiusMap = {
      sm: "var(--radius-md)",
      md: "var(--radius-lg)",
      lg: "var(--radius-lg)",
    };

    return (
      <div
        ref={ref}
        className={`card ${className || ""}`}
        style={{
          boxShadow: shadowMap[shadow],
          padding: paddingMap[padding],
          borderRadius: radiusMap[rounded],
          border: border ? "1px solid var(--border-default)" : "none",
          background: "var(--bg-surface)",
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
