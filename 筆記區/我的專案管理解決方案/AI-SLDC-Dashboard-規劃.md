# AI-SLDC Dashboard — 跨專案／跨裝置文件管理介面 規劃

> 此檔為構想階段文件，未來啟動實作時可作為 retrofit source material，依 `_rules/retrofit-guide.md` 轉成 PRD / tasks / decisions / current-state。

最後更新：2026-04-26

---

## Context

### 痛點
作為個人開發者，目前同時有 ZonWiki 等多個 repo，每個都有 `docs/_rules/` 底下的 AI-SLDC 文件群（task / issue / decision / current-state / session-log 等）。但：

1. **資料分散** — 沒有地方能一眼看到「我手頭所有專案的全貌」（Phase / In Progress / Blockers / 各 PRD requirement 的完成度）。
2. **md 對人不好操作** — 對 AI 與 git 友善，但人在處理「壓日期、姓名、Status enum、Severity enum」等結構性欄位時很痛，容易少填欄位（如 Approved By / Approved Date）。
3. **跨裝置** — PC + NB 兩台機器都會工作，希望在任一台上都能看見「我手上有哪些裝置、各裝置上有哪些專案、各專案進度如何」。
4. **進度可視化缺口** — 看完成度不該靠手點開每個 task，要能**一眼看出哪些完成、哪些沒**，且要能多層次（PRD Requirement / Phase / Task）。

### 解法概要
做一個 **.NET 10 Razor 本機網站**，每台裝置各跑一份。提供：

- **v1 跨裝置 + 跨專案儀表板**：看到所有裝置與其專案的 high-level 進度（透過 device-snapshot 機制同步）。
- **v1 多層次進度視覺化**：用 segmented bar + Kanban，一眼看出每個 PRD requirement 的 task 分布。
- **v1 簡易狀態切換**：用 dropdown / date picker 修改結構性欄位（task Status / Severity 等），同時自動補一筆 mini session log。

### v1 不做（明確排除）
- 完整 markdown 編輯器（內文回 VS Code 改）
- 新建文件（PRD/decision/issue 新建還是叫 AI 產）
- git auto-commit（git 變髒交給人類）
- cloud 部署、認證、多人

### 達成後的狀態
打開瀏覽器到 `http://localhost:5099`，頂部 nav 有「裝置切換器」（顯示 `MyPC` / `MyNB`），下方看到目前裝置上的所有專案卡片。每張卡片有：
- 專案名 + Phase
- 多色 segmented progress bar（一眼看出 task 各狀態分布）
- Blockers count
- 最新 session log 時間

按專案進去看到單一專案的 PRD requirement 進度條陣列、Tasks/Issues/Decisions 列表，可勾選 status，按下後 md 與 session log 同步寫回。

切到 `MyNB` 看到 NB 上的專案清單與進度（從 device-snapshot 讀），但只能看 high-level，要看具體 task 內文要切回那台機器。

---

## 架構

### 部署形態
- **每台裝置各跑一份本機 Razor server**：綁 `localhost:5099`，不對外。
- **Source of truth = md 檔**：UI 只是 view + form，**不用 DB**。
- **跨裝置整合 = device-snapshot 共用檔**（見下方「跨裝置 sync」）。

### 環境變數與設定
- 系統環境變數 `AISLDC_DEVICE` = `MyPC` 或 `MyNB`（每台設一次不動）
- `Program.cs` 啟動時讀此變數 → `AddJsonFile($"appsettings.{device}.json")`
- 設定檔結構：

  **`appsettings.json`（base，git tracked，所有裝置共用）：**
  ```json
  {
    "Operator": { "Name": "你的姓名" },
    "DeviceSnapshotPath": "<共用同步資料夾路徑>",
    "Devices": [
      { "Id": "MyPC", "DisplayName": "桌機" },
      { "Id": "MyNB", "DisplayName": "筆電" }
    ],
    "Projects": [
      { "Name": "ZonWiki", "OwnerDevice": "MyPC", "Path": "" },
      { "Name": "OtherProject", "OwnerDevice": "MyNB", "Path": "" }
    ]
  }
  ```
  base 列**所有裝置與所有專案**的 metadata（Name、OwnerDevice），但 Path 留空。

  **`appsettings.MyPC.json`（PC 本機特有，gitignored）：**
  ```json
  {
    "Projects": [
      { "Name": "ZonWiki", "Path": "D:\\Repos\\SideProjects\\ZonWiki" }
    ]
  }
  ```
  本機只填**該裝置上實際存在**的專案路徑。

  .NET 會自動 merge，最終 `ZonWiki` 的 Path 在 PC 上是實際路徑、在 NB 上是空（因為 OwnerDevice 是 MyPC，NB 上不需路徑）。

