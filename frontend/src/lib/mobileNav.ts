/**
 * 行動版導覽（mobile navigation）開關工具。
 *
 * 設計：以 <html> 上的 data-mobnav 屬性作為唯一真實狀態（single source of truth），
 * 與本專案既有的 data-theme / data-sidebar-hidden 模式一致；CSS 直接依此屬性
 * 在手機斷點顯示側欄抽屜與遮罩。任何元件（Header 漢堡鈕、側欄連結、遮罩）都能
 * 透過這些函式開關，並以自訂事件通知需要同步 UI（例如 aria-expanded）的元件。
 */

/** <html> 上代表「行動導覽已開啟」的屬性名稱。 */
const MOBILE_NAV_ATTR = "data-mobnav";

/** 狀態變更時派發的自訂事件名稱（供 Header 等同步 aria 狀態）。 */
export const MOBILE_NAV_EVENT = "zonwiki:mobnav";

/**
 * 目前行動導覽是否開啟。
 * @returns 開啟為 true；在伺服器端（無 document）一律回傳 false。
 */
export function isMobileNavOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(MOBILE_NAV_ATTR) === "open";
}

/**
 * 設定行動導覽開關狀態。
 * @param open 是否開啟。
 */
export function setMobileNav(open: boolean): void {
  if (typeof document === "undefined") return;
  if (open) {
    document.documentElement.setAttribute(MOBILE_NAV_ATTR, "open");
  } else {
    document.documentElement.removeAttribute(MOBILE_NAV_ATTR);
  }
  // 通知關注此狀態的元件（例如漢堡鈕的 aria-expanded）即時更新。
  window.dispatchEvent(new Event(MOBILE_NAV_EVENT));
}

/**
 * 切換行動導覽開關狀態（開→關、關→開）。
 */
export function toggleMobileNav(): void {
  setMobileNav(!isMobileNavOpen());
}

/**
 * 關閉行動導覽（點遮罩、點連結、換頁時呼叫）。
 */
export function closeMobileNav(): void {
  setMobileNav(false);
}
