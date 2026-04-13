# GitHub Actions 核心概念與實作範例

## 一、核心組成元件 (Core Concepts)

要理解 GitHub Actions，必須先搞懂這四個層級：

- **Workflow (工作流)**：最上層的自動化過程，儲存在專案目錄下的 `.github/workflows/*.yml`。
- **Events (事件)**：觸發 Workflow 的時機，例如 `push`、`pull_request` 或定時 `cron`。
- **Jobs (任務)**：一個 Workflow 可以包含多個 Job。預設情況下，這些 Job 是並行 (Parallel) 執行的。
- **Steps (步驟)**：Job 裡面的最小單位。每個 Step 可以執行一條指令（`run`）或是引用一個現成的動作（`uses`，即 Action）。

## 二、實作範例：自動化測試與編譯

假設你正在開發一個專案，希望每次 `push` 到 `main` 分支時，GitHub 都能自動幫你檢查程式碼。

### 1. 建立設定檔

在專案根目錄建立路徑：`.github/workflows/main.yml`

### 2. 撰寫內容 (YAML 格式)

```yaml
# Workflow 的名稱
name: GitHub CI Workflow

# 觸發條件
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]

# 具體要做的事
jobs:
  build-and-test:
    # 執行環境（GitHub 提供的虛擬機）
    runs-on: windows-latest 

    steps:
      # 1. 檢出程式碼 (固定動作)
      - name: Checkout code
        uses: actions/checkout@v4

      # 2. 設定執行環境 (以 .NET 為例)
      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '8.0.x'

      # 3. 執行指令
      - name: Restore dependencies
        run: dotnet restore

      - name: Build
        run: dotnet build --no-restore

      - name: Test
        run: dotnet test --no-build --verbosity normal
```

### 運作原理補充

身為工程師，你可能會好奇它是怎麼動起來的：

- **Runner (執行器)**：GitHub 會為你的每個 Job 啟動一個全新的虛擬機（或是 Docker 容器）。這意味著每個 Job 之間的環境是完全隔離的。如果你在 Job A 產生了檔案，Job B 預設是抓不到的（除非使用 `artifacts` 傳遞）。
- **Actions Marketplace**：`uses: actions/checkout@v4` 這種語法，本質上是去執行別人寫好的 GitHub Repo。這大大簡化了設定，像是設定 AWS 憑證、登入 Docker Hub 等複雜操作，都有官方或社群維護的 Action 可以直接用。
- **Secrets 管理**：涉及 API Key 或密碼時，絕對不能寫在 YAML 裡。你要在 GitHub Repo 的 `Settings > Secrets and variables > Actions` 裡面設定，然後在 YAML 中用 `${{ secrets.MY_KEY }}` 引用。
