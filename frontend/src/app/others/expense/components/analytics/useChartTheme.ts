"use client";

import { useEffect, useState } from "react";
import {
  CATEGORICAL_BY_THEME,
  THEME_MODES,
  type ThemeMode,
} from "./chartPalette";

/**
 * 圖表所需的「已解析成具體值」的完整調色盤（隨主題切換重算）。
 *
 * 分類色來自四主題陣列（chartPalette）；其餘語意/結構色一律**即時解析 globals.css 的 CSS 變數**
 * ——因 Recharts 的 fill/stroke 走 SVG presentation attribute，`var(--x)` 不保證解析，必須傳具體值。
 */
export interface ChartColors {
  /** 目前主題（供除錯/條件用）。 */
  theme: ThemeMode;
  /** 分類環圈 8 色（固定序，主題對應）。 */
  categorical: string[];
  /** 單序列 bar 色（趨勢/商家）＝ `--action-secondary-fg`。 */
  accent: string;
  /** 環圈片間隙 stroke ＝ `--bg-surface`。 */
  surface: string;
  /** CartesianGrid ＝ `--border-default`。 */
  grid: string;
  /** 軸線 ＝ `--border-strong`。 */
  axis: string;
  /** 軸文字 ＝ `--text-secondary`。 */
  axisText: string;
  /** tooltip/legend 文字 ＝ `--text-primary`。 */
  text: string;
  /** tooltip 底 ＝ `--bg-elevated`。 */
  tooltipBg: string;
  /** tooltip 框 ＝ `--border-default`。 */
  tooltipBorder: string;
  /** 漲（花更多）＝ `--status-danger-fg`。 */
  up: string;
  /** 跌（花更少）＝ `--status-success-fg`。 */
  down: string;
  /** 持平/無資料 ＝ `--text-secondary`。 */
  flat: string;
}

/**
 * 讀取目前 `<html data-theme>`（缺/未知回退 warmpaper）。
 * @returns 主題模式。
 */
function readThemeMode(): ThemeMode {
  if (typeof document === "undefined") {
    return "warmpaper";
  }
  const attribute = document.documentElement.getAttribute("data-theme");
  return THEME_MODES.includes(attribute as ThemeMode)
    ? (attribute as ThemeMode)
    : "warmpaper";
}

/**
 * 解析單一 CSS 變數為具體值（供 SVG 屬性用）。
 * globals.css 四主題皆有定義，實務上必回非空；極端缺失時用 keyword fallback（非硬編 hex）。
 * @param variableName CSS 變數名（含 `--`）。
 * @param keywordFallback 缺失時的 CSS keyword 後備（如 transparent / currentColor）。
 * @returns 解析後的具體色值。
 */
function resolveCssVar(variableName: string, keywordFallback: string): string {
  if (typeof window === "undefined") {
    return keywordFallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return value || keywordFallback;
}

/**
 * 依主題組出完整 ChartColors（分類色查表、其餘即時解析 token）。
 * @param theme 目前主題。
 * @returns 已解析的調色盤。
 */
function buildChartColors(theme: ThemeMode): ChartColors {
  return {
    theme,
    categorical: CATEGORICAL_BY_THEME[theme],
    accent: resolveCssVar("--action-secondary-fg", "currentColor"),
    surface: resolveCssVar("--bg-surface", "transparent"),
    grid: resolveCssVar("--border-default", "currentColor"),
    axis: resolveCssVar("--border-strong", "currentColor"),
    axisText: resolveCssVar("--text-secondary", "currentColor"),
    text: resolveCssVar("--text-primary", "currentColor"),
    tooltipBg: resolveCssVar("--bg-elevated", "transparent"),
    tooltipBorder: resolveCssVar("--border-default", "currentColor"),
    up: resolveCssVar("--status-danger-fg", "currentColor"),
    down: resolveCssVar("--status-success-fg", "currentColor"),
    flat: resolveCssVar("--text-secondary", "currentColor"),
  };
}

/**
 * 主題感知圖表配色 hook。
 *
 * 機制（關鍵）：用 **MutationObserver** 監看 `<html>` 的 `data-theme` 屬性——涵蓋 Header 選單
 *（只 setAttribute、不發事件）、鍵盤快捷鍵、系統偏好**全部**換主題路徑；另加 `themechange` 事件當備援。
 * 主題一變即重解析 token、重繪圖表。SSR/首渲染尚未掛載時回傳 `null`，由呼叫端顯示 skeleton
 *（Recharts 本就需 DOM 尺寸，client 掛載後才渲染，避免 hydration 不一致）。
 *
 * @returns 已解析的調色盤；尚未於 client 掛載/解析時為 null。
 */
export function useChartTheme(): ChartColors | null {
  const [colors, setColors] = useState<ChartColors | null>(null);

  useEffect(() => {
    // 掛載後首次解析。
    const refresh = () => setColors(buildChartColors(readThemeMode()));
    refresh();

    // 主要路徑：監看 data-theme 屬性變動（涵蓋 Header 選單「只 setAttribute」的最常走路徑）。
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // 備援：部分路徑會 dispatch 事件（快捷鍵/setTheme）。
    window.addEventListener("themechange", refresh);
    window.addEventListener("zonwiki:theme-changed", refresh);

    return () => {
      observer.disconnect();
      window.removeEventListener("themechange", refresh);
      window.removeEventListener("zonwiki:theme-changed", refresh);
    };
  }, []);

  return colors;
}
