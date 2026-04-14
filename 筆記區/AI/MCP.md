# MCP 完整指南:從理論到實戰

> **MCP(Model Context Protocol)** 是 Anthropic 制定的開放協定,讓 AI Agent 能透過統一介面連接外部工具、資料來源或服務。
> 本文整合 MCP 的**理論基礎**、**底層機制**與**實戰安裝管理**,以 Playwright MCP 為主要範例,適用 Windows / macOS / Linux。

---

## 目錄

### Part 1:理論篇 — 搞懂 MCP 是什麼

1. [MCP 的一句話定義](#1-mcp-的一句話定義)
2. [MCP ≠ REST API](#2-mcp--rest-api)
3. [JSON-RPC:MCP 的訊息基礎](#3-json-rpcmcp-的訊息基礎)
4. [stdio:MCP 最常用的傳輸層](#4-stdiomcp-最常用的傳輸層)
5. [MCP 規範的三大能力類型](#5-mcp-規範的三大能力類型)

### Part 2:原理篇 — 它到底怎麼運作

6. [Client 端的完整生命週期](#6-client-端的完整生命週期)
7. [動態載入 vs 啟動載入](#7-動態載入-vs-啟動載入)
8. [與 LSP 的類比](#8-與-lsp-的類比)

### Part 3:實戰篇 — 安裝、使用、管理

9. [前置需求](#9-前置需求)
10. [安裝 MCP(三種方式)](#10-安裝-mcp三種方式)
11. [驗證安裝](#11-驗證安裝)
12. [如何使用 MCP](#12-如何使用-mcp)
13. [暫停使用 MCP](#13-暫停使用-mcp)
14. [刪除 MCP](#14-刪除-mcp)

### Part 4:附錄

15. [疑難排解](#15-疑難排解)
16. [Playwright MCP 能做什麼](#16-playwright-mcp-能做什麼)
17. [延伸閱讀](#17-延伸閱讀)

---

# Part 1:理論篇

## 1. MCP 的一句話定義

> **MCP 是一份由 Anthropic 制定的開放規範,定義 AI Agent 與外部工具之間「怎麼對話」的統一標準。**

### 角色分工

| 角色 | 做什麼 | 範例 |
|---|---|---|
| **規範制定者** | 寫 spec、維護版本 | Anthropic |
| **MCP Server 作者** | 按規範暴露能力 | Microsoft(Playwright MCP)、MCP 官方(GitHub MCP) |
| **AI Agent 製造商** | 按規範實作 Client 端 | Anthropic(Claude Code)、Cursor、Cline、Zed |

### 為什麼要有規範

因為有統一規範,**同一個 MCP Server 可以被多個 Agent 共用**。Playwright MCP 裝好後,Claude Code 能用、Cursor 能用、Cline 也能用 — 不需要各自為每個 Agent 寫一份整合程式。這解決的是經典的 **M×N 整合爆炸問題**。

### 為什麼要用 MCP?

- **擴充能力**:讓 AI Agent 能操作瀏覽器、查資料庫、讀 Figma 等
- **標準化**:不同工具使用同一套協定,安裝/設定邏輯一致
- **可組合**:同時啟用多個 MCP,Agent 會依任務自動選用

> **注意**:MCP 會佔用 context window。官方建議同時啟用**不超過 10 個**,避免影響回應品質。

---

## 2. MCP ≠ REST API

這是最容易搞混的地方。

| 維度 | REST API | MCP |
|---|---|---|
| 底層協定 | HTTP | JSON-RPC 2.0 |
| 呼叫風格 | `GET /users/123` | `{"method": "tools/call", "params": {...}}` |
| 能力發現 | 通常靠 OpenAPI/Swagger 文件 | 協定內建 `tools/list` 方法 |
| 傳輸層 | 幾乎只有 HTTP | stdio / HTTP + SSE / Streamable HTTP |
| 狀態 | 通常無狀態 | 有狀態(有 session、握手) |

**關鍵差異**:REST 讓你用 URL 描述「要什麼資源」;MCP 讓你用方法名稱描述「要呼叫什麼動作」。MCP 本質是 **RPC(Remote Procedure Call,遠端程序呼叫)**,不是 REST。

---

## 3. JSON-RPC:MCP 的訊息基礎

### 定義

**JSON-RPC** 是一個**輕量的遠端程序呼叫協定**,用 JSON 當資料格式。它只定義「訊息長什麼樣」,不管底層用什麼傳(stdio、TCP、HTTP、WebSocket 都行)。

- 最早版本是 **JSON-RPC 1.0**(2005 年)
- MCP 用的是 **JSON-RPC 2.0**(2010 年正式發佈)
- 規範極短,整份 spec 只有幾頁

### 為什麼叫「RPC」

RPC = Remote Procedure Call。核心理念是**讓呼叫遠端函式感覺像呼叫本機函式**:

```python
# 本機呼叫
result = browser_navigate(url="https://example.com")

# 遠端呼叫(透過 JSON-RPC)
# Client 把函式名 + 參數打包成 JSON 送出,等 Server 回傳結果
```

### JSON-RPC 2.0 的四種訊息類型

#### (1) Request — 有 id,需要回應

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "browser_navigate",
    "arguments": { "url": "https://example.com" }
  }
}
```

| 欄位 | 意義 |
|---|---|
| `jsonrpc` | 必須是 `"2.0"`,表示版本 |
| `id` | 識別用,Server 回應時會帶同一個 id |
| `method` | 要呼叫的方法名稱 |
| `params` | 參數(可以是物件或陣列) |

#### (2) Response — 成功回應

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "Navigated to https://example.com" }
    ]
  }
}
```

#### (3) Error — 錯誤回應

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": { "field": "url", "reason": "not a valid URL" }
  }
}
```

標準錯誤碼:`-32700` parse error、`-32600` invalid request、`-32601` method not found、`-32602` invalid params、`-32603` internal error。

#### (4) Notification — 沒有 id,不需要回應

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": { "progress": 0.5, "message": "Downloading..." }
}
```

用來傳送「我不需要你回我」的訊息,例如進度更新、日誌。沒有 `id` 就代表是 notification。

### 為什麼 MCP 選 JSON-RPC?

1. **超輕量** — spec 只有幾頁,實作簡單
2. **傳輸無關** — 可以跑在 stdio、HTTP、WebSocket 上
3. **雙向** — Client 可以呼叫 Server,Server 也可以呼叫 Client
4. **有先例** — LSP(Language Server Protocol)也用 JSON-RPC,社群已經熟悉

> 想了解 JSON-RPC 與其他 API 風格的差異,參見 [../Programming/API.md](../Programming/API.md)。

---

## 4. stdio:MCP 最常用的傳輸層

### 定義

**stdio = standard input/output(標準輸入輸出)**,是作業系統的基礎概念:**每個程序(process)啟動時都會自動獲得三個資料流**。

| 串流 | 縮寫 | 檔案描述子 | 預設接到哪 |
|---|---|---|---|
| Standard Input | `stdin` | 0 | 鍵盤 / 前一個程序的輸出 |
| Standard Output | `stdout` | 1 | 終端螢幕 / 下一個程序的輸入 |
| Standard Error | `stderr` | 2 | 終端螢幕(錯誤訊息) |

管線(pipe)`cat file.txt | grep error` 就是把前面的 stdout 接到後面的 stdin。

### MCP 怎麼用 stdio

當 Claude Code 啟動一個 stdio 類型的 MCP Server 時,流程大致是:

```
Claude Code(parent process)
  │
  ├─ spawn 子程序: npx -y @playwright/mcp
  │
  ├─ 接管子程序的 stdin  ← Claude 寫 JSON-RPC request 進去
  ├─ 接管子程序的 stdout ← Claude 從這讀 JSON-RPC response
  └─ 接管子程序的 stderr ← 通常用來印 log / 錯誤訊息
```

### 實際訊息範例

**Claude Code 寫進 MCP 的 stdin**(每行一個 JSON):
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}
```

**MCP 從自己的 stdout 回應**:
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05",...}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Navigated successfully"}]}}
```

兩邊透過 OS 管線互傳 JSON 字串,就是這麼簡單。

### 為什麼用 stdio 而不是 HTTP?

| 特性 | stdio | HTTP |
|---|---|---|
| 啟動成本 | 低(fork 子程序) | 高(要起 server、監聽 port) |
| 安全性 | 高(只在本機、父程序掌控) | 低(可能被其他程序連上) |
| 設定複雜度 | 幾乎零 | 要處理 port、TLS、CORS |
| 跨網路 | 不行 | 行 |

**結論**:stdio 特別適合「本機工具」這種場景 — 輕量、快速、安全。遠端 MCP(例如 Vercel MCP)才會用 HTTP + SSE。

### stdio MCP 的小陷阱

- **不能把 log 印到 stdout** — 因為 stdout 被 JSON-RPC 佔用了,隨便印東西會污染協定。log 要印到 `stderr`。
- **程序結束 = 連線斷掉** — stdio MCP 是子程序,Agent 關掉它就死了。
- **每個 Agent session 各自啟動一個** — 不是共用的,每個 session 都會重新 spawn 子程序。

---

## 5. MCP 規範的三大能力類型

MCP 不只定義「呼叫函式」,而是三種資源:

| 類型 | 用途 | 範例 | 類比 |
|---|---|---|---|
| **Tools** | AI 可呼叫的動作(有副作用) | `browser_navigate`、`browser_click` | 函式 |
| **Resources** | AI 可讀取的資料(唯讀) | 檔案內容、資料庫 schema、API 文件 | 檔案 |
| **Prompts** | 預寫好的提示模板 | 「審查這段程式碼」模板 | 範本 |

### 對應的 JSON-RPC 方法

| 類型 | 列出 | 讀取/呼叫 |
|---|---|---|
| Tools | `tools/list` | `tools/call` |
| Resources | `resources/list` | `resources/read` |
| Prompts | `prompts/list` | `prompts/get` |

多數日常使用場景以 **Tools** 為主,Resources 與 Prompts 在特定工具(例如文件查詢類、對話模板類 MCP)會發揮作用。

---

# Part 2:原理篇

## 6. Client 端的完整生命週期

AI Agent 製造商實作 Client 時,必須按以下順序處理:

```
┌─────────────────────────────────────────────────────────┐
│  1. Spawn / Connect                                     │
│     啟動 MCP Server 子程序(stdio)或建立連線(http)    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  2. Handshake(握手)                                   │
│     Client → initialize(protocolVersion, capabilities)  │
│     Server → initializeResult(serverInfo, capabilities)  │
│     Client → notifications/initialized                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  3. Capability Discovery(能力發現)                    │
│     Client → tools/list     (取得可用工具)             │
│     Client → resources/list (取得可讀資源)             │
│     Client → prompts/list   (取得提示模板)             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  4. Tool Schema Injection(工具定義注入)               │
│     把 tools/list 回來的 JSON Schema 塞進 LLM 的        │
│     system prompt / tool definitions,讓模型「知道」    │
│     自己有哪些工具可以呼叫                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  5. Call Translation(呼叫轉譯)                        │
│     LLM 決定用某個工具                                  │
│       ↓                                                 │
│     Agent 收到 LLM 的 tool_use 事件                     │
│       ↓                                                 │
│     轉成 tools/call JSON-RPC request 送給 MCP           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  6. Result Re-injection(回應回灌)                     │
│     MCP 回傳 JSON-RPC response                          │
│       ↓                                                 │
│     Agent 轉成 tool_result 格式塞回 LLM                 │
│       ↓                                                 │
│     LLM 根據結果繼續推理 / 回應使用者                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  7. Shutdown                                            │
│     Session 結束時關閉子程序 / 斷開連線                 │
└─────────────────────────────────────────────────────────┘
```

---

## 7. 動態載入 vs 啟動載入

### 多數 MCP Client 的做法

工具清單是在 **session 啟動當下**一次載入的,之後不會動態刷新 — 所以中途裝新 MCP 必須**重啟** Agent 才能使用。這是早期 MCP 實作的預設行為。

### Claude Code 的特殊機制:deferred tools + ToolSearch

Claude Code 用了一個更聰明的架構:

1. **Deferred(延遲載入)** — 為了節省 context window,Claude Code 不會把所有 MCP 工具的 schema 一次塞進 system prompt
2. **僅暴露工具名稱** — 只把工具名稱列出來當 hint,schema 先不載入
3. **ToolSearch 取用 schema** — 當 LLM 想用某個工具時,先呼叫 `ToolSearch` 把該工具的完整 JSON Schema 撈進 context,然後才真正呼叫

這樣做有兩個好處:

- **省 token** — 不用的工具不佔 context
- **支援動態載入** — 新增的 MCP 工具名稱可以在 session 中途被注入

### 實務結論

- **理論上**:中途安裝 MCP 後可能需要重啟 Agent
- **Claude Code 實務上**:支援動態載入,安裝後通常不用重啟就能用
- **但**第一次使用 MCP 時,仍可能觸發套件或瀏覽器二進位的下載(Playwright 會下載 Chromium),屬於套件本身的行為,與 MCP 協定無關

---

## 8. 與 LSP 的類比

MCP 的設計**直接受 LSP(Language Server Protocol)啟發**,兩者高度相似:

| 面向 | LSP | MCP |
|---|---|---|
| 制定者 | Microsoft | Anthropic |
| 解決的問題 | M×N 問題:M 個編輯器 × N 個語言 | M×N 問題:M 個 AI Agent × N 個工具 |
| 解法 | 定義一份協定,編輯器與語言工具各自實作一邊 | 定義一份協定,Agent 與工具各自實作一邊 |
| 協定基礎 | JSON-RPC 2.0 | JSON-RPC 2.0 |
| 常見 transport | stdio | stdio、HTTP+SSE |
| 能力發現 | `initialize` + `textDocument/*` 方法 | `initialize` + `tools/list` 等方法 |

**LSP 的成功案例**:寫一個 Python Language Server(如 `pyright`),VS Code、Neovim、Emacs、Sublime 都能用它。

**MCP 複製了這個模式**:寫一個 Playwright MCP,Claude Code、Cursor、Cline 都能用它。

---

# Part 3:實戰篇

## 9. 前置需求

### 必要工具

- **Node.js** ≥ 18(用於執行 `npx` 啟動 MCP)
- **Claude Code CLI**(`claude` 指令可用)

### 檢查環境

```bash
node --version   # 應顯示 v18 以上
npx --version    # 應顯示 9 以上
claude --version # 確認 Claude Code 已安裝
```

若缺少 Node.js,至 <https://nodejs.org> 下載 LTS 版本。

---

## 10. 安裝 MCP(三種方式)

以下以 **Playwright MCP**(`@playwright/mcp`)為例。

### 方式 A:CLI 指令(推薦)

最簡潔、最不易出錯,Claude Code 會自動處理 `claude.json` 寫入。

```bash
claude mcp add playwright --scope user -- npx -y @playwright/mcp --browser chrome
```

**參數說明**:

| 參數 | 意義 |
|---|---|
| `playwright` | 你自訂的 MCP 名稱 |
| `--scope user` | 作用範圍:`user`(全使用者)、`project`(僅本專案)、`local`(僅本機本專案) |
| `--` | 分隔符,之後的參數會交給 MCP 子程序 |
| `npx -y @playwright/mcp --browser chrome` | 實際啟動指令 |

成功後會顯示:
```
Added stdio MCP server playwright with command: npx -y @playwright/mcp --browser chrome to user config
File modified: C:\Users\User\.claude.json
```

### 方式 B:手動編輯 `~/.claude.json`

適合想批次匯入多個 MCP、或需要設定環境變數的情境。

1. 開啟 `C:\Users\User\.claude.json`(macOS/Linux 為 `~/.claude.json`)
2. 找到或新增 `mcpServers` 區塊:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--browser", "chrome"],
      "description": "Browser automation and testing via Playwright"
    }
  }
}
```

3. 儲存後重啟 Claude Code,或執行 `claude mcp list` 觸發重新載入。

### 方式 C:從範本複製

若你已有 MCP 範本目錄(例如 `~/.claude/mcp-configs/mcp-servers.json`),直接從中挑選需要的區塊複製到 `~/.claude.json` 即可。

---

## 11. 驗證安裝

### 11.1 列出所有已註冊的 MCP

```bash
claude mcp list
```

預期輸出:

```
Checking MCP server health…

playwright: npx -y @playwright/mcp --browser chrome - ✓ Connected
```

### 11.2 查看單一 MCP 詳細資訊

```bash
claude mcp get playwright
```

### 11.3 Health Check 狀態對照

| 狀態 | 意義 |
|---|---|
| `✓ Connected` | 正常運作 |
| `! Needs authentication` | 需要登入(OAuth 或 API Key) |
| `✗ Failed to connect` | 啟動失敗(命令錯誤、套件下載失敗等) |

---

## 12. 如何使用 MCP

安裝完成後,**你不需要手動呼叫** — Claude Code 會在判斷任務需要時自動調用對應 MCP。

### 12.1 觸發方式

**方式一:自然語言指示**

> 幫我開啟 https://example.com 並截圖

Claude 會判斷此任務需要瀏覽器,自動呼叫 Playwright MCP 的 `browser_navigate` 與 `browser_take_screenshot` 工具。

**方式二:明確指定**

> 用 playwright mcp 登入 GitHub 並抓取我的 repo 列表

### 12.2 確認 MCP 是否被使用

Claude 呼叫 MCP 工具時,訊息中會顯示類似:

```
⏺ playwright:browser_navigate(url: "https://example.com")
```

看到 `playwright:` 前綴即代表該請求走 Playwright MCP。

### 12.3 查看 MCP 提供的工具列表

在 Claude Code 內輸入 `/mcp`,會列出所有啟用中的 MCP 及其工具。

---

## 13. 暫停使用 MCP

有時你不想刪除設定,只想**暫時停用**。

### 方式 A:專案層級停用(推薦)

在專案根目錄建立 `.claude/settings.local.json`:

```json
{
  "disabledMcpServers": ["playwright"]
}
```

僅影響當前專案,其他專案仍可正常使用。

### 方式 B:環境變數停用

```bash
export ECC_DISABLED_MCPS=playwright
claude

# 同時停用多個
export ECC_DISABLED_MCPS=playwright,firecrawl
```

適合臨時性、一次性的停用需求。

### 方式 C:改名暫藏

把 `~/.claude.json` 裡的 `"playwright"` 鍵改成 `"_playwright_disabled"`,MCP 載入器找不到就等同停用。需要恢復時把名稱改回來即可。

### 比較

| 方式 | 優點 | 缺點 |
|---|---|---|
| A 專案層停用 | 乾淨、可被 git 管理 | 僅限當前專案 |
| B 環境變數 | 最彈性、一次性 | 每次啟動都要設 |
| C 改名 | 不需記指令 | 土炮、容易忘記復原 |

### 恢復使用

- 方式 A:刪除 `disabledMcpServers` 中的對應項
- 方式 B:`unset ECC_DISABLED_MCPS`
- 方式 C:把鍵名改回原樣

---

## 14. 刪除 MCP

若確定不再使用,徹底移除步驟如下。

### 14.1 從 Claude Code 移除註冊

```bash
claude mcp remove playwright --scope user
```

成功後執行 `claude mcp list` 確認不再出現。

### 14.2 清理 npm 快取(選用)

`npx` 下載的套件會存在 npm cache。如需釋放空間:

```bash
npm cache clean --force
```

### 14.3 移除瀏覽器二進位(Playwright 特有)

Playwright 會下載 Chromium 到本機,占用數百 MB:

```bash
npx playwright uninstall --all
```

或手動刪除:
- **Windows**:`C:\Users\User\AppData\Local\ms-playwright\`
- **macOS**:`~/Library/Caches/ms-playwright/`
- **Linux**:`~/.cache/ms-playwright/`

### 14.4 驗證完全移除

```bash
claude mcp list              # 不應再有 playwright
claude mcp get playwright    # 應回傳找不到
```

---

# Part 4:附錄

## 15. 疑難排解

### 問題 1:`✗ Failed to connect`

**可能原因**:
- Node.js 版本過舊 → 升級到 ≥ 18
- 網路問題導致 npx 無法下載套件 → 檢查網路或改用代理
- 命令拼寫錯誤 → 用 `claude mcp get <name>` 檢查 args

**除錯指令**:
```bash
# 手動執行命令看錯誤訊息
npx -y @playwright/mcp --browser chrome
```

### 問題 2:首次使用很慢

`npx -y` 會即時下載套件。**預先拉取**可避免第一次呼叫時卡住:

```bash
npx -y @playwright/mcp --help
```

### 問題 3:Context window 被吃光

- 啟用 MCP 控制在 10 個以內
- 不常用的改為 project scope,而非 user scope
- 用 Part 13 的方式暫停不需要的

### 問題 4:Claude 沒有使用 MCP

可能 Claude 判斷任務不需要。可明確指示:

> 請使用 playwright MCP 開啟網頁並截圖,不要用 WebFetch

### 問題 5:裝好後還是看不到工具

- **多數 MCP Client**:重啟 Agent
- **Claude Code**:通常會動態載入,但若仍看不到,重啟 session 一次

---

## 16. Playwright MCP 能做什麼

基於 Microsoft 官方 `@playwright/mcp`,透過 **accessibility tree**(非截圖)操作瀏覽器。

### 常用工具

| 類別 | 工具 | 用途 |
|---|---|---|
| 導航 | `browser_navigate` | 開啟網址 |
| 互動 | `browser_click`、`browser_type`、`browser_select_option` | 點擊、輸入、下拉選單 |
| 等待 | `browser_wait_for` | 等待元素出現 |
| 擷取 | `browser_snapshot`、`browser_take_screenshot` | 取得 DOM 快照或截圖 |
| 分頁 | `browser_tabs` | 多分頁管理 |
| 腳本 | `browser_evaluate`、`browser_run_code` | 執行 JavaScript / Playwright code |
| 網路 | `browser_network_requests` | 擷取網路請求 |
| 檔案 | `browser_file_upload` | 上傳檔案 |
| 對話框 | `browser_handle_dialog` | 處理 alert/confirm/prompt |
| 表單 | `browser_fill_form` | 批次填表 |

### 適用情境

- ✅ 需要登入後抓取的資料
- ✅ SPA(React/Vue)動態渲染內容
- ✅ 填寫表單、模擬使用者操作
- ✅ E2E 測試前的流程探索
- ✅ UI 改動後實地驗證

### 不適用情境

- ❌ 純靜態網頁抓取 → 用 `WebFetch` 更輕量
- ❌ 關鍵字搜尋 → 用 `WebSearch` 或 Exa MCP
- ❌ 需要規模化爬蟲 → 用 Firecrawl MCP

---

## 17. 延伸閱讀

- **MCP 官方規範**:<https://modelcontextprotocol.io>
- **JSON-RPC 2.0 規範**(英文,很短):<https://www.jsonrpc.org/specification>
- **Language Server Protocol**:<https://microsoft.github.io/language-server-protocol/>
- **MCP Server 目錄**:<https://github.com/modelcontextprotocol/servers>
- **Playwright MCP**:<https://github.com/microsoft/playwright-mcp>
- **Claude Code MCP 文件**:執行 `claude mcp --help`
- **本站相關文章**:[../Programming/API.md](../Programming/API.md) — 了解 API 風格全貌

---

## 18. 一句話總結

> **MCP = JSON-RPC 2.0 + 能力發現機制 + 三種資源類型(Tools/Resources/Prompts),透過 stdio 或 HTTP 傳輸,讓 AI Agent 與外部工具能各自獨立演進而互通。**

理解這句話就理解了 MCP 的 90%。剩下的 10% 是具體工具 schema 的設計細節,那屬於每個 MCP 作者的自由發揮。

---

_最後更新:2026-04-15_
