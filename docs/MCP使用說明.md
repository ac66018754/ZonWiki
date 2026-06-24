# ZonWiki MCP 使用說明（Model Context Protocol）

> 讓 Claude（Desktop / Code）等支援 MCP 的 AI 助理，**直接讀寫你的 ZonWiki**：
> 列筆記、建任務、開畫布、加節點……不必再手動複製貼上。

---

## 1. MCP 是什麼？為什麼需要？

**MCP（Model Context Protocol）** 是 Anthropic 提出的開放協定，讓 AI 助理能透過一組「工具（tools）」
與外部系統互動。ZonWiki 內建一支 **MCP Server**（位於 [`mcp/`](../mcp/)），把 ZonWiki 的後端 API
包裝成 16 個工具。掛上後，你可以直接對 Claude 說：

> 「幫我把今天會議的重點整理成一篇筆記，分類放『工作』。」
> 「列出我這週逾期的任務。」
> 「在『系統設計』畫布上，從『需求』節點接一個『資料表設計』子節點。」

Claude 會自動呼叫對應工具完成，省去手動操作。

| 項目 | 內容 |
|---|---|
| 位置 | `mcp/`（Node.js + TypeScript） |
| 協定傳輸 | stdio（標準輸入輸出；由 AI 客戶端啟動子行程） |
| 相依 | `@modelcontextprotocol/sdk` ^1.12、`zod` ^3 |
| 後端 | 透過 HTTP 呼叫 ZonWiki .NET API（預設 `http://localhost:5009`） |
| 支援客戶端 | Claude Desktop、Claude Code，及任何支援 MCP stdio 的客戶端 |

---

## 2. 快速開始

