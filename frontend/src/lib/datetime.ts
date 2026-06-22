/**
 * 日期時間工具 — UTC 轉使用者時區顯示
 *
 * 後端一律回傳 UTC 時間；前端依使用者設定的時區顯示。
 */

/**
 * 格式化日期時間為使用者本地時間
 * @param utcDateString UTC 格式的日期時間字串 (e.g. "2026-06-11T10:30:00Z")
 * @param userTimeZone 使用者時區 (IANA 格式, e.g. "Asia/Taipei")
 * @param format 輸出格式 (e.g. "short" | "long" | "time-only")
 * @returns 格式化後的本地時間字串
 */
export function formatLocalDateTime(
  utcDateString: string,
  userTimeZone: string = "Asia/Taipei",
  format: "short" | "long" | "time-only" = "short"
): string {
  try {
    const date = new Date(utcDateString);

    const options: Intl.DateTimeFormatOptions =
      format === "short"
        ? {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: userTimeZone,
          }
        : format === "long"
          ? {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: userTimeZone,
              weekday: "short",
            }
          : {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: userTimeZone,
            };

    return new Intl.DateTimeFormat("zh-Hant-TW", options).format(date);
  } catch {
    return utcDateString;
  }
}

/**
 * 格式化日期（只顯示年月日）
 * @param utcDateString UTC 格式的日期時間字串
 * @param userTimeZone 使用者時區
 * @returns 本地日期字串 (e.g. "2026-06-11")
 */
export function formatLocalDate(
  utcDateString: string,
  userTimeZone: string = "Asia/Taipei"
): string {
  try {
    const date = new Date(utcDateString);
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: userTimeZone,
    };

    return new Intl.DateTimeFormat("en-CA", options).format(date); // en-CA 會回傳 YYYY-MM-DD 格式
  } catch {
    return utcDateString.split("T")[0];
  }
}

/**
 * 格式化時間（只顯示時分秒）
 * @param utcDateString UTC 格式的日期時間字串
 * @param userTimeZone 使用者時區
 * @returns 本地時間字串 (e.g. "14:30:00")
 */
export function formatLocalTime(
  utcDateString: string,
  userTimeZone: string = "Asia/Taipei"
): string {
  try {
    const date = new Date(utcDateString);
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: userTimeZone,
      hour12: false,
    };

    return new Intl.DateTimeFormat("en-GB", options).format(date);
  } catch {
    return utcDateString.split("T")[1]?.substring(0, 8) || "";
  }
}

/**
 * 相對時間顯示 (e.g. "2 小時前", "3 天前")
 * @param utcDateString UTC 格式的日期時間字串
 * @returns 相對時間字串
 */
export function formatRelativeTime(utcDateString: string): string {
  try {
    const date = new Date(utcDateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return "剛剛";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小時前`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} 天前`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 604800)} 週前`;
    if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)} 月前`;

    return `${Math.floor(diffSec / 31536000)} 年前`;
  } catch {
    return "";
  }
}

/**
 * 判斷日期是否為「今天」
 * @param utcDateString UTC 格式的日期時間字串
 * @param userTimeZone 使用者時區
 * @returns 是否為今天
 */
export function isToday(
  utcDateString: string,
  userTimeZone: string = "Asia/Taipei"
): boolean {
  try {
    const date = new Date(utcDateString);
    const today = new Date();

    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: userTimeZone,
    };

    const dateStr = new Intl.DateTimeFormat("en-CA", options).format(date);
    const todayStr = new Intl.DateTimeFormat("en-CA", options).format(today);

    return dateStr === todayStr;
  } catch {
    return false;
  }
}

/**
 * 判斷日期是否為「昨天」
 * @param utcDateString UTC 格式的日期時間字串
 * @param userTimeZone 使用者時區
 * @returns 是否為昨天
 */
export function isYesterday(
  utcDateString: string,
  userTimeZone: string = "Asia/Taipei"
): boolean {
  try {
    const date = new Date(utcDateString);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: userTimeZone,
    };

    const dateStr = new Intl.DateTimeFormat("en-CA", options).format(date);
    const yesterdayStr = new Intl.DateTimeFormat("en-CA", options).format(
      yesterday
    );

    return dateStr === yesterdayStr;
  } catch {
    return false;
  }
}

/**
 * 轉換本地日期字串為 UTC ISO 格式
 * （用於提交表單時）
 * @param localDateStr 本地日期字串 (e.g. "2026-06-11")
 * @param userTimeZone 使用者時區
 * @returns UTC ISO 格式字串
 */
export function toUTC(
  localDateStr: string,
  userTimeZone: string = "Asia/Taipei"
): string {
  try {
    // 解析本地日期字串，假設格式為 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
    const date = new Date(localDateStr);

    // 此方法會回傳 UTC ISO 字串
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
}
