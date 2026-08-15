// =============================================================================
// ZonWiki 時間追蹤 — 進行中項目小工具（Scriptable，可點結束）
//
// 用途：在 iPhone 主畫面顯示目前正在計時的項目；點某一列 → 跳去一個「結束計時（確認）」
//       捷徑，二次確認後結束那一筆（防手誤）。點完會短暫離開桌面去跑捷徑再回來，
//       且小工具要等 iOS 下次刷新才更新清單（widget 是快照，非即時）。
//
// 前置：需先在「捷徑」App 建一個名為「結束計時（確認）」的捷徑（見
//       docs/iOS捷徑-時間追蹤.md），它會接收項目 id、跳確認框、確定後 POST 結束。
// 建議尺寸：中或大（小尺寸只允許單一點擊區、無法逐列點）。
// =============================================================================

// ── 你要改的三個值 ──────────────────────────────────────────────
const BASE = "https://zonwiki.pee-yang.com"; // 你的站台網址
const PAT = "在此貼上你的_API_權杖"; // 個人頁 → API 權杖 產生；請勿提交到公開 repo
const STOP_SHORTCUT_NAME = "結束計時（確認）"; // 你建立的確認捷徑名稱（要一字不差）
// ───────────────────────────────────────────────────────────────

const COLORS = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  primary: Color.dynamic(new Color("#1a1a1a"), new Color("#f5f5f5")),
  secondary: Color.dynamic(new Color("#5f5f5f"), new Color("#a8a8ad")),
  accent: Color.dynamic(new Color("#1d4ed8"), new Color("#60a5fa")),
};

/** 秒數 → 「1時23分」。 */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時` : `${h}時${m}分`;
}

/** 取得進行中項目清單。 */
async function fetchRunning() {
  const req = new Request(`${BASE}/api/time-entries/running`);
  req.headers = { Authorization: `Bearer ${PAT}` };
  const body = await req.loadJSON();
  // 401 常見於 PAT 未填或過期；給明確訊息（loadJSON 對空 body 會丟籠統的 JSON 錯）。
  if (req.response && req.response.statusCode === 401) {
    throw new Error("PAT 未設定或已過期，請至個人頁重新產生");
  }
  if (!body || !body.success) throw new Error(body && body.error ? body.error : "讀取失敗");
  return body.data || [];
}

/** 組出「點此列 → 跑結束確認捷徑並帶入 id」的深層連結。 */
function stopShortcutUrl(entryId) {
  const name = encodeURIComponent(STOP_SHORTCUT_NAME);
  const input = encodeURIComponent(entryId);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${input}`;
}

async function buildWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 14, 14);

  const title = widget.addText("⏱ 進行中");
  title.font = Font.boldSystemFont(15);
  title.textColor = COLORS.primary;
  widget.addSpacer(6);

  let running;
  try {
    running = await fetchRunning();
  } catch (err) {
    const e = widget.addText(`無法讀取：${err.message}`);
    e.font = Font.systemFont(11);
    e.textColor = COLORS.secondary;
    widget.url = `${BASE}/`; // 讀取失敗時仍可點開網頁重試
    return widget;
  }

  if (running.length === 0) {
    const empty = widget.addText("目前沒有進行中的項目");
    empty.font = Font.systemFont(12);
    empty.textColor = COLORS.secondary;
    widget.url = `${BASE}/`;
    return widget;
  }

  const now = Date.now();
  for (const entry of running.slice(0, 5)) {
    const elapsed = (now - new Date(entry.startedDateTime).getTime()) / 1000;

    // 整列可點：點下去 → 跑「結束計時（確認）」捷徑並帶入此項目 id。
    const row = widget.addStack();
    row.centerAlignContent();
    row.url = stopShortcutUrl(entry.id);

    const stop = row.addText("⏹ ");
    stop.font = Font.systemFont(13);
    stop.textColor = COLORS.accent;

    const label = row.addText(entry.title);
    label.font = Font.systemFont(13);
    label.textColor = COLORS.primary;
    label.lineLimit = 1;

    row.addSpacer();

    const dur = row.addText(formatDuration(elapsed));
    dur.font = Font.semiboldSystemFont(12);
    dur.textColor = COLORS.secondary;

    widget.addSpacer(6);
  }

  if (running.length > 5) {
    const more = widget.addText(`＋還有 ${running.length - 5} 項`);
    more.font = Font.systemFont(10);
    more.textColor = COLORS.secondary;
  }

  const hint = widget.addText("點項目＝結束（會再確認一次）");
  hint.font = Font.systemFont(9);
  hint.textColor = COLORS.secondary;
  return widget;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
