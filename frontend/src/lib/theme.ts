/**
 * 主題系統 — 4 種顯示模式的色彩令牌
 *
 * 顯示模式：
 * - warmpaper：暖紙色（預設、護眼）
 * - light：明亮
 * - dark：暗色
 * - night：夜間（最深）
 *
 * 色彩層級：
 * 1. 背景（bg）- 最深層
 * 2. 表面（surface）- 卡片、元件
 * 3. 凸起表面（surface-2）- 抽屜、面板
 * 4. 邊框、文字、操作顏色
 */

export type ThemeMode = 'warmpaper' | 'light' | 'dark' | 'night';

/**
 * 暖紙色主題（護眼、預設）
 * 基礎：柔和米色背景 + 深棕文字
 */
export const warmpaperTheme = {
  // 背景與表面層級
  'bg': '#faf6f1',
  'surface': '#f5ede6',
  'surface-2': '#ede4dd',
  'elevated': '#faf6f1',

  // 文字
  'text': '#3d3835',
  'text-secondary': '#6b6562',
  'text-tertiary': '#9b9290',

  // 邊框
  'border-default': '#dfd6ce',
  'border-strong': '#c4bbb3',

  // 主要操作（填充）
  'action-primary-bg': '#2d5016',
  'action-primary-fg': '#ffffff',
  'action-primary-hover': '#1f3a0f',

  // 次要操作（軟色）
  'action-secondary-bg': '#e8dfd4',
  'action-secondary-fg': '#6b5d4f',

  // 狀態色
  'status-success-bg': '#e0f2d6',
  'status-success-fg': '#2d5016',
  'status-warning-bg': '#fde8d1',
  'status-warning-fg': '#b8610b',
  'status-danger-bg': '#fde0db',
  'status-danger-fg': '#c41f1a',

  // 特殊
  'focus-ring': '#2d5016',
  'code-bg': '#f0e8e0',
} as const;

/**
 * 明亮主題（GitHub Primer Light 基礎）
 */
export const lightTheme = {
  'bg': '#ffffff',
  'surface': '#f6f8fa',
  'surface-2': '#eaeef2',
  'elevated': '#ffffff',

  'text': '#24292f',
  'text-secondary': '#57606a',
  'text-tertiary': '#8b949e',

  'border-default': '#d0d7de',
  'border-strong': '#b1bac4',

  'action-primary-bg': '#1a7f34',
  'action-primary-fg': '#ffffff',
  'action-primary-hover': '#116329',

  'action-secondary-bg': '#ddf4ff',
  'action-secondary-fg': '#0969da',

  'status-success-bg': '#dafbe1',
  'status-success-fg': '#116329',
  'status-warning-bg': '#fff8c5',
  'status-warning-fg': '#9e6a03',
  'status-danger-bg': '#ffebe6',
  'status-danger-fg': '#ae2a19',

  'focus-ring': '#0969da',
  'code-bg': '#f6f8fa',
} as const;

/**
 * 暗色主題
 */
export const darkTheme = {
  'bg': '#0d1117',
  'surface': '#161b22',
  'surface-2': '#21262d',
  'elevated': '#0d1117',

  'text': '#e6edf3',
  'text-secondary': '#8b949e',
  'text-tertiary': '#6e7681',

  'border-default': '#30363d',
  'border-strong': '#444c56',

  'action-primary-bg': '#238636',
  'action-primary-fg': '#ffffff',
  'action-primary-hover': '#2ea043',

  'action-secondary-bg': '#0d47a1',
  'action-secondary-fg': '#79c0ff',

  'status-success-bg': '#238636',
  'status-success-fg': '#7ee787',
  'status-warning-bg': '#9e6a03',
  'status-warning-fg': '#d29922',
  'status-danger-bg': '#da3633',
  'status-danger-fg': '#f85149',

  'focus-ring': '#58a6ff',
  'code-bg': '#161b22',
} as const;

/**
 * 夜間主題（最深）
 */
export const nightTheme = {
  'bg': '#0a0e27',
  'surface': '#151932',
  'surface-2': '#1f233a',
  'elevated': '#0a0e27',

  'text': '#e4e6eb',
  'text-secondary': '#9c9fa5',
  'text-tertiary': '#6b7280',

  'border-default': '#2d3748',
  'border-strong': '#3d4556',

  'action-primary-bg': '#2d5016',
  'action-primary-fg': '#ffffff',
  'action-primary-hover': '#3a6b1f',

  'action-secondary-bg': '#1e40af',
  'action-secondary-fg': '#93c5fd',

  'status-success-bg': '#1a4d2e',
  'status-success-fg': '#86efac',
  'status-warning-bg': '#7c2d12',
  'status-warning-fg': '#fdba74',
  'status-danger-bg': '#7c2d12',
  'status-danger-fg': '#fca5a5',

  'focus-ring': '#60a5fa',
  'code-bg': '#1f233a',
} as const;

export type ThemeTokens = Record<string, string>;

export const themes: Record<ThemeMode, ThemeTokens> = {
  warmpaper: warmpaperTheme as ThemeTokens,
  light: lightTheme as ThemeTokens,
  dark: darkTheme as ThemeTokens,
  night: nightTheme as ThemeTokens,
};

/**
 * 生成 CSS 變數字串
 */
export function generateThemeCss(mode: ThemeMode): string {
  const theme = themes[mode];
  const vars = Object.entries(theme)
    .map(([key, value]) => `--${key}: ${value};`)
    .join('\n  ');

  return `[data-theme="${mode}"] {
  ${vars}
}`;
}

/**
 * 取得當前主題
 */
export function getCurrentTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'warmpaper';

  const stored = localStorage.getItem('zonwiki:theme') as ThemeMode | null;
  if (stored && Object.keys(themes).includes(stored)) {
    return stored;
  }

  // 系統偏好
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'warmpaper';
}

/**
 * 設定主題
 */
export function setTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;

  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('zonwiki:theme', mode);

  // 觸發自訂事件供其他元件監聽
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: mode } }));
}

/**
 * Hook：使用主題
 */
export function useTheme() {
  const [theme, setThemeState] = React.useState<ThemeMode>('warmpaper');

  React.useEffect(() => {
    const current = getCurrentTheme();
    setThemeState(current);

    const handleChange = (e: CustomEvent<{ theme: ThemeMode }>) => {
      setThemeState(e.detail.theme);
    };

    window.addEventListener('themechange', handleChange as EventListener);
    return () =>
      window.removeEventListener('themechange', handleChange as EventListener);
  }, []);

  return { theme, setTheme };
}

// 動態匯入 React（避免 SSR 時錯誤）
import React from 'react';
