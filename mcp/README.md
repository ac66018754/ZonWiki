# ZonWiki MCP Server

ZonWiki 的 Model Context Protocol (MCP) 伺服器，讓任何支援 MCP 的 AI 助理（如 Claude Desktop、Claude Code）可直接讀寫 ZonWiki 知識庫、任務與開問啦畫布。

## 功能

### 筆記工具（Notes）
- `list_notes` — 列出所有筆記（含摘要、可按分類篩選）
- `get_note` — 取得單篇筆記的完整內容（Markdown + HTML）
- `create_note` — 建立新筆記（支援分類、標籤、日記）
- `update_note` — 更新筆記的標題、內容、分類或標籤
- `search_notes` — 搜尋筆記（依標題或內容的關鍵字）

### 任務工具（Tasks）
- `list_tasks` — 列出所有任務卡片（支援多視圖：清單/看板/行事曆）
- `create_task` — 建立新任務（支援優先級、日期、重複規則）
- `update_task` — 更新任務的狀態、優先級、日期

### 快速捕捉工具（Captures）
- `list_captures` — 列出 Inbox 項目（可依狀態篩選）
- `create_capture` — 快速捕捉想法、文字或語音轉文字
- `archive_capture` — 歸檔捕捉項目（轉換為筆記或任務）

### 開問啦畫布工具（Canvas）
- `list_canvases` — 列出所有畫布
- `create_canvas` — 建立新畫布
- `get_canvas` — 取得畫布上的所有節點與連線
- `create_canvas_node` — 在畫布上建立節點（支援自動連線到父節點）
- `search_canvas_nodes` — 搜尋畫布內的節點

## 安裝 & 編譯

```bash
cd mcp
npm install
npm run build
```

編譯後的產物會輸出到 `dist/` 資料夾。

## 使用

### 1. 啟動 ZonWiki 後端

```bash
# 在 ZonWiki 主目錄下
dotnet run --project src/ZonWiki.Api --launch-profile http
# → 後端會在 http://localhost:5009 執行
```

### 2. 設定 Claude Desktop

編輯 `~/.claude/claude_config.json`（Windows: `%APPDATA%/Claude/claude_config.json`），新增：

```json
{
  "mcpServers": {
    "zonwiki": {
      "command": "node",
      "args": ["<ZonWiki-repo>/mcp/dist/index.js"],
      "env": {
        "ZONWIKI_API_BASE": "http://localhost:5009"
      }
    }
  }
}
```

（將路徑改成你的實際路徑）

### 3. 設定 Claude Code

在 Claude Code 的設定中（或 `~/.claude/settings.json`），新增同樣的 MCP 伺服器配置。

### 4. 開始使用

在 Claude Desktop 或 Claude Code 聊天時，就可使用上述任何工具，例如：

```
請列出我的所有待辦任務，並告訴我今週的截止日期。
```

Claude 會自動呼叫 `list_tasks` 並解析結果。

## 環境變數

- `ZONWIKI_API_BASE` — ZonWiki API 的基礎 URL（預設 `http://localhost:5009`）

## 認證

目前 MCP Server 假設 HTTP 呼叫會自動帶上認證資訊（Cookie 或 Bearer token）。

若要自訂認證：
1. 編輯 `src/index.ts` 中的 `call()` 函式
2. 加入自訂的 Authorization header
3. 重新編譯：`npm run build`

## API 相容性

此 MCP Server 依賴 ZonWiki Web API（`.NET 10 ASP.NET Core`）。API 回應格式需為：

```json
{
  "Success": true,
  "Data": { ... },
  "Error": null
}
```

所有工具皆呼叫 `http://localhost:5009/api/*` 端點。

## 故障排除

### 連線失敗

檢查：
1. ZonWiki 後端是否執行在 `ZONWIKI_API_BASE` 指定的位置
2. 防火牆是否允許本機迴圈連線
3. 環境變數 `ZONWIKI_API_BASE` 是否正確設定

### TypeScript 編譯錯誤

若 `npm run build` 失敗，檢查：
1. Node.js 版本是否 >= 18
2. 相依套件是否已安裝：`npm install`
3. `@modelcontextprotocol/sdk` 版本是否相容

### API 回應錯誤

MCP Server 會轉發 ZonWiki API 的錯誤訊息。若看到 HTTP 狀態或 `Success: false`，檢查：
1. ZonWiki API 日誌
2. 請求的必要欄位是否都填了
3. 使用者是否有權限執行該操作

## 開發

### 新增工具

1. 在 `src/index.ts` 中呼叫 `server.tool(...)` 新增工具定義
2. 工具名稱應以 `snake_case` 命名
3. 提供清晰的 `description` 和參數描述（繁中或英文）
4. 使用 `zod` schema 驗證參數
5. 使用 `ok()` / `fail()` 格式化回應

### 編譯與測試

```bash
# 監視模式（自動重編譯）
npm run watch

# 手動編譯
npm run build
```

## 許可

MIT

## 相關資源

- [ZonWiki 後端](../src/ZonWiki.Api)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Claude API 文件](https://claude.ai/)