### 跨裝置 sync 機制（device-snapshot）
**核心觀念：每台裝置的 dashboard 把該裝置上各專案的 high-level summary 寫成一個 JSON snapshot 到共用位置，其他裝置從那讀。** Task / issue / decision 內文不寫入 snapshot — 想看內文還是要實際到該裝置。

**Snapshot 結構（每台裝置一份，檔名 `<deviceId>.json`）：**
```json
{
  "deviceId": "MyPC",
  "operatorName": "你",
  "lastSyncedAt": "2026-04-26T14:30:00",
  "projects": [
    {
      "name": "ZonWiki",
      "phase": "Development",
      "blockers": 1,
      "latestSessionLogAt": "2026-04-26T13:00",
      "requirements": [
        { "id": "F1", "title": "Markdown 渲染", "tasks": [
          { "id": "2026-04-15-render", "status": "Done" },
          { "id": "2026-04-16-wiki-link", "status": "Done" }
        ]},
        { "id": "F2", "title": "Wiki 跳轉", "tasks": [
          { "id": "2026-04-17-cross-link", "status": "In Progress" },
          { "id": "2026-04-18-broken-link", "status": "Approved" }
        ]}
      ],
      "looseTasks": [
        { "id": "2026-04-20-cleanup", "status": "Draft" }
      ]
    }
  ]
}
```

**Sync 觸發**：on-demand。當 dashboard 掃完當前裝置 fs 後，立刻寫一份 snapshot 到共用位置覆蓋舊的。讀其他裝置的 snapshot 也是 on-demand（切到那個 device 時讀）。

**共用位置**：可以是 OneDrive / Dropbox / Google Drive 同步資料夾，或一個專門的 git repo（dashboard-snapshots）。建議 **OneDrive 同步資料夾**最簡單（不用 commit、跨裝置秒同步）；git repo 適合想保留歷史的人。**這個位置由 `appsettings.json` 的 `DeviceSnapshotPath` 設定**。

### 寫回模式
所有寫回採「**直寫 md 檔 + 自動補 mini session-log**」：

當你在 dashboard 把某 task `Status: Draft` 改成 `Approved`：
1. 改該 task md：Status、Approved By（從 `Operator.Name`）、Approved Date（now）、Last Updated。
2. 同時 append `docs/session-logs/YYYY-MM-DD-HHmm-dashboard.md`：
   - `Operator: dashboard UI (<Operator.Name>)`
   - `Worked On: 把 task XYZ 從 Draft → Approved`
3. 不 commit，git status 變髒，由你自己 commit。
4. **完成後重寫該裝置的 device-snapshot**（讓其他裝置下次切過來看到最新進度）。

### 即時更新策略（不 polling）
- 切到任何頁面時 → 後端重讀該頁需要的 fs（含當前裝置的專案 + 重寫該裝置的 snapshot）
- 瀏覽器 `visibilitychange` 從 hidden → visible 時 → 觸發後端重讀（從 VS Code 切回網頁的場景）
- 手動「重新整理」按鈕

### 技術棧
- **.NET 10 + Razor Pages** + **HTMX**（做 status dropdown 即時更新與 visibilitychange 重新整理）
- **C# 12**
- **Markdig**：彈窗 rendered preview
- 自製 metadata parser（regex 解析 `Status: X` 形式的欄位區塊）
- **IMemoryCache** + 檔案 mtime：cache 解析結果
- 沒有 DB

---

## 進度視覺化（重點：要一眼看出）

進度條不顯示百分比數字，全部用顏色與圖示傳達。

### Status 配色（全站一致）
| Status | 顏色 | 符號 |
|---|---|---|
| Draft | 灰 | □ |
| Approved | 藍 | ◫ |
| In Progress | 黃 | ▣ |
| Blocked | 紅 | ✕ |
| Done | 綠 | ■ |

### 第 1 層：專案卡片（首頁）
每個專案一張卡片，內含一條多色 segmented bar，每段是一個 task：

```
┌──────────────────────────────────────────────────────────┐
│ ZonWiki                              Phase: Development  │
│                                                          │
│ ■■■■■■■▣▣◫□□  (12 tasks)                                 │
│ ↑ 7 Done, 2 In Progress, 1 Approved, 2 Draft             │
│                                                          │
│ ⚠ 1 Blocker · 最新 session log 1 小時前                    │
└──────────────────────────────────────────────────────────┘
```

