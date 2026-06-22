/**
 * 重點/標註顏色工具（純函式，無 UI 相依；供標註渲染與色彩選擇器共用）。
 */

/** 常用顏色快捷（畫重點 / 畫筆共用）。 */
export const PRESET_COLORS = [
  '#fef08a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#e9d5ff',
  '#fecaca', '#fed7aa', '#a7f3d0', '#fde68a', '#ddd6fe',
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#111827',
];

/** 舊版顏色「鍵」→ 色票（向後相容：早期重點存的是 yellow/pink… 等鍵）。 */
const LEGACY_KEY_COLORS: Record<string, string> = {
  yellow: '#fef3c7',
  pink: '#fbcfe8',
  blue: '#bfdbfe',
  green: '#bbf7d0',
  purple: '#e9d5ff',
  orange: '#fed7aa',
  red: '#fecaca',
};

/**
 * 把儲存的顏色值解析成可用色票：
 * - 以 # 開頭 → 視為十六進位色，直接用。
 * - 否則 → 視為舊版顏色鍵查表；查不到回退淡黃。
 * @param c 顏色字串（hex 或舊鍵）。
 */
export function resolveColor(c: string | null | undefined): string {
  if (!c) return '#fef08a';
  if (c.startsWith('#')) return c;
  return LEGACY_KEY_COLORS[c] ?? '#fef08a';
}
