/**
 * Input 元件 — 輸入框、文字區域等
 */

import React, { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** 輸入框大小 */
  size?: "sm" | "md" | "lg";
  /** 是否顯示錯誤狀態 */
  isError?: boolean;
  /** 錯誤訊息 */
  errorMessage?: string;
}

/**
 * Input 文字輸入框
 *
 * @example
 * ```tsx
 * <Input
 *   type="text"
 *   placeholder="輸入內容..."
 *   isError={hasError}
 *   errorMessage="此欄位為必填"
 * />
 * ```
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = "md",
      isError = false,
      errorMessage,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const paddingMap = {
      sm: "var(--spacing-1) var(--spacing-2)",
      md: "var(--spacing-2) var(--spacing-3)",
      lg: "var(--spacing-3) var(--spacing-4)",
    };

    return (
      <div>
        <input
          ref={ref}
          className={`input ${className || ""}`}
          style={{
            padding: paddingMap[size],
            borderColor: isError ? "var(--status-danger-fg)" : "var(--border-default)",
            ...style,
          }}
          {...props}
        />
        {isError && errorMessage && (
          <p
            style={{
              margin: "var(--spacing-1) 0 0",
              fontSize: "var(--text-xs)",
              color: "var(--status-danger-fg)",
            }}
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /** 文字區域大小 */
  size?: "sm" | "md" | "lg";
  /** 是否顯示錯誤狀態 */
  isError?: boolean;
  /** 錯誤訊息 */
  errorMessage?: string;
}

/**
 * Textarea 多行文字輸入框
 *
 * @example
 * ```tsx
 * <Textarea
 *   placeholder="輸入詳細內容..."
 *   rows={5}
 *   isError={hasError}
 * />
 * ```
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      size = "md",
      isError = false,
      errorMessage,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const paddingMap = {
      sm: "var(--spacing-2) var(--spacing-3)",
      md: "var(--spacing-3) var(--spacing-4)",
      lg: "var(--spacing-4) var(--spacing-5)",
    };

    return (
      <div>
        <textarea
          ref={ref}
          className={`input ${className || ""}`}
          style={{
            padding: paddingMap[size],
            borderColor: isError ? "var(--status-danger-fg)" : "var(--border-default)",
            fontFamily: "var(--font-body)",
            minHeight: "120px",
            resize: "vertical",
            ...style,
          }}
          {...props}
        />
        {isError && errorMessage && (
          <p
            style={{
              margin: "var(--spacing-1) 0 0",
              fontSize: "var(--text-xs)",
              color: "var(--status-danger-fg)",
            }}
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