一眼看出：這個專案總共 12 個 task，多數已 Done、有 2 個進行中、還有 2 個沒被 approve。

### 第 2 層：專案總覽頁 — PRD Requirement 進度
按 PRD requirement 把 task 分群，每個 requirement 一條進度條：

```
PRD Requirements:

F1  Markdown 渲染               ■■■                    ✓ Complete
F2  Wiki 跳轉 [[Other Page]]    ■■▣◫                   In Progress
F3  Google OAuth 登入           ■■                     ✓ Complete
F4  文章留言                    ▣◫□□                   In Progress
F5  範圍留言（v2 計劃）          □□□                    Not Started

未對應 requirement 的 task：
                                □□                     2 個 loose tasks
```

一眼看出：哪個 requirement 已完成（全綠 + ✓）、哪個還在做（混色）、哪個還沒動（全灰）。
各 requirement 來自 PRD 的 `### Functional Requirements` 表，task 透過 `## Related: Requirement F1` 對應。

### 第 3 層：專案 Phase 時間線
從 `current-state.md` 的 `Phase` 欄位讀：

```
Planning ──● Development ──○ Testing ──○ Staging ──○ Production
              ↑ 目前在這
```

### 第 4 層：Tasks 頁 — Kanban
單一專案的所有 task 按 status 分欄：

```
┌─ Draft ─────┬─ Approved ─┬─ In Progress ─┬─ Blocked ──┬─ Done ──────┐
│ ◯ task-19   │ ◫ task-15  │ ▣ task-12     │ ✕ task-08  │ ■ task-01   │
│ ◯ task-21   │ ◫ task-17  │ ▣ task-14     │            │ ■ task-02   │
│             │            │               │            │ ■ task-03   │
│             │            │               │            │ ■ task-07   │
│             │            │               │            │ ■ task-09   │
│             │            │               │            │ ■ task-11   │
│             │            │               │            │ ■ task-13   │
└─────────────┴────────────┴───────────────┴────────────┴─────────────┘
```

每個卡片可點開看 metadata、改 Status（dropdown）、開 VS Code（連結）。

### 跨裝置儀表板首頁
頂部裝置切換器；切到不是當前裝置時，從 device-snapshot 讀，並且明確標示「此資料是 N 分鐘前的 snapshot，要改變請到該裝置」。

```
[ MyPC（當前） ] [ MyNB（5 分鐘前 sync）]

ZonWiki              ■■■■■■■▣▣◫□□    1 blocker
OtherProject (MyNB)  ■■■▣□□□□        ⚠ 從 NB snapshot 讀，不能編輯
```

---

## 關鍵檔案 / 模組

新建獨立 repo `AI-SLDC-Dashboard`（**不放在被管理的 repo 裡**，避免循環依賴）。

```
AI-SLDC-Dashboard/
├── src/
│   └── Dashboard.Web/
│       ├── Pages/
│       │   ├── Index.cshtml                # 跨專案儀表板（含裝置切換）
│       │   ├── Project/[Name].cshtml       # 單一專案總覽（PRD requirement 進度）
│       │   ├── Tasks/[Project].cshtml      # Kanban 看板
│       │   ├── Issues/[Project].cshtml
│       │   ├── Decisions/[Project].cshtml
│       │   └── SessionLogs/[Project].cshtml
│       ├── Services/
│       │   ├── ProjectScanner.cs           # 掃當前裝置 fs
│       │   ├── MarkdownParser.cs           # 解析 metadata 欄位
│       │   ├── PrdParser.cs                # 從 prd.md 拉 Functional Requirements 表
│       │   ├── ProgressCalculator.cs       # 把 task 對應到 requirement、算 status 分布
│       │   ├── DocumentWriter.cs           # 寫回 md（含 mtime 樂觀鎖）
│       │   ├── SessionLogWriter.cs         # 自動補 mini session-log
│       │   ├── DeviceSnapshotWriter.cs     # 寫該裝置的 snapshot 到共用位置
│       │   └── DeviceSnapshotReader.cs     # 讀其他裝置的 snapshot
│       ├── Models/
│       │   ├── ProjectSummary.cs
│       │   ├── RequirementProgress.cs      # F1: [task1 Done, task2 InProgress]
│       │   ├── TaskDoc.cs / IssueDoc.cs / DecisionDoc.cs
│       │   ├── DeviceSnapshot.cs
│       │   └── SessionLogEntry.cs
│       ├── wwwroot/
│       │   └── css/                        # segmented bar、Kanban 樣式
│       ├── appsettings.json                # base（git tracked，所有裝置與專案 metadata）
│       ├── appsettings.MyPC.json           # gitignored
│       ├── appsettings.MyNB.json           # gitignored
│       └── Program.cs                      # 讀 AISLDC_DEVICE → load 對應 appsettings
├── tests/
│   └── Dashboard.Tests/
└── README.md
```

