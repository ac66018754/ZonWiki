# ZonWiki MVP 開發進度追蹤

> 此文件用於追蹤 ZonWiki 從純筆記 Repo 轉型為網頁應用的 MVP 開發進度。
> 若對話中斷或其他人接手，請先閱讀本文件 → `此專案的未來.md` → `自言自語` → `readme.md`。

**最後更新**：2026-04-15（**MVP 全部 Phase 完成**）

---

## 專案定位

- **現在**：個人 Markdown 筆記 Repo，靠 PowerShell 腳本做 AI 美化與自動提交
- **MVP 目標**：把筆記轉成可瀏覽的網頁，支援 Google 登入與文章留言（單人使用）
- **長期**：支援多使用者、範圍留言、TODO 清單、MCP 整合（見 `此專案的未來.md`）

---

## 架構路線（已決策）

採用 **混合路線（C）**：

- **真相來源（Source of Truth）**：`筆記區/` 下的 Markdown 檔案
- **寫作流程**：維持 VS Code + `format-md.ps1` + `auto-commit.ps1`，**不經過網頁**
- **DB 角色**：索引、快取 HTML、儲存留言、以及未來的 TODO / 權限 / 編輯紀錄
- **同步方式**：.NET `BackgroundService` 掃描檔案 → Upsert 到 Postgres

```
筆記區/*.md ──(git push)──> GitHub
     │
     │ FileSystemWatcher / polling
     ▼
.NET 10 SyncWorker ──> PostgreSQL ──> .NET 10 Web API ──> Next.js 前端
                           ▲
                           └── 留言、使用者、未來的進階功能
```

---

## 關鍵決策紀錄

| 日期 | 決策 | 內容 | 理由 |
|---|---|---|---|
| 2026-04-15 | 架構路線 | 混合（檔案為真相 + DB 為索引） | 保留既有寫作流、同時為進階功能鋪路 |
| 2026-04-15 | 後端 | .NET 10 Web API + EF Core + Npgsql | 作者機器已安裝 .NET 10（LTS），避免再裝 .NET 8 |
| 2026-04-15 | 資料庫 | PostgreSQL 16 | 作者偏好 |
| 2026-04-15 | 前端 | Next.js (App Router + TypeScript) | 生態完整、未來擴充彈性高 |
| 2026-04-15 | 網頁讀寫 | MVP 網頁**唯讀** | 避免雙寫衝突，寫作繼續走 VS Code + Git |
| 2026-04-15 | 多租戶 | MVP 僅單一使用者（作者本人） | 延後多租戶到 v2 |
| 2026-04-15 | 部署目標 | 本機 `docker compose` 跑得動即可 | 部署目標待 MVP 完成後再決定 |

---

## MVP 範圍

已納入：
- [x] 網頁化（Next.js 前端 + .NET API 後端）
- [x] Markdown 渲染 + Wiki 跳轉 `[[Other Page]]`
- [x] Google OAuth 登入
- [x] 文章留言（整篇層級）

延後到 v2 或之後：
- [ ] 網頁編輯筆記
- [ ] 多使用者 / 多租戶
- [ ] 範圍留言（框選文字留言）
- [ ] TODO List
- [ ] 編輯歷史
- [ ] MCP Server
- [ ] 圖片支援
- [ ] 「曾經問過的問題」AI 分類
- [ ] 「發想」語音/打字捕捉

---

## 開發階段

狀態：⚪ 未開始 / 🟡 進行中 / 🟢 完成 / 🔴 受阻

| Phase | 內容 | 狀態 | 備註 |
|---|---|---|---|
| 1 | 地基：solution 結構、docker-compose、EF Core、health check | 🟢 完成 | Postgres 改用 5433（5432 被本機 Postgres 佔用） |
| 2 | DB Schema：User / Category / Article / Comment + 審計欄位 | 🟢 完成 | 由 `ModelBuilderExtensions` 自動套用 `{Table}_{Field}` 命名 |
| 3 | Sync 引擎：掃描 `筆記區/` → Upsert 到 DB | 🟢 完成 | Markdig + 自製 `[[wiki link]]` 預處理；BackgroundService 5 分鐘掃一次 + `/api/sync/trigger` |
| 4 | Google OAuth 驗證 | 🟢 完成 | 機制就緒，未填 ClientId/Secret 時 endpoints 回 503/401（API 仍可用） |
| 5 | Web API endpoints | 🟢 完成 | categories / articles / comments / sync / me，統一 envelope |
| 6 | Next.js 前端 | 🟢 完成 | App Router、editorial 風格、留言元件、Google 登入 |
| 7 | 收尾（測試補強、README、部署說明） | 🟢 完成 | 10 個單元測試、README 重寫、本檔案更新 |

---

## 目錄結構（規劃）

