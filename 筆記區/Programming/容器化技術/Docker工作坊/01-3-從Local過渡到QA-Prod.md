# 01-3 — 從 Local 過渡到 QA / Prod

> 這篇已經脫離 Docker 的範圍，但它是「開發前準備」的自然延伸：
> 當你的專案準備離開本機，部署到 QA 和 Prod 時，要做哪些事？

---

## 前提

你在 Local 開發時，用 Docker 跑了一個 PostgreSQL，後端程式連的是這個 Docker DB。

現在專案要上線了，你需要讓後端改連到外部的 QA / Prod DB。

---

## 第一步：準備 QA、Prod 的機器

你需要兩種機器：

### 1. DB Server

用來跑資料庫。常見的選擇：

| 方式 | 範例 | 適合誰 |
|------|------|--------|
| 雲端託管 | AWS RDS、Azure SQL、GCP Cloud SQL | 不想自己維護 DB 的人 |
| 自己租 VM 裝 DB | 在 VPS 上裝 PostgreSQL | 想省錢、願意自己維護的人 |

一人工作室剛起步，通常**一台 DB Server 同時給 QA 和 Prod 用**，只是建兩個不同的資料庫：

```
同一台 DB Server
 ├── bruce_taskmanager_qa      ← QA 用的資料庫
 └── bruce_taskmanager_prod    ← Prod 用的資料庫
```

預算夠的話，QA 和 Prod 各一台比較安全，互不影響。

### 2. Application Server

用來跑你的後端程式（.NET API）。同樣可以是雲端服務或自己租的 VM。

前端如果是靜態網站，可以丟 CDN（Cloudflare Pages、Vercel、Netlify），不一定需要獨立的伺服器。

---

## 第二步：設定連線字串

目標是讓**同一份程式碼**在不同環境自動連到不同的 DB，不需要改程式。

### .NET 的環境切換機制

.NET 有內建的設定檔分層機制，靠一個環境變數 `ASPNETCORE_ENVIRONMENT` 決定載入哪份設定：

```
ASPNETCORE_ENVIRONMENT=Development  → 讀 appsettings.Development.json
ASPNETCORE_ENVIRONMENT=Staging      → 讀 appsettings.Staging.json
ASPNETCORE_ENVIRONMENT=Production   → 讀 appsettings.Production.json
```

> `Staging` 就是常說的 QA 環境，這是 .NET 的慣用名稱。

### 設定檔怎麼寫

```
你的後端專案/
├── appsettings.json                ← 共用設定（不放連線字串）
├── appsettings.Development.json    ← Local 開發用
├── appsettings.Staging.json        ← QA 環境用
└── appsettings.Production.json     ← Prod 環境用
```

#### appsettings.json — 共用設定

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  }
}
```

不放連線字串，因為每個環境的連線字串都不同。

#### appsettings.Development.json — Local 用 Docker DB

```json
{
  "ConnectionStrings": {
    "Default": "Host=bruce-db;Database=bruce_taskmanager;Username=admin;Password=dev123"
  }
}
```

這個可以 commit 進 git，因為只是本機開發用的密碼，不是真的。

#### appsettings.Staging.json 和 appsettings.Production.json

```json
{
  "ConnectionStrings": {
    "Default": ""
  }
}
```

**刻意留空**，真正的連線字串不寫在檔案裡（原因下面會說）。

---

## 第三步：在 QA / Prod 機器上設定環境變數

### 為什麼不把密碼寫在 appsettings.Production.json？

因為 `appsettings.Production.json` 會 commit 進 git。
如果密碼寫在裡面，任何能看到 repo 的人都知道你正式環境的 DB 密碼。

所以正式環境的做法是：**用環境變數覆蓋設定檔的值。**

### .NET 環境變數的命名規則

appsettings.json 裡的巢狀結構，用**雙底線 `__`** 取代層級：

```json
{
  "ConnectionStrings": {
    "Default": "..."
  }
}
```

對應的環境變數是：

```
ConnectionStrings__Default=Host=your-db-server.com;Database=bruce_taskmanager_prod;Username=prod_user;Password=超強密碼
```

### .NET 讀取設定的優先順序

```
環境變數（最高優先）
  ↓ 如果沒設，才往下找
appsettings.{Environment}.json
  ↓ 如果沒設，才往下找
appsettings.json（最低優先）
```

所以只要在 QA 機器上設好環境變數，程式就會自動用那組連線字串，不用改任何程式碼。

### 在機器上怎麼設環境變數？

依部署方式不同：

| 部署方式 | 怎麼設環境變數 |
|---------|--------------|
| 直接在 VM 上跑 | 在作業系統設定，或寫在啟動腳本裡 |
| 用 Docker 部署 | 寫在 `.env` 檔或 `docker-compose.yml` 的 `environment` |
| 雲端平台（Azure App Service、AWS ECS） | 在平台的管理介面設定 |

---

## 完整的流程圖

```
同一份程式碼，部署到不同環境：

┌─────────────────────────────────────────────────────────────┐
│  你的電腦（Local）                                           │
│                                                             │
│  ASPNETCORE_ENVIRONMENT=Development（預設值）                 │
│  → 讀 appsettings.Development.json                          │
│  → 連到 Docker DB（Host=bruce-db）                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  QA 伺服器                                                   │
│                                                             │
│  ASPNETCORE_ENVIRONMENT=Staging                              │
│  環境變數：ConnectionStrings__Default=Host=qa-db-server...   │
│  → 環境變數覆蓋 appsettings.Staging.json                     │
│  → 連到 QA DB                                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Prod 伺服器                                                 │
│                                                             │
│  ASPNETCORE_ENVIRONMENT=Production                           │
│  環境變數：ConnectionStrings__Default=Host=prod-db-server... │
│  → 環境變數覆蓋 appsettings.Production.json                  │
│  → 連到 Prod DB                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 常見問題

### 前端需要改嗎？

**不用。** 前端只會打 `/api/xxx`，它不知道後端連的是哪個 DB。

### Docker 相關的檔案需要改嗎？

**不用。** `Dockerfile` 和 `docker-compose.yml` 都不用動。
連線字串是透過環境變數注入的，跟 Docker 設定無關。

### 如果 QA / Prod 也用 Docker 部署呢？

那就在那台機器的 `.env` 或 `docker-compose.yml` 裡設不同的環境變數就好：

```yaml
# QA 的 docker-compose.yml
services:
  bruce-backend:
    build: ./bruce-backend
    environment:
      ASPNETCORE_ENVIRONMENT: Staging
      ConnectionStrings__Default: Host=qa-db-server.com;Database=bruce_taskmanager_qa;Username=qa_user;Password=qa密碼
```

程式碼完全不用改，只是環境變數不同。

### 我只有一個人，需要搞這麼多環境嗎？

剛開始可以簡化：

| 階段 | 建議做法 |
|------|---------|
| 剛開始開發 | Local + Docker DB 就好 |
| 準備給人用了 | 加一台 Prod，先跳過 QA |
| 使用者變多了 | 再加 QA，避免測試影響正式用戶 |

不用一開始就三個環境到齊，但**設定檔的分層架構一開始就寫好**，之後加環境就只是多設幾個環境變數的事。

---

## 一句話總結

> 不同環境跑的是**同一份程式碼**，差別只在於**環境變數不同**，程式自動讀到對的連線字串。
