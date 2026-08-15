/**
 * 記帳分析圖表——調色盤常數（分類色四主題陣列、熱圖 opacity 階梯、語意 token 名）。
 *
 * §11 硬規則：圖表顏色**不得**用 Recharts 預設色票或硬編 hex 當「單一組不隨主題切」。
 * 本檔的分類色是「四主題各一組**已用 dataviz validate_palette.js 驗證**的色」（設計許可做法），
 * 隨 `data-theme` 由 `useChartTheme()` 切換；語意/結構色則一律即時解析 globals.css 的 CSS 變數。
 */

/**
 * 四種顯示模式（對齊 globals.css 的 `data-theme`）。
 */
export type ThemeMode = "warmpaper" | "light" | "dark" | "night";

/**
 * 合法主題集合（供 MutationObserver 讀到未知值時回退）。
 */
export const THEME_MODES: readonly ThemeMode[] = ["warmpaper", "light", "dark", "night"];

/**
 * 分類佔比環圈的固定序 8 色（blue, aqua, yellow, green, violet, red, magenta, orange）。
 *
 * 取自 dataviz `references/palette.md` 的驗證調色盤（Machado-2009 CVD 合格）：
 *   - 淺色系（warmpaper／light）：對 `#fefcfa`／`#f6f8fa` 卡面，validate_palette 四項無硬 FAIL
 *     （aqua/yellow/magenta 對淺底 <3:1 為 WARN → 靠 legend＋icon＋文字 relief）。
 *   - 暗色系（dark／night）：對 `#161b22`／`#0d1117` 卡面全 ≥3:1；最差相鄰 CVD ΔE≈10.3（floor band）
 *     → 同樣靠 legend/直接標籤 relief。
 * **固定序、不循環**：第 9+ 分類由 `foldCategories()` 折成「其他」（第 8 槽 orange）。
 */
export const CATEGORICAL_BY_THEME: Record<ThemeMode, string[]> = {
  warmpaper: [
    "#2a78d6", "#1baf7a", "#eda100", "#008300",
    "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
  ],
  light: [
    "#2a78d6", "#1baf7a", "#eda100", "#008300",
    "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
  ],
  dark: [
    "#3987e5", "#199e70", "#c98500", "#008300",
    "#9085e9", "#e66767", "#d55181", "#d95926",
  ],
  night: [
    "#3987e5", "#199e70", "#c98500", "#008300",
    "#9085e9", "#e66767", "#d55181", "#d95926",
  ],
};

/**
 * 熱圖非零桶（1..5）的 opacity 階梯（單一色相＋明度＝CVD 安全的 sequential 編碼）。
 * base 色由 token `--action-primary-bg` 提供（主題感知綠）；桶 0（無消費）另用 surface-secondary。
 * 下限 0.4（審查 MEDIUM／§11）：原 0.18 的最低桶對卡面僅 1.2–1.35，實質不可見；提高到 0.4 後
 * 桶 1 vs 卡面升到 1.6–2.1（四主題實算），最低消費日清楚可見、五級仍可辨。
 * 熱圖最低桶在保留 5 級下無法各自達 3:1（sequential 天性），但**色非唯一載體**
 *（每格 aria-label＋title 給金額、下方離散 legend「少→多」），符合準則。
 */
export const HEATMAP_OPACITY_LADDER: readonly number[] = [0.4, 0.55, 0.7, 0.85, 1.0];

/** 熱圖非零桶數（與 HEATMAP_OPACITY_LADDER 長度一致）。 */
export const HEATMAP_BUCKETS = 5;

/** 分類環圈顯示槽數上限（含「其他」）。 */
export const CATEGORY_MAX_SLOTS = 8;

/**
 * 近 N 月趨勢的預設月數（僅用於 SWR 快取鍵；實際 N 由後端 `Expense:AnalyticsTrendMonths` 決定，
 * 與此預設一致＝6，圖表一律渲染後端實回的陣列長度）。
 */
export const TREND_MONTHS = 6;

/**
 * 商家 Top N 的預設 N（僅用於 SWR 快取鍵；實際 N 由後端 `Expense:AnalyticsMerchantTopN` 決定＝10，
 * 後端 handler 未讀 topN 查詢參數，圖表一律渲染後端實回的商家陣列）。
 */
export const MERCHANT_TOP_N = 10;
