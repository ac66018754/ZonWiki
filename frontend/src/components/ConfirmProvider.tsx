"use client";

/**
 * ConfirmProvider / useConfirm — 以 Promise 為基礎、可 await 的全站確認對話框
 *
 * 取代原生 window.confirm（原生對話框無法自訂樣式、不支援焦點陷阱、且會凍結主執行緒）。
 *
 * 用法：
 * ```tsx
 * const confirm = useConfirm();
 * const ok = await confirm({ message: "刪除這則？", danger: true });
 * if (!ok) return;
 * ```
 */

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * 呼叫 confirm() 時可傳入的選項。
 */
export interface ConfirmOptions {
  /** 標題（預設「請確認」） */
  title?: string;
  /** 內容訊息（字串會保留換行 \n；也可傳 ReactNode） */
  message: ReactNode;
  /** 確認按鈕文字（預設「確認」） */
  confirmLabel?: string;
  /** 取消按鈕文字（預設「取消」） */
  cancelLabel?: string;
  /** 是否為破壞性操作（紅色確認按鈕，預設 false） */
  danger?: boolean;
}

/**
 * confirm 函式型別：傳入選項、回傳 Promise，使用者按確認 resolve(true)、取消 resolve(false)。
 */
type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>;

/**
 * 內部狀態：目前對話框的內容與尚未 resolve 的 Promise resolver。
 */
interface ConfirmState {
  /** 是否開啟 */
  isOpen: boolean;
  /** 目前對話框選項 */
  options: ConfirmOptions;
}

// Context 預設值為 null，未包 Provider 時使用會丟出明確錯誤
const ConfirmContext = createContext<ConfirmFunction | null>(null);

/**
 * 空白預設選項（關閉狀態下的佔位，避免 message 為 undefined）。
 */
const EMPTY_OPTIONS: ConfirmOptions = { message: "" };

/**
 * ConfirmProvider — 掛在應用程式根層，提供全站唯一的確認對話框。
 *
 * @param children 子節點
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    options: EMPTY_OPTIONS,
  });

  // 保存目前這次 confirm 的 resolver；按下確認/取消時呼叫它回傳結果
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  /**
   * 開啟對話框並回傳 Promise，等待使用者做出選擇。
   */
  const confirm = useCallback<ConfirmFunction>((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ isOpen: true, options });
    });
  }, []);

  /**
   * 結束對話框：resolve 結果、清空 resolver、關閉 UI。
   *
   * @param result true＝確認、false＝取消
   */
  const settle = useCallback((result: boolean) => {
    // 先取出並清空 resolver，避免重複 resolve
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState((prev) => ({ ...prev, isOpen: false }));
    if (resolve) resolve(result);
  }, []);

  const handleConfirm = useCallback(() => settle(true), [settle]);
  const handleCancel = useCallback(() => settle(false), [settle]);

  // confirm 函式為穩定參照，可安全放進 useEffect / useCallback 相依
  const contextValue = useMemo<ConfirmFunction>(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog
        isOpen={state.isOpen}
        title={state.options.title ?? "請確認"}
        message={state.options.message}
        confirmLabel={state.options.confirmLabel}
        cancelLabel={state.options.cancelLabel}
        danger={state.options.danger}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * useConfirm — 取得可 await 的 confirm 函式。
 *
 * @returns confirm(options) => Promise<boolean>
 * @throws 若未被 ConfirmProvider 包住則丟出錯誤
 */
export function useConfirm(): ConfirmFunction {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm 必須在 <ConfirmProvider> 之內使用");
  }
  return context;
}