### 前置需求
- Node.js 18 以上
- ZonWiki 後端正在執行（見 [README 本機啟動](../readme.md#本機啟動完整步驟)）

### 步驟

```bash
# 1) 編譯 MCP Server
cd mcp
npm install
npm run build           # 產生 dist/index.js
```

```jsonc
// 2) 在 Claude Desktop / Claude Code 的設定檔加入（參考 mcp/claude-config-example.json）
//    Windows: %APPDATA%/Claude/claude_desktop_config.json
//    macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "zonwiki": {
      "command": "node",
      "args": ["<ZonWiki-repo 絕對路徑>/mcp/dist/index.js"],
      "env": {
        "ZONWIKI_API_BASE": "http://localhost:5009",
        "ZONWIKI_API_COOKIE": "ZonWikiAuth=貼上你的登入 Cookie"
      }
    }
  }
}
```

```text
3) 重啟 Claude Desktop / 重新整理 Claude Code 的 MCP，即可開始使用。
   試試：「列出我的所有筆記」。
```

---

## 3. 認證（重要）

ZonWiki 後端是 **Cookie 認證、強制登入**。MCP Server 與瀏覽器是不同的行程，
**不會自動共用你的登入狀態**，所以要把認證資訊透過環境變數傳進去：

| 環境變數 | 用途 |
|---|---|
| `ZONWIKI_API_COOKIE` | 你登入後的完整 Cookie 字串（最常用）。例如 `ZonWikiAuth=eyJ...`。 |
| `ZONWIKI_API_TOKEN` | Bearer token（若後端改採 token 認證時用）。 |

**怎麼取得 Cookie？**
1. 用瀏覽器登入 ZonWiki（本機 `http://localhost:3000`）。
2. 開發者工具 → Application/應用程式 → Cookies → 找到驗證用的 Cookie（名稱通常以 `ZonWikiAuth`／`.AspNetCore` 開頭）。
3. 把「名稱=值」整串填入 `ZONWIKI_API_COOKIE`。

> ⚠️ Cookie 等同你的登入憑證，**請勿外洩或提交進版控**。Cookie 會過期，過期後重新取得即可。
> 若你的後端尚未開啟認證（少見），可不設定，請求就不帶認證。

---

## 4. 16 個工具完整參考

> 回應一律是 ZonWiki 的統一信封 `{ "Success": bool, "Data": …, "Error": string|null }`；
> 工具會在 `Success=true` 時回傳 `Data`，否則回報錯誤訊息。

### 筆記（Notes，5 個）
| 工具 | 功能 | 主要參數 |
|---|---|---|
| `list_notes` | 列出所有筆記（摘要） | `categoryId?` |
| `get_note` | 取單篇完整內容（Markdown + HTML） | `slug` |
| `create_note` | 建立新筆記 | `title`, `contentRaw`, `kind?`(note/journal), `journalDate?`, `categoryIds?`, `tags?`（標籤不存在會自動建立） |
| `update_note` | 更新筆記 | `noteId`, `title?`, `contentRaw?`, `categoryIds?`, `tags?`（整組覆寫） |
| `search_notes` | 關鍵字搜尋筆記 | `query`, `limit?`(預設 20) |

### 任務（Tasks，3 個）
| 工具 | 功能 | 主要參數 |
|---|---|---|
| `list_tasks` | 列出任務卡片 | `view?`(list/board/calendar), `sort?`, `from?`, `to?` |
| `create_task` | 建立任務 | `title`, `content?`, `status?`(todo/doing/done), `priority?`(0–3), `plannedDateTime?`, `dueDateTime?`, `groupId?`, `recurrenceRule?` |
| `update_task` | 更新任務 | `taskId`, `title?`, `content?`, `status?`, `priority?`, `plannedDateTime?`, `dueDateTime?` |

### 快速捕捉（Captures，3 個）
| 工具 | 功能 | 主要參數 |
|---|---|---|
| `list_captures` | 列出 Inbox 項目 | `status?`(inbox/filed/all) |
| `create_capture` | 捕捉想法到 Inbox | `source`(web/voice/text), `rawContent`, `audioPath?` |
| `archive_capture` | 歸檔（轉成筆記/任務） | `captureId`, `targetType`(note/taskcard), `targetId` |

### 開問啦畫布（Canvas，5 個）
| 工具 | 功能 | 主要參數 |
|---|---|---|
| `list_canvases` | 列出所有畫布 | （無） |
| `create_canvas` | 建立畫布 | `title`, `description?` |
| `get_canvas` | 取畫布的所有節點與連線 | `canvasId` |
| `create_canvas_node` | 在畫布上建節點 | `canvasId`, `content`, `title?`, `kind?`(question/answer/note), `parentNodeId?`（會自動連線）, `x?`, `y?` |
| `search_canvas_nodes` | 在畫布內搜尋節點 | `canvasId`, `query` |

**日期格式**：所有日期參數（`journalDate`、`plannedDateTime`、`dueDateTime`、`from`、`to`）一律用 **ISO 8601**（例如 `2026-06-24T09:00:00Z`）。

---

## 5. 設定與環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `ZONWIKI_API_BASE` | `http://localhost:5009` | 後端 API 基底 URL。可指向遠端，如 `https://zonwiki.example.com`。 |
| `ZONWIKI_API_COOKIE` | （無） | 認證 Cookie，見 §3。 |
| `ZONWIKI_API_TOKEN` | （無） | 認證 Bearer token，見 §3。 |

也可以 `npm i -g`（或 `npm link`）後以 `zonwiki-mcp` 指令啟動（`package.json` 的 `bin`）。

---

## 6. 故障排除

| 症狀 | 可能原因 | 解法 |
|---|---|---|
| `ECONNREFUSED localhost:5009` | 後端沒跑 | 先啟動後端 `dotnet run --project src/ZonWiki.Api --launch-profile http` |
| 工具都回 401 / 空結果 | 沒帶認證或 Cookie 過期 | 設定 / 更新 `ZONWIKI_API_COOKIE`（見 §3） |
| `Cannot find module .../dist/index.js` | 沒編譯或路徑錯 | `cd mcp && npm install && npm run build`，確認 config 內路徑為**絕對路徑** |
| Claude 看不到工具 | config 沒生效 | 確認設定檔位置正確、重啟客戶端 |
| 中文變亂碼 | 編碼問題 | 後端與 MCP 皆 UTF-8；確認終端機/環境變數編碼 |

---

## 7. 開發與擴充

- 工具定義在 [`mcp/src/index.ts`](../mcp/src/index.ts)，用 `server.tool(name, desc, zodSchema, handler)` 新增。
- 工具名稱用 `snake_case`；參數以 `zod` 驗證；用 `ok()` / `fail()` 包裝回應。
- `console.log` 會破壞 stdio 協定——**只能用 `console.error`（寫 stderr）**輸出除錯訊息。
- 改完執行 `npm run build`（或 `npm run watch`）。

---

## 8. 已知限制

- **不含 AI 對話工具**：目前只暴露筆記/任務/捕捉/畫布的 CRUD 與搜尋，尚未提供「對節點發問、串流回答」的工具（後端有，但未包成 MCP 工具）。
- **無重試**：後端短暫不可用時工具會直接報錯（適合本機/自架，正式環境可自行加重試）。
- **`create_canvas_node` 兩段寫入**：帶 `parentNodeId` 時會先建節點、再建連線；若第二步失敗會留下未連線的節點。
- 多租戶隔離由後端依認證身分把關，MCP 端不另做檢查——務必用**你自己**的 Cookie。

---

相關：[MCP Server 原始碼與 README](../mcp/README.md) ｜ [Model Context Protocol 官方](https://modelcontextprotocol.io/)
