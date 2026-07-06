/**
 * 記帳頁共用工具（金額格式化、當月字串、品項字串轉換）。
 */

/**
 * 以 zh-TW 語系格式化金額為貨幣字串。
 * @param amount 金額。
 * @param currency 幣別代碼（預設 TWD）。
 * @returns 例如「$300」（TWD）；不支援的幣別代碼退回「TWD 300」。
 */
export function formatCurrency(amount: number, currency: string = "TWD"): string {
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: currency || "TWD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || "TWD"} ${amount}`;
  }
}

/**
 * 取得使用者時區下的「當月」字串（YYYY-MM）。
 * @param timeZone IANA 時區。
 * @returns 例如「2026-07」。
 */
export function currentMonthInTimeZone(timeZone: string): string {
  try {
    // en-CA 會格式化成 YYYY-MM-DD，取前 7 碼即 YYYY-MM。
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return formatted.slice(0, 7);
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}

/**
 * 把逗號分隔的品項字串拆成陣列（去空白、濾空）。
 * 同時接受中文全形逗號「，」與半形「,」。
 * @param raw 逗號分隔字串。
 * @returns 品項陣列（可能為空）。
 */
export function splitItems(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
