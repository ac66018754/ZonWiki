// ZonWiki 時間追蹤 — 桌面置頂小工具（前端）。
//
// 兩種執行環境共用同一套 UI：
//  - Tauri（正式）：透過 window.__TAURI__.core.invoke 呼叫 Rust 命令，HTTP 由 Rust 發（無 CORS）。
//  - 一般瀏覽器（開發/驗證）：退回直接 fetch（需後端允許該來源的 CORS，設定存 localStorage）。
// 持續時間在前端每秒即時計算（now − 開始時間），故是真・即時跳秒，不必重打 API。

// Tauri v2：優先用 withGlobalTauri 暴露的 core.invoke，退而求其次用底層 __TAURI_INTERNALS__.invoke。
const invokeFn = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
const tauri = invokeFn ? { invoke: (cmd, args) => invokeFn(cmd, args) } : null;

// ── API 抽象層（Tauri invoke ↔ 瀏覽器 fetch） ──────────────────────────────
const api = {
  async loadConfig() {
    if (tauri) return tauri.invoke("load_config");
    return {
      base: localStorage.getItem("tw_base") || "",
      token: localStorage.getItem("tw_token") || "",
    };
  },
  async saveConfig(base, token) {
    if (tauri) return tauri.invoke("save_config", { base, token });
    localStorage.setItem("tw_base", base.trim().replace(/\/+$/, ""));
    localStorage.setItem("tw_token", token.trim());
  },
  async listRunning() {
    if (tauri) return tauri.invoke("list_running");
    return browserCall("GET", "/api/time-entries/running");
  },
  async createEntry(title, category, note) {
    if (tauri) {
      return tauri.invoke("create_entry", {
        title,
        category: category || null,
        note: note || null,
      });
    }
    const body = { title };
    if (category) body.category = category;
    if (note) body.note = note;
    return browserCall("POST", "/api/time-entries", body);
  },
  async stopEntry(id) {
    if (tauri) return tauri.invoke("stop_entry", { id });
    return browserCall("POST", `/api/time-entries/${id}/stop`, {});
  },
};

/** 瀏覽器退回模式：直接 fetch ZonWiki API（解析 { success, data, error } 信封）。 */
async function browserCall(method, path, body) {
  const base = localStorage.getItem("tw_base") || "";
  const token = localStorage.getItem("tw_token") || "";
  if (!base || !token) throw new Error("尚未設定站台網址或權杖，請先開設定填入");
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (json && json.success) return json.data;
  throw new Error(`${(json && json.error) || "請求失敗"}（HTTP ${res.status}）`);
}

// ── 元素 ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  badge: $("running-badge"),
  error: $("error"),
  newTitle: $("new-title"),
  newCategory: $("new-category"),
  startBtn: $("start-btn"),
  refreshBtn: $("refresh-btn"),
  settingsBtn: $("settings-btn"),
  body: $("entries-body"),
  empty: $("empty"),
  settings: $("settings"),
  cfgBase: $("cfg-base"),
  cfgToken: $("cfg-token"),
  cfgSave: $("cfg-save"),
  cfgCancel: $("cfg-cancel"),
};

// ── 狀態 ──────────────────────────────────────────────────────────────────
let running = []; // 目前進行中的項目清單
let busy = false; // 開始/結束進行中，避免重複送出
let pollTimer = null;
let tickTimer = null;

// ── 格式化 ────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");

