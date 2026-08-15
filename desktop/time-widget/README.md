# ZonWiki 時間追蹤 — Windows 桌面置頂小工具（Tauri）

iPhone 有 iOS 捷徑＋Scriptable 小工具；這支是 **Windows 版對應**：一個**永遠浮在最上層**的小視窗，
不必打開 ZonWiki 網頁，就能新增計時、即時看到進行中的項目、一鍵完成。與網頁／iOS 是**同一批資料**
（都打同一組 ZonWiki API）。

```
┌──────────────────────────────────────────────┐
│ ⏱ 時間追蹤  進行中 2              ⟳   ⚙        │
│ ┌───────────────┐ ┌──────────┐  ┌────────┐   │
│ │ 做什麼？(名稱) │ │ 分類(可選)│  │ ▶ 開始 │   │
│ └───────────────┘ └──────────┘  └────────┘   │
│ 目前項目      開始時間          持續時間        │
│ 練習唱歌 興趣  2026/07/29 06:25  00:00:19 完成 │
│ 掃廁所   家事  2026/07/29 06:25  00:00:21 完成 │
└──────────────────────────────────────────────┘
```

## 技術

- **Tauri 2**（Rust 後端 ＋ 系統 WebView2 前端）——成品小、記憶體低。
- 前端純 HTML/CSS/JS（無打包工具）：`src/`。
- 所有 ZonWiki API 呼叫都在 **Rust 端**（`reqwest`）發送，**繞過 WebView 的 CORS**，PAT 不寫死在程式碼。
- 持續時間在前端每秒即時計算（`現在 − 開始時間`），是真・即時跳秒。

## 需要的環境（自行建置時）

- **Rust**（rustup）、**Node.js 20+**、**WebView2 執行環境**（Windows 11 內建）、**Visual Studio C++ 建置工具**（MSVC）。

## 開發與建置

```powershell
cd desktop/time-widget
npm install

# 開發模式（改前端即時反映）
npm run tauri dev

# 產生正式執行檔＋安裝檔（MSI／NSIS，位於 src-tauri/target/release/bundle/）
npm run tauri build
# 只要執行檔、不要安裝檔：
npm run tauri build -- --no-bundle   # → src-tauri/target/release/time-widget.exe
```

## 首次使用

1. 於 ZonWiki「個人頁 → API 權杖」產生一把 PAT。
2. 啟動小工具 → 第一次會跳「設定」→ 填 **ZonWiki 網址**（如 `https://zonwiki.pee-yang.com` 或本機
   `http://localhost:5009`）與 **PAT** → 儲存。
3. 設定存在作業系統的 app config 目錄（`config.json`），不在 repo。

## 用法

- **新增**：上方輸入名稱（可加分類）→「▶ 開始」。
- **看進行中**：表格每 5 秒重抓、持續時間每秒跳。
- **完成**：點該列「完成」即結束計時。
- **置頂**：視窗永遠浮在其他程式最上層（`alwaysOnTop`，見 `src-tauri/tauri.conf.json`）。
- 開機自動啟動：把 `time-widget.exe`（或安裝後的捷徑）放進「啟動」資料夾（`shell:startup`）。

## 用到的 ZonWiki API（皆帶 `Authorization: Bearer <PAT>`）

| 動作 | 方法 · 路徑 |
|---|---|
| 進行中清單 | `GET /api/time-entries/running` |
| 開始計時 | `POST /api/time-entries` `{ title, category?, note? }` |
| 完成 | `POST /api/time-entries/{id}/stop` |

## 檔案結構

```
desktop/time-widget/
├─ src/                     前端（index.html / app.js / styles.css）
└─ src-tauri/
   ├─ src/lib.rs            Rust 命令：load/save 設定、list_running、create、stop（reqwest）
   ├─ tauri.conf.json       視窗設定（alwaysOnTop、尺寸）＋打包設定
   └─ Cargo.toml
```