```
ZonWiki/
├── src/
│   ├── ZonWiki.Api/              # .NET 10 Web API
│   ├── ZonWiki.Domain/           # Entities、DTOs
│   ├── ZonWiki.Infrastructure/   # EF Core、Migrations
│   └── ZonWiki.SyncWorker/       # 檔案同步 BackgroundService
├── tests/
│   ├── ZonWiki.Api.Tests/
│   └── ZonWiki.Infrastructure.Tests/
├── frontend/                     # Next.js App Router
├── docker-compose.yml
├── 筆記區/                       # 維持不動（真相來源）
├── 腳本/                         # 維持不動
└── 關於此Repo的計畫/             # 含本文件
```

---

## 資料庫命名規則（全域強制規則）

出自 `C:\Users\User\.claude\CLAUDE.md`，**務必遵守**：

- 表名 **PascalCase**，**不得含底線**：`Article` ✅、`User_Order` ❌
- 欄位格式 `{TableName}_{FieldName}`，FieldName 亦為 PascalCase
- 每個欄位**只允許一個底線**作為分隔
  - `Article_CreatedDateTime` ✅
  - `Article_Created_Date_Time` ❌
  - `article_createdDateTime` ❌
- 每張表必備六個審計欄位（除非有明確正當理由豁免）：
  1. `{Table}_Id`
  2. `{Table}_CreatedDateTime`
  3. `{Table}_CreatedUser`
  4. `{Table}_UpdatedDateTime`
  5. `{Table}_UpdatedUser`
  6. `{Table}_ValidFlag`

---

## 資料表預計清單

| 表名 | 用途 |
|---|---|
| `User` | Google 登入使用者 |
| `Category` | 分類（對應資料夾） |
| `Article` | 文章（對應 Markdown 檔案） |
| `Comment` | 文章留言 |

詳細欄位清單在 Phase 2 執行時加入本文件。

---

## 風險清單

| 風險 | 等級 | 對策 |
|---|---|---|
| Markdown XSS | HIGH | Markdig 關 raw HTML；需要時用 HtmlSanitizer 過濾 |
| FileSystemWatcher 在 Docker 不穩 | MEDIUM | 容器內改 polling + `/api/sync/trigger` webhook |
| Google OAuth callback URL 環境切換 | LOW | 用 `appsettings.{Env}.json` 管理 |
| 大量筆記 sync 效能 | LOW | MVP 筆記量級小；未來可加 Git diff 增量同步 |
| 雙寫衝突 | — | MVP 網頁唯讀，已從源頭避開 |

---

## 如何接手此專案

1. 閱讀順序：**本文件 → `此專案的未來.md` → `自言自語` → `readme.md`**
2. 檢視「開發階段」表格與下方「v2 待辦」清單
3. 嚴格遵守 `C:\Users\User\.claude\CLAUDE.md` 中的資料庫命名規則
4. 進階測試請使用 Testcontainers.PostgreSql 跑真實 Postgres，**不要 mock DB**

## 本機啟動步驟（MVP 已可運作）

```bash
# 1. 啟動 PostgreSQL
docker compose up -d   # → localhost:5433

# 2. 啟動後端 API（會自動套 migrations + 初次 sync）
dotnet run --project src/ZonWiki.Api --launch-profile http
# → http://localhost:5009/healthz
# → http://localhost:5009/api/articles

# 3. 啟動前端
cd frontend
pnpm install   # 第一次
pnpm run dev   # → http://localhost:3000
```

注意事項：
- **Node 必須 ≥ 20**。若 `node --version` 顯示 18.x，請用 nvm 切到 20.12.2 以上
- Postgres 用 **5433** 而非 5432（避開本機 Postgres）
- 筆記資料夾路徑寫死在 `appsettings.Development.json:NotesSync.RootPath`
- Google OAuth 未設定時不影響瀏覽，只是不能登入留言
- API 啟動時會自動套 migrations，DB schema 變更後重啟即可

## v2 / Follow-up 待辦

- [ ] 完整 WebApplicationFactory + Testcontainers.PostgreSql 整合測試
- [ ] CI/CD（GitHub Actions：build + test + 也許 docker push）
- [ ] 部署目標決定（Railway / Fly.io / 自架 VPS）
- [ ] 多使用者 / 多租戶
- [ ] 範圍留言（框選文字）
- [ ] TODO List 模組
- [ ] 編輯歷史
- [ ] MCP Server
- [ ] 圖片支援（筆記中的圖片）
- [ ] 「曾經問過的問題」AI 自動分類
- [ ] 「發想」捕捉 API + 行動裝置介面
- [ ] 移除 .NET 9 警告（`System.Security.Cryptography.Xml` 有低嚴重性弱點）

---

## 相關文件

- [此專案的未來.md](./此專案的未來.md) — 長期願景
- [自言自語](./自言自語) — 架構思辨記錄
- [../readme.md](../readme.md) — Repo 原始使用說明