### 重要設計細節

**MarkdownParser**：解析欄位區塊 `Status: Draft` / `Severity: HIGH` 等。Steps、DoD 等內文以 string 保留。

**PrdParser**：解析 `prd.md` 的 `### Functional Requirements` 表，回傳 `[{ id: "F1", title: "..." }, ...]`。

**ProgressCalculator**：
- Input：所有 task + PRD requirement 清單
- 對每個 task 看 `## Related: Requirement F1` 拉 ID
- Output：`Map<RequirementId, TaskStatus[]>`，配上「looseTasks」（沒對應 requirement 的）

**DocumentWriter**：line-based 替換、自動 bump Last Updated、mtime 樂觀鎖。

**SessionLogWriter**：寫到 `docs/session-logs/YYYY-MM-DD-HHmm-dashboard.md`。

**DeviceSnapshotWriter / Reader**：
- Writer：每次當前裝置 fs 掃完 → 重寫 `<DeviceSnapshotPath>/<currentDevice>.json`
- Reader：切到其他裝置時讀 `<DeviceSnapshotPath>/<thatDevice>.json`
- 缺漏 / 過舊（>24 小時）的 snapshot 會在 UI 上加警示

---

## 驗證

### 建置
1. `dotnet build` 通過
2. `dotnet test` 通過（重點：MarkdownParser、PrdParser、ProgressCalculator、DocumentWriter、DeviceSnapshotWriter 單元測試）

### 啟動
3. 系統設 `AISLDC_DEVICE=MyPC` → `dotnet run` → `http://localhost:5099`
4. 首頁應看到 base appsettings.json 列出的所有專案中、`OwnerDevice == MyPC` 那些（其他專案在 device switcher 切過去才看到）

### 端到端（單裝置）
5. 把 ZonWiki 加進 base + appsettings.MyPC.json → 首頁應看到 ZonWiki 卡片，segmented bar 顯示 task 各狀態分布
6. 點 ZonWiki → 看到 PRD Requirements 進度條陣列（F1 全綠、F2 混色等）
7. 點 Tasks → Kanban 欄位顯示
8. 改某 task Status：
   - md 檔變更（Status / Approved By / Approved Date / Last Updated）✓
   - `docs/session-logs/` 多一個 `*-dashboard.md` ✓
   - `git status` 顯示 modified ✓
   - `<DeviceSnapshotPath>/MyPC.json` 也被重寫 ✓

### 樂觀鎖
9. 開兩個 dashboard 分頁都載同一 task → A 改完儲存成功 → B 不重整就改 → 應回報衝突

### 跨裝置
10. PC 上把 device-snapshot 寫到共用 OneDrive 路徑
11. NB 上設 `AISLDC_DEVICE=MyNB` → 啟 dashboard → 切到 MyPC → 應看到 PC 上 ZonWiki 的進度（從 snapshot 讀）
12. UI 標示「snapshot 來自 X 分鐘前」

---

## 預估工時
- 骨架（Razor + 設定 + 路由 + appsettings 機制）：1 天
- ProjectScanner + MarkdownParser + PrdParser：2 天
- ProgressCalculator + segmented bar + Kanban CSS：2 天
- DocumentWriter + 樂觀鎖 + SessionLogWriter：2 天
- DeviceSnapshotWriter/Reader + 裝置切換 UI：2 天
- 端到端串接 + on-focus refresh + VS Code 連結：1 天

**約 10 個工作日全職、3–4 週兼職可上線 v1。**

---

## 待決定的小事（實作前再敲定）
- `DeviceSnapshotPath` 用 OneDrive 路徑、Dropbox、還是另開一個 git repo？建議從 OneDrive 起步最簡單。
- 樣式要不要走某個既有 CSS framework（Tailwind / Bootstrap）還是自己寫？建議 Tailwind 最快做出 segmented bar 與 Kanban。