/** UTC ISO → 本地「YYYY/MM/DD HH:mm」。 */
function formatStart(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 開始 ISO → 至今經過時間「HH:MM:SS」（小時可超過 24）。 */
function formatDuration(iso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ── 錯誤顯示 ──────────────────────────────────────────────────────────────
function showError(message) {
  els.error.textContent = `⚠️ ${message}`;
  els.error.hidden = false;
}
function clearError() {
  els.error.hidden = true;
}

// ── 繪製 ──────────────────────────────────────────────────────────────────
function render() {
  els.badge.hidden = running.length === 0;
  els.badge.textContent = `進行中 ${running.length}`;
  els.empty.hidden = running.length !== 0;

  els.body.textContent = "";
  for (const entry of running) {
    const tr = document.createElement("tr");

    const tdTitle = document.createElement("td");
    tdTitle.className = "col-title";
    tdTitle.textContent = entry.title;
    if (entry.category) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = entry.category;
      tdTitle.appendChild(chip);
    }

    const tdStart = document.createElement("td");
    tdStart.className = "col-start";
    tdStart.textContent = formatStart(entry.startedDateTime);

    const tdDur = document.createElement("td");
    tdDur.className = "col-dur";
    tdDur.dataset.started = entry.startedDateTime; // tick 用
    tdDur.textContent = formatDuration(entry.startedDateTime);

    const tdAct = document.createElement("td");
    tdAct.className = "col-act";
    const doneBtn = document.createElement("button");
    doneBtn.className = "btn-done";
    doneBtn.textContent = "完成";
    doneBtn.setAttribute("aria-label", `完成 ${entry.title}`);
    doneBtn.addEventListener("click", () => onStop(entry.id));
    tdAct.appendChild(doneBtn);

    tr.append(tdTitle, tdStart, tdDur, tdAct);
    els.body.appendChild(tr);
  }
}

/** 每秒只更新持續時間欄（不重建整表，避免閃動）。 */
function tick() {
  for (const cell of els.body.querySelectorAll(".col-dur")) {
    cell.textContent = formatDuration(cell.dataset.started);
  }
}

// ── 資料 ──────────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const data = await api.listRunning();
    running = Array.isArray(data) ? data : [];
    clearError();
    render();
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function onStart() {
  const title = els.newTitle.value.trim();
  if (!title || busy) return;
  busy = true;
  els.startBtn.disabled = true;
  try {
    await api.createEntry(title, els.newCategory.value.trim(), "");
    els.newTitle.value = "";
    els.newCategory.value = "";
    clearError();
    await refresh();
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    busy = false;
    els.startBtn.disabled = false;
  }
}

async function onStop(id) {
  if (busy) return;
  busy = true;
  try {
    await api.stopEntry(id);
    clearError();
    await refresh();
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    busy = false;
  }
}

// ── 設定面板 ──────────────────────────────────────────────────────────────
async function openSettings() {
  const cfg = await api.loadConfig();
  els.cfgBase.value = cfg.base || "";
  els.cfgToken.value = cfg.token || "";
  els.settings.hidden = false;
  els.cfgBase.focus();
}
function closeSettings() {
  els.settings.hidden = true;
}
async function saveSettings() {
  await api.saveConfig(els.cfgBase.value, els.cfgToken.value);
  closeSettings();
  startPolling();
  await refresh();
}

// ── 輪詢與計時 ────────────────────────────────────────────────────────────
function startPolling() {
  if (!pollTimer) pollTimer = setInterval(refresh, 5000); // 每 5 秒重抓清單
  if (!tickTimer) tickTimer = setInterval(tick, 1000); // 每 1 秒跳秒
}

// ── 事件與啟動 ────────────────────────────────────────────────────────────
els.startBtn.addEventListener("click", onStart);
els.newTitle.addEventListener("keydown", (e) => e.key === "Enter" && onStart());
els.newCategory.addEventListener("keydown", (e) => e.key === "Enter" && onStart());
els.refreshBtn.addEventListener("click", refresh);
els.settingsBtn.addEventListener("click", openSettings);
els.cfgSave.addEventListener("click", saveSettings);
els.cfgCancel.addEventListener("click", closeSettings);

(async function init() {
  const cfg = await api.loadConfig();
  if (!cfg.base || !cfg.token) {
    await openSettings(); // 首次啟動：先要求設定
  } else {
    startPolling();
    await refresh();
  }
})();
