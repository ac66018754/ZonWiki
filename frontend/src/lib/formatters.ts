/**
 * 日期時間格式化工具函數
 *
 * 所有函數接受 UTC 日期字串
 * 透過用戶時區參數進行本地轉換
 */

import { DEFAULT_TIMEZONE } from "./constants";

/**
 * 格式化日期時間為本地時區
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 格式化後的日期時間字串 (MM/DD HH:mm)
 */
export function formatDateTime(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-Hant", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * 格式化日期為 MM/DD 格式
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 格式化後的日期字串 (MM/DD)
 */
export function formatDate(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-Hant", {
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * 格式化時間為 HH:mm 格式
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 格式化後的時間字串 (HH:mm)
 */
export function formatTime(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-Hant", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * 取得星期幾的中文名稱
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 星期幾的中文名稱 (一到日)
 */
export function getDayName(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  try {
    const date = new Date(dateString);
    const formatter = new Intl.DateTimeFormat("zh-Hant", {
      weekday: "short",
      timeZone,
    });
    return formatter.format(date);
  } catch {
    return "";
  }
}

/**
 * 格式化日期為完整格式 (年 月 日 時:分)
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 完整格式的日期時間字串 (YYYY年M月D日 HH:mm)
 */
export function formatFullDateTime(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * 將 UTC 日期字串轉換為指定時區的 Date 物件 (時間已調整)
 * @param dateString UTC 日期字串 (ISO 8601)
 * @param timeZone 時區 (IANA，如 "Asia/Taipei")，預設為 Asia/Taipei
 * @returns 已調整時區的 Date 物件
 */
export function toTimeZoneDate(
  dateString: string,
  timeZone: string = DEFAULT_TIMEZONE
): Date {
  try {
    const date = new Date(dateString);
    // 取得該時區的偏移量
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const partsObj: Record<string, string> = {};
    parts.forEach((part) => {
      partsObj[part.type] = part.value;
    });

    return new Date(
      `${partsObj.year}-${partsObj.month}-${partsObj.day}T${partsObj.hour}:${partsObj.minute}:${partsObj.second}Z`
    );
  } catch {
    return new Date(dateString);
  }
}
