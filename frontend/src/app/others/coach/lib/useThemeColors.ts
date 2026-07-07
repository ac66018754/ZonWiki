"use client";

import { useEffect, useState } from "react";

/**
 * 主題感知的 CSS 變數解析 hook（仿 expense/analytics 的 useChartTheme）。
 *
 * 用途：糾錯卡的 diff 顏色（紅/綠）需以「已解析的具體值」套用並在四主題間即時切換，
 * **禁硬編色票**。機制與 useChartTheme 一致：
 *  - 掛載後以 getComputedStyle 解析指定 CSS 變數為具體值；
 *  - 用 MutationObserver 監 `<html data-theme>`（涵蓋 Header 選單「只 setAttribute」的路徑），
 *    另加 themechange 事件備援；主題一變即重解析。
 *  - SSR/首渲染回 null，由呼叫端顯示保守樣式。
 *
 * @param varNames 要解析的 CSS 變數名（含 `--`）。
 * @returns name→具體色值 的對映；尚未於 client 解析時為 null。
 */
export function useThemeColors(
  varNames: readonly string[],
): Record<string, string> | null {
  const [colors, setColors] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const resolve = () => {
      const style = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const name of varNames) {
        next[name] = style.getPropertyValue(name).trim() || "currentColor";
      }
      setColors(next);
    };
    resolve();

    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("themechange", resolve);
    window.addEventListener("zonwiki:theme-changed", resolve);

    return () => {
      observer.disconnect();
      window.removeEventListener("themechange", resolve);
      window.removeEventListener("zonwiki:theme-changed", resolve);
    };
    // varNames 由呼叫端以模組常數傳入（穩定參考）；不放進 deps 以免無謂重訂閱。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return colors;
}
