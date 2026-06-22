/**
 * 日誌工具 — 生產模式時自動隱藏 debug 訊息
 *
 * 使用方法：
 *   import { logger } from '@/lib/logger'
 *   logger.log('訊息') — 僅在 debug 模式時輸出
 *   logger.error('錯誤') — 總是輸出
 */

import { isDebugMode } from "./constants";

export const logger = {
  /**
   * 記錄調試訊息（僅在 debug 模式時輸出）
   */
  log: (...args: unknown[]): void => {
    if (!isDebugMode()) return;
    console.log(...args);
  },

  /**
   * 記錄調試警告（僅在 debug 模式時輸出）
   */
  warn: (...args: unknown[]): void => {
    if (!isDebugMode()) return;
    console.warn(...args);
  },

  /**
   * 記錄錯誤（總是輸出）
   */
  error: (...args: unknown[]): void => {
    console.error(...args);
  },

  /**
   * 記錄資訊（總是輸出）
   */
  info: (...args: unknown[]): void => {
    console.log(...args);
  },
};
