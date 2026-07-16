// =============================================================================
// ZonWiki 時間追蹤 — 今日／本週彙總小工具（Scriptable）
//
// 用途：在 iPhone 主畫面「被動」顯示今天或本週的時間統計（總時長、進行中、依分類），
//       不必打開 ZonWiki 網頁。iOS 會依系統排程自動刷新（通常數分鐘一次，非即時碼表）。
//
// 安裝：見 docs/iOS捷徑-時間追蹤.md 的「Scriptable 小工具」章節。
// 範圍切換：長按小工具 → 編輯小工具 → Parameter 填 "day" 或 "week"（不填＝day）。
// 建議尺寸：中或大（依分類清單較長）。
// =============================================================================

// ── 你要改的兩個值 ──────────────────────────────────────────────
const BASE = "https://zonwiki.pee-yang.com"; // 你的站台網址
const PAT = "在此貼上你的_API_權杖"; // 個人頁 → API 權杖 產生；請勿提交到公開 repo
// ───────────────────────────────────────────────────────────────

// 主題自適應顏色（亮底深字／暗底淺字，皆達 WCAG AA 對比）。
const COLORS = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  primary: Color.dynamic(new Color("#1a1a1a"), new Color("#f5f5f5")),
  secondary: Color.dynamic(new Color("#5f5f5f"), new Color("#a8a8ad")),
  accent: Color.dynamic(new Color("#1d4ed8"), new Color("#60a5fa")),
  chipBg: Color.dynamic(new Color("#f0f0f2"), new Color("#2c2c2e")),
};

// 範圍參數："day"（預設）或 "week"。
const scope = (args.widgetParameter || "day").trim().toLowerCase() === "week" ? "week" : "day";

/** 秒數 → 人類可讀時長（「32秒」「45分」「1時23分」）。 */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時` : `${h}時${m}分`;
}

/** 呼叫彙總端點。 */
async function fetchSummary() {
  const req = new Request(`${BASE}/api/time-entries/summary?scope=${scope}`);
  req.headers = { Authorization: `Bearer ${PAT}` };
  const body = await req.loadJSON();
  // 401 常見於 PAT 未填或過期；給明確訊息（loadJSON 對空 body 會丟籠統的 JSON 錯）。
  if (req.response && req.response.statusCode === 401) {
    throw new Error("PAT 未設定或已過期，請至個人頁重新產生");
  }
  if (!body || !body.success) throw new Error(body && body.error ? body.error : "讀取失敗");
  return body.data;
}

/** 建立小工具。 */
async function buildWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 14, 14);

  let data;
  try {
    data = await fetchSummary();
  } catch (err) {
    const t = widget.addText("⏱ 時間追蹤");
    t.font = Font.boldSystemFont(14);
    t.textColor = COLORS.primary;
    widget.addSpacer(6);
    const e = widget.addText(`無法讀取：${err.message}`);
    e.font = Font.systemFont(11);
    e.textColor = COLORS.secondary;
    widget.url = `${BASE}/`; // 讀取失敗時仍可點開網頁重試
    return widget;
  }

  // 標頭：⏱ 今日／本週 ＋ 進行中徽章。
  const header = widget.addStack();
  header.centerAlignContent();
  const title = header.addText(scope === "week" ? "⏱ 本週" : "⏱ 今日");
  title.font = Font.boldSystemFont(15);
  title.textColor = COLORS.primary;
  if (data.runningCount > 0) {
    header.addSpacer(6);
    const badge = header.addText(`進行中 ${data.runningCount}`);
    badge.font = Font.semiboldSystemFont(11);
    badge.textColor = COLORS.accent;
  }
  header.addSpacer();

  widget.addSpacer(4);

  // 總時長（大字）。
  const total = widget.addText(formatDuration(data.totalSeconds));
  total.font = Font.boldSystemFont(30);
  total.textColor = COLORS.primary;

  widget.addSpacer(8);

  // 依分類清單（最多顯示 5 項；空狀態給提示）。
  const cats = data.byCategory || [];
  if (cats.length === 0) {
    const empty = widget.addText("這段期間還沒有記錄");
    empty.font = Font.systemFont(12);
    empty.textColor = COLORS.secondary;
  } else {
    for (const cat of cats.slice(0, 5)) {
      const row = widget.addStack();
      row.centerAlignContent();
      const name = row.addText(
        (cat.runningCount > 0 ? "▶ " : "") + cat.category
      );
      name.font = Font.systemFont(12);
      name.textColor = COLORS.primary;
      name.lineLimit = 1;
      row.addSpacer();
      const dur = row.addText(formatDuration(cat.seconds));
      dur.font = Font.semiboldSystemFont(12);
      dur.textColor = COLORS.secondary;
      widget.addSpacer(3);
    }
    if (cats.length > 5) {
      const more = widget.addText(`＋還有 ${cats.length - 5} 個分類`);
      more.font = Font.systemFont(10);
      more.textColor = COLORS.secondary;
    }
  }

  // 點小工具 → 開 ZonWiki 首頁（可看完整面板；不想要可刪這行）。
  widget.url = `${BASE}/`;
  return widget;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium(); // 在 App 內執行時預覽
}
Script.complete();
