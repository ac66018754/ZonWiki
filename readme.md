# ZonWiki

個人知識庫，從散亂的筆記本（記事本、LINE Keep、Notion、OneNote 等）整理進一個可以瀏覽的網站。

> 詳細的 MVP 開發計畫、決策紀錄與進度，請見
> [`關於此Repo的計畫/MVP開發進度.md`](./關於此Repo的計畫/MVP開發進度.md)

---

## 想解決的問題

1. 筆記過於散亂，散落在記事本、LINE Keep、Notion、OneNote — 應該集中一處
2. Google 搜尋或問 AI 得到的答案，看過就忘 — 應該整理成筆記達成長期記憶
3. 直接從網頁複製貼上格式跑掉、難以閱讀 — 應該有一鍵美化

---

## 現在的樣子

ZonWiki 是一個**混合架構**：

- **真相來源**：`筆記區/` 下的 Markdown 檔案
- **寫筆記**：仍然走 VS Code + `腳本/format-md.ps1` + `腳本/auto-commit.ps1`
- **讀筆記**：透過網頁瀏覽（.NET 10 後端 + Next.js 前端 + PostgreSQL 索引）
- **留言、登入**等網頁專屬功能存在 PostgreSQL

```
筆記區/*.md ──(git push)──> GitHub
     │
     │ 後端 BackgroundService 定期掃描
     ▼
PostgreSQL ◀──── .NET 10 Web API ◀──── Next.js 前端
```

---

## 目錄結構

| 路徑 | 用途 |
|---|---|
| `筆記區/` | Markdown 筆記真相來源（AI、Programming、raw） |
| `腳本/` | 美化、繁簡轉換、auto-commit 等 PowerShell |
| `關於此Repo的計畫/` | 規劃文件、進度追蹤、自言自語 |
| `src/ZonWiki.Api/` | .NET 10 Web API 主專案 |
| `src/ZonWiki.Domain/` | Entities、DTOs、共用型別 |
| `src/ZonWiki.Infrastructure/` | EF Core、DbContext、Sync、Auth |
| `src/ZonWiki.SyncWorker/` | 預留：可獨立部署的 sync worker |
| `tests/` | xUnit 測試 |
| `frontend/` | Next.js 16 (App Router + TS + Tailwind 4) |
| `docker-compose.yml` | 本機 PostgreSQL |

---

## 寫筆記流程（不變）

1. 遇到問題、Google 或問 AI、得到答案
2. 若知道放哪 → 在 `筆記區/AI/` 或 `筆記區/Programming/...` 下新增/編輯 Markdown，貼上原始內容
3. 執行 `./腳本/format-md.ps1` → 用 Gemini API 美化排版
4. 若不知道放哪 → 在 `筆記區/raw/` 下開新檔案先丟著
5. 執行 `./腳本/auto-commit.ps1` → 自動 commit + push 到 GitHub

> 之後背景 Sync Worker 會自動把新檔案 / 變更同步進 DB，網頁就能看到。

---

## 本機啟動（網頁版）

### 前置需求
- Docker Desktop（給 PostgreSQL 用）
- .NET 10 SDK
- Node.js 20+（Next.js 16 需要）
- pnpm

### 步驟

```bash
# 1. 啟動 PostgreSQL（port 5433，避免和本機 Postgres 5432 衝突）
docker compose up -d

# 2. 啟動後端 API（會自動套 migrations 並做第一次 sync）
dotnet run --project src/ZonWiki.Api --launch-profile http
# → http://localhost:5009
# → /healthz 應該回 "Healthy"
# → /api/articles 應該列出筆記區裡的文章

# 3. 另開終端，啟動前端
cd frontend
pnpm install        # 第一次跑
pnpm run dev
# → http://localhost:3000
```

### 觸發手動同步

```bash
curl -X POST http://localhost:5009/api/sync/trigger
```

### 設定筆記資料夾路徑

預設在 `src/ZonWiki.Api/appsettings.Development.json`：

```json
"NotesSync": {
  "RootPath": "D:/Repos/SideProjects/ZonWiki/筆記區",
  "ScanInterval": "00:05:00"
}
```

### 設定 Google OAuth（可選）

未設定 ClientId/ClientSecret 時，網頁仍可瀏覽，只是不能登入留言。

```bash
cd src/ZonWiki.Api
dotnet user-secrets init
dotnet user-secrets set "Authentication:Google:ClientId" "你的-client-id"
dotnet user-secrets set "Authentication:Google:ClientSecret" "你的-client-secret"
```

Google Cloud Console 的 OAuth Callback URL 設為 `http://localhost:5009/signin-google`。

---

## 跑測試

```bash
dotnet test ZonWiki.slnx
```

> 測試覆蓋率為 MVP 等級，僅有 slug 與 ApiResponse 等核心邏輯的單元測試。
> 完整的 WebApplicationFactory + Testcontainers 整合測試列為 follow-up。

---

## 技術棧速查

| 層 | 技術 |
|---|---|
| 前端 | Next.js 16, React 19, Tailwind 4, TypeScript |
| 後端 | .NET 10, ASP.NET Core Minimal API, EF Core 10 |
| DB | PostgreSQL 16 (alpine, docker) |
| 認證 | Google OAuth 2.0 + Cookie auth |
| Markdown | Markdig (含 Wiki link `[[X]]` 解析) |
| 容器 | Docker Compose（目前只有 Postgres） |

---

## 文件導覽

- [關於此Repo的計畫/MVP開發進度.md](./關於此Repo的計畫/MVP開發進度.md) — **首先閱讀**：MVP 進度、決策、如何接手
- [關於此Repo的計畫/此專案的未來.md](./關於此Repo的計畫/此專案的未來.md) — 長期願景（基礎功能、進階功能、超進階功能）
- [關於此Repo的計畫/自言自語](./關於此Repo的計畫/自言自語) — 架構思辨記錄
