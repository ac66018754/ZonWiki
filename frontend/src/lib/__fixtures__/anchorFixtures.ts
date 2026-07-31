/**
 * 錨點保護測試的共用測資（feature/paragraph-links 包4）。
 *
 * 【重要】此檔是 jsdom 單元測試與 Playwright E2E 的「同一份」真相源——
 * 兩層必須 import 這裡，不得各自維護測資字串；否則「jsdom 與瀏覽器 textContent 一致」
 * 的主張只是兩份不同資料各自過關（計畫二輪復審裁決）。
 *
 * HTML 欄位為「後端 Markdig 對 markdown 欄位的實際輸出形狀」——刻意含粗體/清單/多段落，
 * 讓 Markdown→HTML→textContent 的座標落差（若有）能被測試揪出（純文字測資揪不出）。
 */

/** 1~100 情境（使用者原始例子）＋格式化內容：舊版含 50 與 51、52，新版刪去 50 與 52。 */
export const NUMBER_SCENARIO = {
  /** 舊內容（markdown）：含被引用的「50」與「51、52」段。 */
  oldMarkdown: [
    "# 數字清單",
    "",
    "**前段**說明文字。",
    "",
    "- 49、50、51、52、53",
    "",
    "後段還有其他內容。",
  ].join("\n"),
  /** 新內容（markdown）：50 與 52 被刪掉。 */
  newMarkdown: [
    "# 數字清單",
    "",
    "**前段**說明文字。",
    "",
    "- 49、51、53",
    "",
    "後段還有其他內容。",
  ].join("\n"),
  /** 錨定「50」的標註文字。 */
  anchorFifty: "50",
  /** 錨定「51、52」的標註文字。 */
  anchorFiftyOnePair: "51、52",
  /** 改版後仍存活的錨文字（負向對照：不得被誤判為斷）。 */
  anchorSurvivor: "後段還有其他內容",
} as const;

/**
 * 上述 markdown 經後端 `RenderToHtml` 的「實際輸出快照」（逐字元抄自真後端；含 Markdig
 * 自動產生的 heading id＝`<h1 id="section">`，手打字串容易漏掉、故以真輸出為準）。
 * jsdom 單元測試直接用此快照；E2E 會對真後端 render API 斷言 fixture 相等（由主控的 E2E 腳本執行），
 * 一旦後端渲染漂移、此快照過期，E2E 會抓到（jsdom 這層的 textContent 不受 id 屬性影響）。
 */
export const NUMBER_SCENARIO_HTML = {
  oldHtml:
    '<h1 id="section">數字清單</h1>\n<p><strong>前段</strong>說明文字。</p>\n' +
    "<ul>\n<li>49、50、51、52、53</li>\n</ul>\n<p>後段還有其他內容。</p>\n",
  newHtml:
    '<h1 id="section">數字清單</h1>\n<p><strong>前段</strong>說明文字。</p>\n' +
    "<ul>\n<li>49、51、53</li>\n</ul>\n<p>後段還有其他內容。</p>\n",
} as const;
