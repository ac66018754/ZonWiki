# API 個人存取權杖（PAT）與外部 AI 整合 — 設計與決策

**日期**：2026-06-26
**目標**：讓任何外部 AI 助理（Claude Code、Hermes、ChatGPT 的 Custom GPT Action…）以「使用者本人身分」
讀寫 ZonWiki 的筆記與分類，達成「資料夾名稱→分類、Markdown→筆記、正確歸類」等情境。

---

## 1. 核心觀念：把「授權」與「整合管道」分開

- **授權**＝AI 怎麼證明「能動我的帳號」→ 用 **API 個人存取權杖（PAT）**，與用哪種 AI 無關。
- **整合管道**＝AI 怎麼實際呼叫動作 → MCP / OpenAPI Action / 直接 REST 都行；MCP 只是其中一種轉接頭，
  且底層仍是打同一套 REST API。

因此本次的地基是「**權杖認證的 REST API**」，MCP 與 ChatGPT Action 都疊在上面。

---

## 2. 為何選 PAT（而非 OAuth / JWT）

- 自用個人系統，不需要第三方授權流程的複雜度。PAT＝「一串高熵亂數密鑰，代表某使用者」，
  可命名、可設到期、可撤銷——足以涵蓋所有情境，且最容易實作與理解。
- ChatGPT 的 Custom GPT Action 支援「API Key／Bearer」認證，正好對應 PAT；個人 Plus/Pro 也能用（可寫入）。
  （ChatGPT 原生 MCP 連接器在個人方案是唯讀，故 ChatGPT 走 Action 而非 MCP。）

## 3. 權杖的安全設計

- **只存雜湊**：`ApiToken_TokenHash` 存權杖的 SHA-256（十六進位），明碼只在「產生當下」回傳一次。
  權杖本身是 32 byte 密碼學亂數（高熵），故用 SHA-256 即足夠，**不需密碼用的慢雜湊 KDF**（與 GitHub PAT 同理）。
- **可撤銷＝軟刪除**：撤銷把 `ValidFlag=false`；驗證只接受 `ValidFlag=true`。一把外洩即撤那把，不影響其它。
- **可命名 + 顯示前綴**：`ApiToken_TokenPrefix`（如 `zwk_Ab12cd`）讓使用者辨識「這是哪一把」，不足以反推完整權杖。
- **可選到期**：`ApiToken_ExpiresDateTime`；過期即驗證失敗。
- **不外洩**：列出端點只回名稱/前綴/時間，**絕不回雜湊或明碼**。

## 4. 認證整合：policy scheme 選擇器 + 子範圍查詢（關鍵陷阱）

- 新增 `ApiTokenAuthenticationHandler`（scheme 名 `ApiToken`）。以 `AddPolicyScheme` 做「智慧選擇」：
  請求帶 `Authorization: Bearer …` → 走 ApiToken 驗證；否則 → 走既有 Cookie 驗證。兩者並存、互不影響。
- **陷阱（已處理）**：本系統把目前使用者 Id 以常數烤進 EF 模型、並依使用者快取模型；一個 DbContext
  實例的模型在「第一次查詢」即固定。權杖驗證發生在「使用者身分尚未設定（CurrentUserId 為空）」之時，
  若用「請求範圍」的 DbContext 查權杖，會把該 context 的模型鎖死在 `Guid.Empty` → 之後端點查不到任何資料。
  - **解法**：驗證時**另開子服務範圍（child scope）**取獨立 DbContext 查權杖（並 `IgnoreQueryFilters`），用完即棄；
    請求範圍的 DbContext 維持乾淨，待端點執行（身分已設定）才首次查詢、鎖定正確使用者。
  - 「最終防線」具現化攔截器在 `CurrentUserId == Guid.Empty` 時放行，故此查找不會被誤擋。

## 5. AI 友善端點 `POST /api/ai/notes`

- 與既有 `POST /api/notes`（需先知道分類 GUID）不同，本端點接受**分類名稱路徑**與**標籤名稱**，
  後端「找不到就建立」：
  - `categoryPath: ["學習","Python"]` → 建立/沿用巢狀分類（比對鍵＝同上層＋同名＋本人有效；冪等）。
  - `tags: ["語法"]` → 找不到就建立標籤。
  - `upsert: true` → 同分類同標題就更新而非新增（避免反覆匯入產生重複）。
- 這直接服務「請 AI 整理某文章/某目錄到某分類」與「本機資料夾批次匯入」兩種情境。

## 6. ChatGPT 路線（Path A）：精簡 OpenAPI

- 不直接用內建 `AddOpenApi()` 的「全端點」自動文件（過大、雜訊多、Action 難用），
  而是策展一份精簡 OpenAPI（`AiOpenApiDocument`），只含 `POST /api/ai/notes`、`GET /api/categories`、`GET /api/notes`，
  並宣告 `bearerAuth`。公開於 `GET /openapi/zonwiki-ai.json`（servers 位址優先採 `Api:PublicBaseUrl`，否則由請求推算）。

## 7. 順手修正的既有 MCP bug（本次發現）

1. `call()` 讀回應信封用 PascalCase（`Success/Data`），但後端序列化為 camelCase（`success/data`）→ 工具一律失敗。
   已改為兩者皆容忍。
2. `search_notes` 打 `/api/notes/search`（不存在，會命中 slug 萬用路由）→ 已改為 `/api/search?q=` 並過濾筆記。
3. `create_note` 送 `Tags`（名稱），但後端只收 `TagIds`（GUID）→ 標籤被靜默忽略。已移除誤導欄位，
   改提供 `create_classified_note`（名稱式、會自動建立）作為推薦工具。

## 8. 驗證

本機端對端（curl + UTF-8 body）已驗證：註冊→產權杖（中文名稱正確 round-trip）→ Bearer 建分類筆記
（中文巢狀分類 `學習/Python` 自動建立、parentId 正確）→ upsert 不重複 → 無效/未認證/已撤銷皆 401 →
列表不外洩雜湊 → OpenAPI 公開含 bearerAuth → Cookie 認證無回歸。

**待使用者本機驗證**：個人頁「API 權杖」UI（產生/複製/撤銷的視覺流程）——本次 Playwright 工具不可用，
故 UI 視覺確認留給使用者本機驗證（程式已過 tsc/eslint，且後端 API 已完整實測）。
