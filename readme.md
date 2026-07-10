# ZonWiki — 個人知識與任務作業系統

**一句話定位**：統一的個人知識庫 + 任務管理系統，集筆記、白板、知識圖譜、日程規劃、待辦事項、AI 繪畫於一身，支援多人各自獨立使用（單人為主，暫無跨帳號協作／分享）。

**🔗 線上 Demo**：<https://zonwiki.pee-yang.com> ｜ **授權**：MIT License

> 詳細的升級計畫、決策記錄、進度追蹤，請見
> [`docs/design/升級執行計畫.md`](./docs/design/升級執行計畫.md)
> 願景文件見 [`docs/design/升級藍圖-個人知識與任務作業系統.md`](./docs/design/升級藍圖-個人知識與任務作業系統.md)

---

## 系統定位

**以 PostgreSQL 為唯一真相（DB-as-truth）** 的個人知識與任務系統：筆記、任務、畫布、節點、關聯全部存在資料庫，一律在網頁上編輯、儲存與查詢。並**完全吸收** [開問啦](https://github.com/zone2sky/KaiWen)（AI 繪畫工具），成為 ZonWiki 內建的 Canvas 模組。

```
   Browser（網頁編輯）
        │  HTTPS / Cookie Auth
        ▼
   .NET 10 API ──► PostgreSQL（唯一真相：筆記 / 任務 / 畫布 / 節點 / 關聯）
```

---

## 技術選型表

| 項目 | 技術 | 備註 |
|---|---|---|
| **前端框架** | Next.js 16 + React 19 | App Router；SSR 優化；伺服端元件 |
| **前端樣式** | Tailwind CSS 4 | 原子化設計；暗色/暖紙/明亮/夜間支援 |
| **前端型別** | TypeScript 5.6+ | 嚴格模式 |
| **前端元件圖** | React Flow | 知識圖譜/畫布繪製（自開問啦沿用） |
| **後端框架** | .NET 10 + ASP.NET Core Minimal API | 輕量化；好用 EF Core |
| **後端 ORM** | EF Core 10 (Code-First) | 多租戶全域查詢過濾 + 軟刪除 |
| **資料庫** | PostgreSQL 16 (Docker) | Alpine 映像；連接埠 5533 |
| **認證** | Cookie + HTTP-only；強制登入 | Google OAuth (optional，正式部署用) |
| **API 金鑰加密** | ASP.NET Core Data Protection | AI 模型金鑰存 DB 時自動加密、解析時自動解密 |
| **AI 整合** | Claude CLI + OpenAI 相容 + Gemini | 可擴展 IAiProvider 介面；內建 Gemini (format-md) |
| **MCP** | 自家 MCP Server（Node.js/TypeScript，已實作） | 供任何 AI 助理讀寫知識庫/任務/畫布；stdio、45 工具。見 [docs/MCP使用說明.md](./docs/MCP使用說明.md) |
| **圖片附件** | SixLabors.ImageSharp 3.1（WebP 重編碼） | 筆記貼圖存磁碟 `App_Data/attachments`＋DB 中繼資料；內文只放 `/api/attachments/{id}` 短網址（非 base64）；孤兒附件每日掃描軟刪除。詳見 docs/DECISIONS.md 2026-07-08 |
| **測試框架** | xUnit + FluentAssertions | 整合測試用 Testcontainers.PostgreSql |
| **容器化** | Docker Compose | 本機開發用；正式部署可自選（K8s/VPS 等） |
| **版本控制** | Git + GitHub | DB 為唯一真相（不再有檔案同步）|
| **對外接入 (ingress)** | Cloudflare Tunnel | 出站連線、不開公網埠；自動 TLS、隱藏來源 IP |
| **可觀測性 (observability)** | GCP Ops Agent → Cloud Logging / Monitoring | 容器 log + 機器指標上雲；以 Logs Explorer GUI 查詢 |
| **正式部署 (production)** | GCP Compute Engine e2-micro + Docker Compose | Always Free 等級；映像由 GitHub Actions → GHCR 自動建置 |

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser / 用戶端                             │
│  (支援桌面瀏覽器、平板觸控、手機 RWD)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS / Cookie Auth
                             │
        ┌────────────────────▼────────────────────┐
        │      Next.js 16 前端（port 3000）        │
        │  ┌─ Header                              │
        │  │  ├─ 主功能切換（Home/Note/Task/...) │
        │  │  ├─ 全域搜尋                         │
        │  │  ├─ 帳號/系統設定                     │
        │  │  └─ 顯示模式切換（4 種）              │
        │  │                                      │
        │  ├─ 左側欄（收折式）                     │
        │  │  └─ 當前頁附屬功能                    │
        │  │                                      │
        │  └─ 主內容區                            │
        │     ├─ 首頁（週曆/今日Todo/快捷卡）      │
        │     ├─ 筆記頁（編輯/搜尋/分類/標籤）     │
        │     │  ├─ 知識圖譜（子頁）              │
        │     │  └─ 浮動白板（每筆記可開）        │
        │     ├─ 日程規劃/Todo（清單/看板/曆）    │
        │     ├─ 行事曆（週月視圖）                │
        │     └─ Canvas/開問啦（原樣保留）        │
        └────────────────────┬────────────────────┘
                             │ REST API + JSON
                             │
        ┌────────────────────▼──────────────────────────────────┐
        │  .NET 10 Web API 後端（port 5009）                     │
        │  ASP.NET Core Minimal API + EF Core 10                │
        │                                                       │
        │  Controllers:                                         │
        │  ├─ AuthController (Cookie 認證)                     │
        │  ├─ NoteController (CRUD + 全文搜尋)                 │
        │  ├─ TaskController (卡片/群組/關聯)                   │
        │  ├─ CanvasController (繪畫/節點/邊)                  │
        │  ├─ AiController (模型管理 + API 呼叫)               │
        │  └─ SettingController (顯示模式/時區/垃圾桶)          │
        │                                                       │
        │  Services:                                            │
        │  ├─ IAiProvider (Claude/OpenAI/Gemini 提供者)        │
        │  ├─ INoteAiService (筆記排版/美化)                    │
        │  └─ ISearchService (全文搜尋 + 反向連結)              │
        │                                                       │
        │  Global Filters & Middleware:                         │
        │  ├─ TenantFilter (UserId 隔離)                       │
        │  ├─ SoftDeleteFilter (ValidFlag 軟刪除)              │
        │  ├─ ExceptionHandler (統一 ApiResponse 信封)         │
        │  └─ AuthMiddleware (Cookie 驗證)                     │
        └────────────────────┬──────────────────────────────────┘
                             │ EF Core DbContext
                             │
        ┌────────────────────▼──────────────────────────────────┐
        │  PostgreSQL 16 資料庫（port 5533）                     │
        │  Docker Alpine 映像；資料卷持久化                       │
        │                                                       │
        │  核心表：                                              │
        │  ├─ Identity                                          │
        │  │  ├─ User (UserId, Email, DisplayName, TimeZone,  │
        │  │  │        DisplayMode)                            │
        │  │  └─ AiModel (API金鑰加密儲存)                     │
        │  │                                                    │
        │  ├─ 筆記系統                                           │
        │  │  ├─ Note (標題/內容/草稿/日記/分類)                │
        │  │  ├─ NoteRevision (編輯歷史)                        │
        │  │  ├─ Category (分層)                               │
        │  │  ├─ NoteCategory (M2M)                            │
        │  │  ├─ Tag / NoteTag                                 │
        │  │  ├─ NoteLink (反向連結)                            │
        │  │  ├─ Comment (範圍留言)                             │
        │  │  ├─ Whiteboard (浮動白板)                         │
        │  │  └─ WhiteboardItem (白板內容)                     │
        │  │                                                    │
        │  ├─ 任務系統                                           │
        │  │  ├─ TaskCard (卡片/狀態/優先級/期限；               │
        │  │  │   ParentId 自我參照＝子任務；CompletedDateTime) │
        │  │  ├─ SubTask (舊版子任務；已遷移為子卡，保留備份)   │
        │  │  ├─ TaskGroup (群組)                              │
        │  │  ├─ TaskRelation (對等關聯)                        │
        │  │  └─ NoteTaskLink (筆記↔卡片 M2M)                  │
        │  │                                                    │
        │  ├─ 跨模組連結                                         │
        │  │  └─ EntityLink (泛型雙向連結：任務/子任務/         │
        │  │       筆記/節點 任兩者互連，一列即雙向)            │
        │  │                                                    │
        │  ├─ 活動紀錄                                           │
        │  │  └─ ActivityLog (各實體新增/編輯/刪除/還原         │
        │  │       的逐筆紀錄，由 SaveChanges 攔截器自動產生)   │
        │  │                                                    │
        │  ├─ Canvas/開問啦（吸收）                              │
        │  │  ├─ Canvas (畫布基本資訊)                          │
        │  │  ├─ CanvasCategory (分類)                         │
        │  │  ├─ Node / Edge (圖結構)                          │
        │  │  ├─ NodeImage (圖片檔案參考)                       │
        │  │  ├─ NodeRevision (歷史版本)                        │
        │  │  ├─ AiSession / AiMessage (聊天紀錄)              │
        │  │  └─ Highlight / InlineLink (標記)                 │
        │  │                                                    │
        │  ├─ 首頁與快速捕捉                                     │
        │  │  ├─ QuickLink (常用連結卡)                         │
        │  │  └─ CaptureItem (Inbox 快速記想法)                │
        │  │                                                    │
        │  └─ 稽核欄（每表）                                     │
        │     ├─ {Table}_CreatedDateTime (UTC)                │
        │     ├─ {Table}_CreatedUser                          │
        │     ├─ {Table}_UpdatedDateTime (UTC)                │
        │     ├─ {Table}_UpdatedUser                          │
        │     ├─ {Table}_DeletedDateTime (nullable, 軟刪除時) │
        │     └─ {Table}_ValidFlag (邏輯刪除旗標)             │
        └──────────────────────────────────────────────────────┘
```

**多租戶隔離策略**：
- 每條內容記錄帶 `{Table}_UserId`（目前直接用 User 隔離，未來可升至 Workspace）
- EF Core **全域查詢過濾**：任何查詢自動加上 `WHERE UserId == CurrentUserId AND ValidFlag == true`
- API 層認證確保 `HttpContext.User.GetUserId()` 有效性
- 評論、快捷卡、AI 金鑰等亦同此方式隔離

**資料一致性**：
- 時間欄一律存 UTC+0（`DateTime` 設定 `DateTimeKind.Utc`）
- 前端依裝置時區顯示（`getTimezoneOffset()` + UI 選項設定 `User.TimeZone`）
- 文字內容確保 UTF-8 編碼；跨行程/檔案/網路邊界皆明示 UTF-8

### 正式部署架構（雲端）

本機開發是「前後端裸跑 + Docker Postgres」；**正式環境**則是整套容器化跑在 GCP，對外只經 Cloudflare、機器不開任何公網埠：

```
使用者瀏覽器
   │ HTTPS
   ▼
Cloudflare（自動 TLS、隱藏來源 IP、擋攻擊）
   │ 加密隧道（cloudflared 主動「出站」連線，VM 不開 80/443）
   ▼
GCP Compute Engine VM（e2-micro, Always Free）
   ├─ cloudflared（隧道客戶端）
   ├─ web     : Next.js（127.0.0.1:3000）
   ├─ api     : .NET 10（127.0.0.1:8080）──► postgres
   ├─ postgres: PostgreSQL 16（資料卷持久化）
   └─ Ops Agent ──► Cloud Logging（log）／ Cloud Monitoring（CPU・記憶體・磁碟）
```

- **映像建置**：GitHub Actions → 推到 GHCR；VM 端只 `docker compose pull && up -d`，不在機器上 build。
- **可觀測性**：用 GCP Ops Agent，log 與機器指標皆上雲，於 Console 以 GUI 查詢（見下方 FAQ）。
- 詳細操作步驟與機密設定（隧道 ID、VM 名、指令、金鑰）保存在**私有部署文件**，不隨公開 repo 發佈。

---

## 主要功能

### 1. 首頁（Dashboard）
- 本週行程（七日格）：**預設自動展開「今日」**，展開後以「日程規劃」同款**直立任務卡片**呈現當天任務；點卡片即可開編輯器，打勾完成**不會讓卡片消失**（避免誤觸後忘記）。（原本另一個「今日待辦」清單區塊已移除，避免與本週行程重複）
- 常用連結卡（每人各自設定，標題+URL；可設「分類」自由分組、貼「標籤」（與筆記/任務共用標籤庫）；首頁依分類分組顯示，可就地新增/編輯/刪除）
- 快速捕捉框（文字輸入/錄音，先進 Inbox）；最近記錄可刪除，點擊開「捕捉分流」彈窗：上 1/3 為原始內容、下 2/3 可切換新增「筆記 / Todo」，且會列出這則記錄過去衍生過的筆記/Todo（不限筆數）

### 2. 筆記（Notes）
- **新增筆記表單（由上而下）**：標題 →（分類、標籤）→ 內容（Markdown 編輯器）。分類/標籤皆可就地新增。（本系統**不使用「草稿」概念**——筆記沒有草稿/發佈之分。）
- **編輯**：Markdown 編輯器；支援 Wiki link `[[筆記標題]]` 反向連結
- **匯出 PDF**：筆記詳情頁「📄 匯出 PDF」用瀏覽器原生列印（可在列印對話框「另存為 PDF」）；列印時自動只保留標題＋內容、白底黑字（`@media print` 隱藏全站外殼與互動元件），預設檔名即筆記標題。零額外相依套件。
- **組織**：左側固定側欄的分類樹（**預設全部收合**，可逐層展開；每個分類**靠最右側**顯示「(子類: N, 筆記: M)」，無子分類者只顯示「(筆記: M)」）；多標籤；快速搜尋。**點分類名稱＝點其左側三角形**（切換展開/收合該分類子樹），同時右側列出該分類的筆記；被點分類的所有祖先會自動展開以保持可見。右側除了該分類的筆記，**下方還會列出其「子分類」**（含筆記數，可點擊鑽入）。
- **清單置頂列**：筆記清單頁的「筆記／N 篇／目前分類／編輯模式鈕／批次工具列」整排**置頂（sticky）**，往下捲動不會被滑掉。
- **編輯模式（批次操作）**：清單頁右上「編輯模式」開啟後，每篇筆記左側出現勾選框，可批次：**刪除**（移到垃圾桶、可復原）、**加入分類**（多對多附加；若有筆記已屬於其他分類，會先列出是哪些筆記＋原因並要求再次確認，確認後只附加不移除原分類）、**加入標籤**（附加）。
  - **編輯模式只由按鈕關閉**：重整頁面、伺服器斷線都不會關閉，必須再次按「編輯模式」才關。
  - **選取＝批次標籤成員（可復原＋永久關聯）**：首次勾選會自動建立一個「批次（時戳）」標籤，並把勾選的筆記加入該標籤（取消勾選即移除）。因此意外重整後回到清單，仍能依標籤成員還原勾選；同時這群筆記也獲得一個永久標籤，日後可再對它們做共同操作（編輯模式狀態與批次標籤 ID 存於 localStorage）。
- **文字標註（檢視/預覽時框選內文）**：選取一段文字即浮現工具面板，可：
  - **🖍 畫重點**：**完整色盤**（react-colorful，無斷點）＋常用色快捷；**選色即套用**（不需再按套用鈕），顏色以 hex 儲存。滑鼠移上重點會浮現視窗、可 **✕ 移除重點**。
  - **🔗 做關聯**：把這段文字連到**其他筆記／任務（行事曆）／開問啦節點／外部網址**；滑鼠移上去會浮現視窗列出關聯目標，點擊即前往。
  - **📝 寫備註**：為這段文字加註解；滑入即浮現視窗顯示備註內容。
  - **💬 框選提問**：對選取文字向 AI（Gemini）提問，會自動建立一則「答案筆記」（含來源出處＋問題＋回答）並從選取處關聯回去（與開問啦節點的「框選提問」對應）。後端 `POST /api/notes/{id}/ask-selection`。
  - 錨點以「文字＋字元位移＋前後文」儲存（`NoteMark`，不嵌入內文），內容編輯後會自動重新定位（reAnchor）；與開問啦節點同一套機制。後端 `GET/POST/PUT/DELETE /api/notes/{id}/marks`。
  - 標註的建立 / 刪除（含畫重點）皆可 **Ctrl+Z 復原 / Ctrl+Y 重做**，與手繪塗鴉共用同一條復原堆疊（`lib/undoManager`，預覽分頁掛單一鍵盤監聽）。
- **筆記浮層（疊在內文最上層、可隨意擺放）**：預覽時畫面**右下角有固定浮動工具列**（portal + `position:fixed`，捲動內文不會被滑掉，也不會蓋到內文頂端的「編輯／匯出 PDF／刪除」按鈕），可加：
  - **便利貼**：彩色便條，可拖曳/縮放/改色/編輯文字，貼在任何位置、覆蓋內容最上層。
  - **手繪塗鴉**：工具列含 自由筆／直線／矩形／橢圓，與**兩種橡皮擦**——🧹 **整筆刪除**（點一筆即刪整筆）與 🧽 **局部擦除**（擦到哪、那裏消失，自由筆會斷開成多段）；可選**完整色盤**、**線寬**（同時作為局部橡皮擦半徑）、**虛線**；作畫層級高於文字與其他元素；可清除。各工具可再點一下關閉（回到一般互動）。支援 **Ctrl+Z 復原 / Ctrl+Y（或 Ctrl+Shift+Z）重做**（與畫重點共用同一堆疊；在便利貼/輪播輸入框內則交給原生文字復原，不攔截）。
  - **圖片輪播（Slide）**：以圖片網址建立輪播框，自動切換＋手動上下張，可拖曳/縮放。
  - 全部**持久化於資料庫**（`NoteOverlayItem`，取代舊的 localStorage 浮動白板，故可跨裝置、可備份）。浮層容器 `pointer-events:none`、個別元件 `auto`，不影響底下文字選取（與上方文字標註並存）。後端 `GET/POST/PUT/DELETE /api/notes/{id}/overlay`。
- **問題功能（便利貼／T 文字框可設為「問題」）**：便利貼標題列與文字框選取時各有 **❓ 設為問題／移除問題**；已標記者顯示 ❓ 記號。
  - 筆記右上工具列「全部展開/收合」左邊新增 **❓ 問題清單 (N)** 鈕：開啟浮動面板列出本篇所有問題（便利貼→標題、T→文字前段），點列項目**捲動定位＋高亮**該浮層，最右「答」鈕開**可拖曳的答題彈窗**（似便利貼但有關閉鈕、可同時開多個、刷新即消失）。
  - 答題彈窗＝「問題」（唯讀）＋「回答」（可編輯）：可手寫，或 **🤖 請 AI 回答**（以整篇筆記為脈絡、非同步完成後覆蓋回答框，**Ctrl+Z 可還原**覆蓋前內容）；「儲存」寫回；未存就關閉會先跳確認。
  - **分類問題清單頁 `/notes/questions`**（分類頁與「全部」頁的置頂列有 **❓ 問題清單** 入口）：展示該分類**與所有子孫分類**的所有問題，並可勾選篩選分類（限自己與子孫；「全部」頁另有「(未分類)」）。後端 `GET /api/questions?categoryId=`、`POST /api/notes/{id}/ask-question`。
- **版本追蹤**：編輯歷史（NoteRevision）
- **AI 兩鍵（編輯模式）— 真實 Gemini**：
  - **⚙️ 調整排版**：只調整 Markdown 格式（標題層級、列表、表格、中英文間距、收斂空行…）不改語意；提示對齊 `scripts/format-md.ps1` 的排版專家規則。
  - **✨ 美化內容**：保留原意下潤飾措辭、結構與可讀性。
  - 兩者經既有 AI 供應者層呼叫「全站共用預設 Gemini 模型」（banana-gemini-lite）；後端**只回傳轉換結果、不寫入資料庫**，由使用者按「保存」才落地——避免覆蓋未存編輯，並消除與保存同時寫入的競態。AI 進行中與保存互鎖（彼此停用），另有「↶ 撤銷」可還原上一次 AI 結果（純前端、不需保存）。
  - （原「浮動白板」僅存 localStorage、非預期用途，已移除；新版白板/便利貼構想見 issues 規劃。）
- **知識圖譜**（子頁）：視覺化展示筆記間的反向連結與分類關係
- **留言**：支援範圍選取留言（與開問啦同樣機制）

### 3. 日程規劃 / 任務（Tasks）
- **卡片式待辦**：todo / doing / done / custom 等狀態
- **任務編輯彈窗（單一、永遠可編輯）**：開啟任務即直接是可編輯表單（不再有「檢視 →（點一下）編輯」兩段式，合併成一個彈窗）。版面：**標題置頂**；其下分兩欄——**左欄**放所有屬性（狀態／優先度／分類／標籤／開始日期／截止日期／父任務／子任務／關聯，**狀態與優先度為小巧的分段鈕**），**右欄**放內容（Markdown 編輯器，工具列備齊 **H1~H3／粗・斜・刪除線／項目・編號・待辦清單／引用／行內＋區塊程式碼／表格／圖片／分隔線／連結**）。**交易式編輯**：所有欄位與子任務變更（含解除父子關係）都**只暫存於彈窗，唯有按「儲存」才寫入後端**；關閉／返回／進入子任務若有未存變更會先詢問是否放棄，放棄則全部還原（不寫入）。**進入子任務後再關閉會回到父任務**（導覽堆疊；子任務時左上顯示「←」返回、唯有根任務的「✕／Esc」才完全關閉）。子任務列每列有「↗ 開啟」「🔗 關聯」「✕ 移除父子關係」（皆暫存、按「儲存」才生效）。**✕ 只解除父子關係、不刪除任務**（會先跳確認；該任務變成獨立頂層任務，仍存在、可再設父任務）；要徹底刪除請「↗ 開啟」該任務後用編輯器的「刪除」（兩段式確認）。
- **多視圖**：
  - 清單視圖：**排序方式**＝建立日期 / 排程日期 / 截止日期（三個日期相鄰）/ 分類名稱 / 急迫度（優先度）/ 狀態；其右為「↑ 正序 / ↓ 逆序」方向鈕，再右為「⊟ 拆行 / ☰ 不拆行」鈕。**預設＝急迫度・逆序・拆行**。**拆行**＝依排序值分組顯示（每個值如某天/某分類/某狀態自成一組、標題單獨一行、可逐組展開收合，無值者如「未排程／未分類」排最後）；**不拆行**＝單純扁平清單。
  - 看板視圖（狀態欄；拖拉卡片改狀態；手機自動改單欄堆疊）
  - 行事曆視圖（**年 / 月 / 週 / 日**；點任務開編輯器）
    - **點空白格子即新增（Google Calendar 風）**：**月**視圖點某日格 → 彈出「新增任務」表單並預填當日 09:00–10:00；**週**視圖為「週日～週六 × 0~23 點」時間格、**日**視圖為「單日 × 0~23 點」時間格，點任一小時格 → 預填該小時～下一小時。所有預填的開始／截止時間皆可再調整；表單可同時填標題、優先度、分類、**內容（Markdown，與完整編輯器同一套工具列）**，建立後即時反映。月視圖每格右下的「+N」鈕仍可開當日完整清單。（同一張「新增任務」表單也由 Todo 頁的 `A` 快捷鍵叫出。）
    - **週／日時間格（分鐘精度＋可拖曳，Google Calendar 風）**：單日有時段的任務以**絕對定位**依實際時間呈現——top＝開始分鐘、height＝時長（如 15:30~16:00 落在 15:30、佔半格；20:00~22:00 佔兩格）。任務可**整塊拖曳移動**（保留時長；週視圖可橫移到其他天）、**拖上／下緣縮放**起訖時間（對齊 15 分、最短 15 分）；放開即存（樂觀更新、失敗重抓還原）。重疊的任務自動並排分欄。點任務塊＝開編輯器、點空白＝新增該時段。共用元件 `CalendarTimeGrid`。註：拖曳/縮放會把該任務寫成「有起有迄」（plannedDateTime＋dueDateTime）。**時區假設**：欄位日期以瀏覽器本地日期標示、任務以使用者時區歸日，兩者在「瀏覽器＝使用者時區」時一致（本專案使用者 Asia/Taipei）。
    - **跨日橫條（Google Calendar 風）**：有「起～迄」期間的任務會畫成一條橫跨多天的橫條；月視圖跨週會分段並以 ◀/▶ 標示延續、同列重疊的橫條自動往下堆疊（lane）；週／日視圖在「全天」區**只**以橫條呈現**跨日**任務（單日有時段者改由上述時間格呈現、不重複）；年視圖以小月曆把涵蓋日連成色帶。後端 `/api/calendar` 以「區間重疊」查詢（非僅落點），長任務跨整個視窗也抓得到。
- **子任務＝「有父任務的任務」**（#8 重構）：子任務與一般任務是同一種實體（TaskCard），只是多了父子關係（`ParentId`）。
  - 清單／看板卡片直接內嵌顯示子任務與進度，可單獨收合、可一鍵收合全部（在「時間」列右側）。**只點核取方塊才會切換完成**（點整列不會誤觸）；**點子任務標題會開啟「完整任務編輯器」**（與點父任務完全相同——子任務就是任務）。
  - **頂層／全部切換**（按鈕在「收合子任務」旁）：「只顯示頂層」時子任務內嵌於父卡；「顯示全部」時子任務也會以獨立卡片列出。
  - 任務編輯器可設定「**父任務**」（搜尋既有任務；留空＝頂層任務），即可把任兩個任務建立父子關係。子任務具備建立日期與完成日期（狀態轉 done 記錄完成時間、離開 done 清除）；刪除父任務會連同子任務一併刪除。
  - 後端：`TaskCard.ParentId` 自我參照 + `CompletedDateTime`；既有舊版子任務（SubTask 表）已**加性遷移**成子任務卡片，原表保留為備份。
- **篩選**：分類＋標籤同一行，點任一開啟共用篩選彈窗（可摺疊段＋全選＋核取方塊）；主列摘要至多 3 個 chip，其餘以 `…+N` 表示。**時間**篩選（全部／今天／逾期／未排程）為「單一邊框的分段控制（segmented control）」，視覺與分類／標籤一致，不再是各自獨立邊框的 chip。
- **鍵盤快捷鍵（可自訂改鍵）**：左側欄列出目前生效的鍵位。預設——**全域**（任何頁面）：`T` 前往 Todo、`Q` 開問啦、`N` 筆記、`F` 聚焦搜尋框；**Todo 頁**：`Y/M/W/D` 切年/月/週/日行事曆、`V` 循環顯示模式（清單→看板→行事曆）、`A` 彈出新增任務表單。每個動作都可在「個人頁 → 快捷鍵」重新綁定並儲存（見 §7.1）。輸入文字時不會觸發。
- **卡片屬性**：標題、內容、優先級、期限、計畫日期、重複規則
- **群組**：將相關卡片分組（如「專案 A」包含多個子任務）
- **關聯**：卡片可連到筆記（NoteTaskLink），或與其他卡片相連
- **跨模組雙向關聯（任務／子任務 ↔ 筆記 ↔ 開問啦節點）**：在任務編輯彈窗左欄「關聯」區（任務本身）或子任務列旁的「🔗」開**浮動視窗**（點視窗外即關閉、無關閉鈕）。視窗可：
  - **已關聯清單置頂可見**：點任一已關聯項目即**前往**該筆記 / 開問啦節點 / 任務（任務會跳到當天行事曆）；旁邊 ✕ 解除關聯。
  - **搜尋既有項目來關聯**：不預先列出（避免一長串眼花），輸入關鍵字才搜尋既有的筆記 / 任務 / 節點（依來源型別決定可關聯的目標型別），點一下即建立關聯；已關聯者標示「已關聯」。
  - **建立新項並關聯**（僅任務／子任務來源）：① 建立**新筆記**並帶入標題；② 建立**新開問啦畫布＋初始節點**並預填名稱（**先不問 AI**）。
  - 下半列出已關聯項目，可點擊前往或解除。
  - **雙向**：筆記頁與開問啦節點抽屜上的「🔗 關聯」列也能反向搜尋並關聯既有任務（及彼此）；點關聯的任務即**導回該任務當天的行事曆週視圖**。
  - 後端：`GET /api/links/candidates`（搜尋候選、標示已關聯）、`POST /api/links`（建立）、`DELETE /api/links/{id}`（解除）；所有寫入端點都會驗證來源與目標皆為**本人擁有**（多租戶邊界）。底層為泛型 `EntityLink` 表（一列即雙向，支援任務/子任務/筆記/節點任兩者互連）。
- **快速錄入**：首頁快速捕捉 → 自動建卡片

### 4. 行事曆（已併入「日程規劃」）
- 行事曆不再是獨立頁面（`/calendar` 已移除），而是「日程規劃 (/tasks)」的一個視圖（年/月/週/日）。Header 導覽順序：**ZonWiki → 日程規劃 → 開問啦 → 筆記**。
- 跨日橫條、年視圖等細節見上方「3. 日程規劃」。

### 5. Canvas / 開問啦（AI 繪畫工具）
- **原樣吸收**：不動外觀、操作、CSS；只換後端資料來源
- **功能**：
  - 自由繪圖畫布（節點/邊/文字）
  - 節點支援圖片、AI 聊天（每個節點可獨立選擇模型）
  - 畫布分類 + 系統提示詞管理
  - 實時 SSE 聊天（邊繪邊聊）
  - 反向連結、高亮、註記
  - **節點內框選文字**（編輯模式外）即浮現工具面板：**畫重點**（**完整色盤**，react-colorful，**選色即套用**、存 hex 於 `Highlight`）、**連結到其他節點**（存 `InlineLink`，點擊跳轉）、**框選提問**（產生回答節點＋行內連結）、選取生圖。錨點用「文字＋字元位移＋前後文」儲存，內容編輯後會自動重新定位（reAnchor）。
    - 修正（2026-06）：此面板原本在 `QaNode` 被以「功能開發中…」佔位擋住（後端與其餘前端皆已就緒），已接上真正的 `SelectionPopover`。
- **工具列**：切換／改名／刪除畫布收攏在一個下拉選單（CanvasMenu），其後為視圖模式、平移、通知中心、設定、＋新畫布。
- **整合修正（2026-06）**：
  - AI 提問／追問背景流程過去因「使用者隔離全域查詢過濾在無 HttpContext 的背景工作中以 `Guid.Empty` 把資料濾掉」而靜默無回應；已在 `ZonWikiDbContext` 加入背景使用者覆寫（`SetCurrentUserId`），由 `AskOrchestrator` 於查詢前設定。
  - 畫布／節點刪除回 `204 No Content`，前端 `http` 用戶端原本硬解析 JSON 而拋錯、跳過樂觀更新（「刪了要刷新」）；已改為容忍空 body。
  - 新增節點／編輯內容／刪除皆改為樂觀更新，免刷新即反映。
  - **AI 模型機制對齊開問啦原版（差別只在存 DB）**：模型清單來源為設定檔 `src/ZonWiki.Api/ai-models.json`（含金鑰、已 gitignore；範本為 committed 的 `ai-models.example.json`，金鑰用 `${ENV}` 佔位），格式與原版相同。`ListModels` 載入時把設定檔模型寫進 DB（金鑰用 Data Protection 加密存 `AiModel_ApiKeyEncrypted`）；之後 DB 為真相，可在「設定」頁編輯。節點下拉只顯示 enabled 且 Kind=chat 的模型，value=模型 Key。
  - **共用預設模型（系統擁有、設定頁隱藏、金鑰只存一份）**：設定檔中標記 `"IsDefault": true` 的模型（目前為 `banana-gemini-lite`／Gemini Flash Lite）會以「系統身分」(`AiProviderFactory.SharedModelUserId`) 植入**一份**到 DB，金鑰加密。它不屬於任何使用者 → **不會出現在任何人的「設定頁(AI 模型管理)」或節點下拉具名清單**（避免金鑰外洩），只作為節點的「預設」被使用（`ResolveAsync`：節點未選模型時即走它）。**所有人免設定即可用預設**；想用其它模型再自行於設定頁新增（帶自己的金鑰）。種子三規則：IsDefault+金鑰→系統共用一份；無金鑰（Claude CLI）→ 補到使用者名下；有金鑰但非預設→不植入（不把擁有者金鑰複製給每位使用者）。

### 6. 全域搜尋（Header）＋ 獨立進階搜尋頁（/search）
- 快速搜尋欄（Header 固定）
- 支援全文搜尋筆記（標題／內文）、任務、Canvas 畫布與節點、標籤、分類、快速捕捉，以及**筆記浮層的 T 文字框與便利貼**（`overlay-text`／`overlay-sticky`；便利貼含標題）。點浮層結果會開該筆記並 `?overlay=` 捲動定位到該元件。
- **結果脈絡（區分同名筆記）**：下拉的筆記結果會顯示所屬**分類完整路徑**（📁 學習 / 併發）與**標籤**（🏷 dotnet），浮層結果顯示所屬筆記標題（於《…》）——解決「多篇同名 README 分不清是哪一篇」。後端 `SearchResultDto` 對筆記帶 `categories`/`tags`、對浮層帶 `parentTitle`、所有型別帶 `updatedAt`（皆為選擇性欄位）。
- **類型篩選 chips**：全部／筆記標題／筆記內文／任務／T(文字)／便利貼／開問啦節點（多選；後端 `?types=` CSV，未帶＝全部）。
- **獨立進階搜尋頁 `/search`**（下拉底部「🔎 進階搜尋『…』→」或 Header 搜尋「進階搜尋」進入）：大搜尋框＋更完整的篩選——全 10 種型別 chip、**分類下拉（樹狀縮排，含子孫分類）**、**標籤多選**、**排序（相關性／最近更新）**、關鍵字高亮、「載入更多」（`limit` 遞增至上限 500）。所有條件同步進 URL（可分享、重整還原）。後端新參數：`categoryId`（含**所有子孫分類**）、`tags`（CSV，任一命中）、`sort`（relevance｜updated）；帶 `categoryId`/`tags` 時**只回筆記**，**空關鍵字＋分類/標籤＝瀏覽該範圍全部筆記**（依更新時間排序）。
- 關鍵字高亮；便利貼標題存 `DataJson.title`，故搜尋以整欄 ILIKE 比對（顯示標題時於後端安全解析 JSON）。

### 7. 系統設定（Account & System）
- **帳號**：登出；(OAuth 待設定時用)
- **顯示模式**：4 種主題（暖紙、明亮、暗色、夜間）
- **時區**：IANA 時區選擇（預設從裝置推斷）
- **AI 模型管理**：管理員新增 Claude/Gemini/OpenAI 金鑰（加密儲存）

### 7.1 註冊與個人頁（Auth & Profile）
- **帳號制登入（不使用 email）**：註冊與登入只需「帳號（username）＋密碼」，**不需要 email、不需要驗證碼**。註冊需輸入兩次密碼並驗證一致。帳號儲存於 `User_Email` 欄位（沿用該欄，不改 schema；本系統不要求 email 格式，例如帳號可為 `alice`）。
  - 後端：`POST /api/auth/register {account,password,displayName}`、`POST /api/auth/login {account,password}`。
- **本機帳號修正**：本機帳號 `GoogleSub` 為可空（nullable）＋過濾式唯一索引（見 migration `MakeGoogleSubNullable`）。
- **個人頁 `/profile`（已拆成子頁，由「個人頁專屬左側欄」導覽）**（點右上角頭像 →「個人頁面」）：原本所有資訊擠在一頁、且左側欄誤用了筆記側欄；現在 `/profile*` 有自己的側欄（帳號資訊／統計數據／活動紀錄／快捷鍵），各子頁各自載入自己的資料：
  - **帳號資訊 `/profile`**：帳號（唯讀）、修改暱稱（首頁顯示「你好，暱稱！」）、**顯示時區**、修改密碼（新密碼輸入兩次且一致）、帳號建立時間、是否綁定 Google、帳號操作（登出／刪除帳號——軟刪除並立即登出）。
  - **顯示時區（#7）**：可選擇全站時間顯示所用的時區（以 UTC 偏移標示的下拉，例如 `UTC+00`／`UTC+08`，或「跟隨裝置」）。資料一律存 UTC，僅顯示時換算；改成例如 UTC+0 後，**全站所有時間顯示**（筆記/任務/行事曆/活動紀錄/建立時間…）都會跟著變。儲存後整頁重新載入以即時套用。**關鍵修正**：`GET /api/me` 現在會從 DB 回傳 `timeZone`（與 `displayMode`）——先前未回傳，導致前端各處的 `user.timeZone` 永遠落到預設台北、使用者設定的時區從未生效。
  - **統計數據 `/profile/stats`**：筆記／任務／畫布／節點／常用連結／快速記錄／標籤／分類筆數。
  - **活動紀錄 `/profile/activity`**：每日活動（近 30 天，依裝置時區歸日）＋**活動明細（近 30 天逐筆操作紀錄）**——列出「對哪個實體做了什麼」（新增／編輯／刪除／還原，標題級，不含完整內容），涵蓋筆記、任務、子任務、開問啦節點、API 金鑰、快速記錄、常用連結、系統提示詞。底層由 EF Core 的 `ActivityLogInterceptor` 在每次 SaveChanges 自動記錄（連 AI 自動建立的節點也會記），寫入 `ActivityLog` 表（依使用者隔離）。
    - **變更摘要（改了什麼）**：「編輯」項目會顯示**變更內容摘要**（`ActivityLog_Detail`）——短欄位附「標題『舊』→『新』」、長文欄位只列名稱（如「內容」）、分類/標籤異動列出「加入分類『工作』；移出分類『暫存』」。攔截器排除稽核欄、影子屬性（xmin）與衍生欄（ContentHtml/Slug/ContentHash）以免噪音，摘要截斷於 500 字元。
    - **分類脈絡（區分同名筆記）**：筆記項目會附**目前分類完整路徑**（📁 學習 / 併發），讓多篇同名筆記在明細裡也能分辨是哪一篇。
    - 分類/標籤異動（`NoteCategory`/`NoteTag`）現在也會被攔截記錄（攔 Added ＋ 軟刪/復活的 ValidFlag 翻轉），依所屬筆記**合併成同一筆** `updated`；「建立即帶分類」只記一筆 `created`（`CreateNoteHandler` 已改為單一原子 SaveChanges）。刪除整個標籤/分類時的連帶關聯移除**不**逐筆記成假活動。
  - **快捷鍵 `/profile/shortcuts`**：分「全域」與「Todo 頁」兩區列出所有快捷動作；點「重新綁定」後按下新鍵即改鍵（Esc 取消），即時偵測按鍵衝突（任兩動作同鍵則禁止儲存），可單項或一鍵全部還原預設。設定**存後端、跨裝置同步**（見下方決策）。
- **右上角大頭照選單已精簡（#4）**：選單只保留「個人頁面」連結＋「登出」。原本內嵌的「修改密碼」彈窗已移除（與 `/profile` 帳號資訊頁的修改密碼重複，且 `/profile` 那份較完整——多了「確認新密碼」欄位），改由個人頁進行。主題切換維持為標題列獨立按鈕。
- **後端端點**：`GET/PUT /api/me/profile`、`GET /api/me/stats`、`GET /api/me/activity`、`GET /api/me/activity-log`、`GET/PUT /api/me/settings`（顯示模式／時區／**快捷鍵覆寫 `shortcutsJson`**）、`DELETE /api/me`。
- **決策：快捷鍵覆寫存 DB（非 localStorage）**——遵循本專案「DB 為真實來源」方向並讓快捷鍵跨裝置同步。新增可空欄位 `User_ShortcutsJson`（migration `AddUserShortcuts`），只存「與預設不同」的最小 JSON（如 `{"openNotes":"g"}`）；空字串＝清除＝還原全部預設。前端 `lib/shortcuts.ts` 集中定義動作清單與預設、載入時與覆寫合併成生效鍵位；全域 `ShortcutRuntime`（無 UI）掛在已登入外殼監聽鍵盤，global 動作直接執行、Todo 動作僅在 `/tasks` 透過 `zonwiki:shortcut` 事件交該頁處理；儲存後廣播 `zonwiki:shortcuts-updated` → 側欄與執行器免重整即時套用。
- **登入頁守門（互斥不變式）**：外殼（標題列＋側欄）只在「已登入且不在登入頁」時顯示；`/login` 只在「未登入」時可達。已登入者進 `/login` 會在 server 端 `redirect("/")`（不會看到「登入表單套在登入後外殼裡」的矛盾畫面），未登入者進受保護路由則導回 `/login`。
- **401 統一回饋（不再靜默、也不再誤踢）**：任一 API 回 `401` 時，前端 `fetchJson` 派發 `zonwiki:unauthorized`；`SessionExpiryPrompt` 收到後**先用 `/api/me` 二次確認**並分流成兩種明確回饋：
  - **確實登出**（`/api/me` 明確回 `401`）→ 彈出「🔒 請先登入」對話窗 + 「前往登入頁」按鈕。
  - **其實仍登入 / 後端暫時不可用**（`/api/me` 回 `200`，或 5xx／逾時／連線失敗）→ 這是「暫時性 401」：**你沒有被登出，只是剛才那個操作（例如存筆記）沒成功**。會跳出一個**會自動消失（6 秒）＋可手動關閉**的輕量提示條：「⚠️ 剛才的操作沒有成功／連線忙碌或伺服器暫時中斷（你仍在登入狀態）。請稍後再試一次。」——取代過去「靜默失敗、使用者不知道發生什麼事」。對「新增／儲存」這類寫入操作**刻意不自動重試**（避免重複資料），由使用者手動重試。
- **手機漢堡選單**：Header 最右的 `≡` 僅在 ≤768px 顯示（用 `.icon-btn.mobile-nav-toggle` 提高 specificity，桌機確實隱藏），點擊開啟左側「側欄抽屜」。
- **首頁本週行程**：7 個日格可點擊展開（**預設展開今日**），以「日程規劃」同款直立卡片列出當天任務，點卡片可編輯、打勾完成不消失；另顯示當天日記。

### 7.2 資料庫連線與上雲
- 詳見 [docs/資料庫連線與上雲指南.md](docs/資料庫連線與上雲指南.md)：PostgreSQL 16 + Npgsql + EF Core 10（Code First、啟動自動遷移）；連線字串鍵 `ConnectionStrings:Postgres`；本機與設定檔（appsettings.Development.json / docker-compose.yml）統一為 **5533**；上雲用 `pg_dump`/`pg_restore` 搬資料、以 Secret 注入連線字串並開 TLS。

### 8. 統一垃圾桶（/trash）
- **跨模組集中**：所有軟刪除（`ValidFlag=false`）的項目集中一處——筆記、筆記分類、標籤、任務、任務分類、快速記錄、常用連結、筆記白板，以及開問啦的畫布與節點（開問啦原本獨立的垃圾桶已合併於此）。
- **依模組分區**：每個模組為一個可收合／展開的分區並顯示項目數；所有分區一律列出（含空的）。
- **內容預覽與刪除時間**：每項顯示標題、內容預覽片段，以及「刪除於 ⟨時間⟩」（UTC 存、依使用者時區顯示）。
- **還原 / 永久刪除**：每項可一鍵還原（`ValidFlag=true`）或永久刪除（不可復原）。
- **入口**：Header 的 🗑 圖示（手機則在側欄抽屜的「垃圾桶」）。
- 後端：`GET /api/trash`、`POST /api/trash/{type}/{id}/restore`、`DELETE /api/trash/{type}/{id}`（查詢一律 `IgnoreQueryFilters()` 才看得到軟刪除列；節點經其 Canvas 判擁）。

---

## 本機啟動（完整步驟）

### 前置需求

```powershell
# 檢查軟體版本
docker --version        # Docker Desktop (任何版本，只要能跑 Postgres)
node --version         # Node.js 20.9+（pnpm 用）
dotnet --version       # .NET 10 SDK
```

### 方式 A：開發模式（推薦）— 前後端裸跑 + Docker Postgres

**優點**：快速熱重載；易除錯；貼近開發體驗  
**步驟**：

```powershell
# 1. 只起 PostgreSQL 容器（port 5533，資料卷持久化）
docker compose up --detach

# 驗證 Postgres 就緒（通常 5 秒左右；若卡住再等等）
# 可用 pgAdmin 連線：localhost:5533，預設帳號見 docker-compose.yml

# 2. 啟動 .NET 後端 API（會自動跑 EF migrations + dev seed user）
cd src/ZonWiki.Api
dotnet run --launch-profile http
# 或指定組態
dotnet run --configuration Development --launch-profile http

# 驗證後端：開瀏覽器
# http://localhost:5009/healthz         → "Healthy"
# http://localhost:5009/api/health/ready → 詳細狀態

# 3. 另開 PowerShell，啟動前端
cd frontend

# 第一次需裝依賴（後續可省略）
pnpm install
pnpm run dev

# 驗證前端：開瀏覽器
# http://localhost:3000 → 首頁（需登入；首次使用請自行註冊帳號）
```

**停止服務**：

```powershell
# 前端：Ctrl+C（終端內）
# 後端：Ctrl+C（終端內）

# 保留資料卷、只關掉 Postgres：
docker compose down

# 完全清除資料卷（謹慎！）
docker compose down --volumes
```

#### 方式 A 進階：背景常駐啟動（不佔終端機視窗，長時間掛著推薦）

方式 A 的「`dotnet run` 開在終端機」會**佔用一個視窗**，且關掉視窗就等於停服務。
若想讓**後端跟前端、PostgreSQL 一樣是「無視窗的背景程序」獨立常駐**（關掉終端機/結束
session 都不影響），用以下腳本（已隨 repo 附上，位於 `scripts/`）：

```powershell
# 一鍵把「後端」丟到隱藏視窗的背景常駐（自動套用 EF migrations + dev seed user）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch-backend-hidden.ps1

# 驗證（首次啟動需數秒編譯）
curl http://localhost:5009/healthz          # → Healthy
# 後端日誌寫入：tmp\backend.log（UTF-8）
```

**停止背景後端**（沒有視窗可按 Ctrl+C，改用 PID）：

```powershell
netstat -ano | findstr :5009                # 找出佔用 5009 的 PID
taskkill /T /F /PID <PID>                    # 連程序樹一起砍才會釋放 port（/T = 整棵樹）
```

> 對照：**前端**（`next start`）與 **PostgreSQL**（Docker 容器）本來就是無視窗背景程序；
> 此腳本讓後端比照辦理，三者一致。
>
> 兩支腳本：
> - [scripts/start-backend.ps1](scripts/start-backend.ps1)：實際跑 `dotnet run` 並把輸出導到 `tmp\backend.log`。
> - [scripts/launch-backend-hidden.ps1](scripts/launch-backend-hidden.ps1)：以 `-WindowStyle Hidden` 把上者丟到背景。
>
> ⚠️ **編碼**：腳本含中文，必須存成 **UTF-8 with BOM**，否則 Windows PowerShell 5.1 會用
> CP950 解碼成亂碼導致解析失敗（詳見腳本內註解；這是 PS 5.1 讀無 BOM 檔的預設行為）。
>
> ℹ️ 此背景常駐法**只是本機開發的便利做法**。上雲（GCP）後三個服務都是 Docker 容器、
> 以 `restart: unless-stopped` 自動拉起，做法完全不同（部署細節見專案內部部署文件，未隨公開 repo 發佈）。

### 啟用 AI 功能（重要 — clone 下來自己跑的人必看）

筆記的「⚙️ 調整排版 / ✨ 美化內容」、開問啦節點對話、框選提問等 AI 功能，**需要至少一個可用的 AI 模型**。
全新 clone 的資料庫是空的、沒有任何模型，這些功能會無法使用。兩種啟用方式（任選其一）：

**方式 1：用網頁設定（最簡單，免動檔案）**
登入後 → 右上角頭像或「設定 → AI 模型管理」→ 新增一個模型，填入你自己的金鑰
（支援 Gemini / OpenAI 等 OpenAI 相容端點，或本機 `ClaudeCli`）。金鑰會**加密**存進資料庫。

**方式 2：用設定檔種一個「共用預設模型」（一次設定、所有帳號共用）**

```powershell
# 1) 複製範本（此檔已被 .gitignore，金鑰不會進版控）
Copy-Item src/ZonWiki.Api/ai-models.example.json src/ZonWiki.Api/ai-models.json

# 2) 取得免費 Gemini 金鑰：https://aistudio.google.com/apikey
#    然後設定環境變數（範本內金鑰用 ${GEMINI_API_KEY} 佔位，執行時才解析，金鑰不落地於檔案）
$env:GEMINI_API_KEY = "你的-Gemini-API-Key"

# 3) 啟動後端 → 會自動把 ai-models.json 內的模型「種」進資料庫（已存在則略過、不覆寫）
cd src/ZonWiki.Api
dotnet run --launch-profile http
```

> 範本 [`src/ZonWiki.Api/ai-models.example.json`](./src/ZonWiki.Api/ai-models.example.json) 內有完整欄位說明。
> `isDefault: true` 的模型會以「系統共用」身分種一份，所有使用者免設定即可用為預設；金鑰一律加密儲存。
> 完整功能與「為何要分狀態/優先度/分類/父子任務…」等概念，請見 **[docs/使用說明書.md](./docs/使用說明書.md)**。

### 方式 B：全 Docker — 一鍵啟動（正式環境參考）

**優點**：無需本機安裝 .NET/Node；貼近正式部署  
**缺點**：無熱重載；除錯較難

```powershell
# 完整容器化：前端 + 後端 + PostgreSQL 全包
docker compose --profile full up --detach --build

# 驗證
# http://localhost:3000 (前端)
# http://localhost:5009/healthz (後端)

# 查看日誌
docker compose logs -f zonwiki-api
docker compose logs -f zonwiki-web
docker compose logs -f zonwiki-postgres

# 停止（保留資料卷）
docker compose --profile full down

# 重建映像（程式碼變更後）
docker compose --profile full up --detach --build
```

### 設定 Google OAuth（正式部署用，本機開發可略）

開發環境若要用真實 Google OAuth（正式測試時）：

```powershell
# 設定本機 secrets
cd src/ZonWiki.Api
dotnet user-secrets init

dotnet user-secrets set "Authentication:Google:ClientId" "你的-Google-ClientId"
dotnet user-secrets set "Authentication:Google:ClientSecret" "你的-Google-ClientSecret"

# 驗證
dotnet user-secrets list
```

Google Cloud Console 設定回呼 URL：`http://localhost:5009/signin-google`（開發）或正式域名。

---

## 測試

### 執行全部測試

```powershell
# 單位 + 整合測試（不需啟動任何服務）
dotnet test ZonWiki.slnx --verbosity normal

# 看覆蓋率（若已安裝 coverlet）
dotnet test ZonWiki.slnx /p:CollectCoverage=true
```

### 測試結構

```
tests/
├── ZonWiki.Api.Tests/                    # API 層測試（xUnit + FluentAssertions）
│   ├── Endpoints/                        # 端點層測試（Task/NoteWrite/Calendar/QuickLink/Capture…）
│   ├── Services/                         # 服務測試（AskQueue、CanvasSystemPromptResolver…）
│   ├── Integration/                      # 整合測試（UserDataIsolationTests＝多租戶隔離，真 Postgres）
│   ├── Notes/                            # NoteContentHelpers 等
│   └── Smoke/                            # BuildSmokeTests
└── ZonWiki.Infrastructure.Tests/         # 基礎設施層測試
    └── Domain/                           # ApiResponse 等

# 整合測試用 Testcontainers.PostgreSql 起真實 Postgres 容器（見 Integration/Fixtures）。
```

### TDD 流程（CLAUDE.md 規定）

每個有邏輯的功能：

1. **寫測試計畫** → Sub-Agent 審查確認
2. **寫測試代碼**（RED — 失敗）
3. **寫實作代碼**（GREEN — 通過）
4. **重構** + 驗證覆蓋率 >= 80%

例如新功能「筆記全文搜尋」：

```powershell
# 1. 測試計畫文件（NoteSearchTests.Plan.md）
#    ✓ 搜尋單個關鍵字
#    ✓ 搜尋多字詞（AND）
#    ✓ 區分大小寫
#    ✓ 搜尋標籤
#    ✓ 空搜尋回傳所有筆記

# 2. 實際測試檔案
# tests/ZonWiki.Api.Tests/Services/NoteSearchServiceTests.cs
# 寫 xUnit 測試代碼…

# 3. 實作
# src/ZonWiki.Api/Services/NoteSearchService.cs

# 4. 驗證
dotnet test tests/ZonWiki.Api.Tests --filter "NoteSearch"
```

---

## MCP (Model Context Protocol)

ZonWiki 已內建一支 **MCP Server**（[`mcp/`](./mcp/)，Node.js + TypeScript），讓 Claude（Desktop / Code）
等支援 MCP 的 AI 助理**直接讀寫**你的知識庫、任務、捕捉與開問啦畫布，共 **45 個工具**（以 `mcp/src/index.ts` 實際註冊數為準）：

- **筆記（9）**：`list_notes`、`get_note`、`create_note`、`create_classified_note`、`update_note`、`delete_note`、`search_notes`、`get_backlinks`、`set_note_categories`
  - `create_classified_note`（推薦）：以「分類名稱路徑」自動建立巢狀分類、以「標籤名稱」自動建標籤，一次完成「資料夾→分類、Markdown→筆記、正確歸類」。
- **分類（4）**：`list_categories`、`create_category`、`update_category`、`delete_category`
- **標籤（3）**：`list_tags`、`create_tag`、`delete_tag`
- **任務（7）**：`list_tasks`、`get_task`、`create_task`、`update_task`、`delete_task`、`list_task_groups`、`create_task_group`
- **子任務（4）**：`list_subtasks`、`create_subtask`、`update_subtask`、`delete_subtask`
- **快速捕捉（3）**：`list_captures`、`create_capture`、`archive_capture`
- **開問啦畫布（5）**：`list_canvases`、`create_canvas`、`get_canvas`、`create_canvas_node`、`search_canvas_nodes`
- **跨模組關聯（4）**：`list_links`、`create_link`、`delete_link`、`get_link_candidates`
- **行事曆／活動（2）**：`get_calendar`、`get_activity`
- **垃圾桶（2）**：`list_trash`、`restore_item`
- **精煉（1）**：`refine_url`
- **身分（1）**：`whoami`

### 對外 AI 整合：API 個人存取權杖（PAT）＋ ChatGPT/Hermes

除了本機 MCP（Cookie 或權杖），ZonWiki 也支援讓**任何外部 AI**以「你的身分」呼叫 API：

- **API 權杖**：登入後到「個人頁 → API 權杖」產生（可命名、設到期、隨時撤銷；資料庫只存 SHA-256 雜湊、明碼只顯示一次）。
  AI 客戶端以 `Authorization: Bearer <權杖>` 帶上即可（與 Cookie 並存，互不影響）。
- **AI 友善端點** `POST /api/ai/notes`：以「分類名稱路徑＋標籤名稱」一次建立/更新筆記並自動歸類（支援 `upsert` 避免重複）。
- **ChatGPT（Custom GPT Action）**：精簡 OpenAPI 文件公開於 `GET /openapi/zonwiki-ai.json`；在 Custom GPT 的 Action 匯入該 URL、認證選 Bearer 貼上權杖即可寫筆記並分類。
- **Hermes / 自訂 agent**：以遠端 MCP 或直接呼叫 REST API（皆帶 Bearer 權杖）。

### 快速啟用

```bash
cd mcp
npm install && npm run build      # 產生 dist/index.js
```

接著在 Claude 設定檔加入（參考 [`mcp/claude-config-example.json`](./mcp/claude-config-example.json)）：

```jsonc
{
  "mcpServers": {
    "zonwiki": {
      "command": "node",
      "args": ["<ZonWiki-repo 絕對路徑>/mcp/dist/index.js"],
      "env": {
        "ZONWIKI_API_BASE": "http://localhost:5009",
        "ZONWIKI_API_COOKIE": "ZonWikiAuth=你的登入 Cookie"
      }
    }
  }
}
```

> ZonWiki 後端為 Cookie 認證、強制登入，故需以 `ZONWIKI_API_COOKIE`（或 `ZONWIKI_API_TOKEN`）傳入認證。
> 安裝、認證取得、45 工具完整參考與故障排除，**詳見 [docs/MCP使用說明.md](./docs/MCP使用說明.md)**。

---

## 開發指南

### 檔案組織

```
src/
├── ZonWiki.Domain/                 # 領域層（無依賴）
│   ├── Entities/                   # 資料實體（EF Core 映射）
│   │   ├── Note.cs
│   │   ├── TaskCard.cs
│   │   └── Canvas.cs
│   ├── ValueObjects/               # 值物件
│   │   └── NoteSlug.cs
│   └── Interfaces/                 # 服務介面
│       ├── INoteSyncService.cs
│       ├── IAiProvider.cs
│       └── ISearchService.cs
│
├── ZonWiki.Infrastructure/         # 基礎設施層（含 EF Core）
│   ├── Data/                       # DbContext + Migrations
│   │   ├── ZonWikiDbContext.cs
│   │   └── Migrations/
│   └── Services/                   # 服務實作
│       ├── NoteSyncService.cs
│       ├── AiProviders/            # Claude/Gemini/OpenAI
│       └── NoteAiService.cs
│
└── ZonWiki.Api/                    # API 層（Controllers + DI）
    ├── Controllers/
    ├── Models/                     # Request/Response DTO
    ├── Middleware/
    └── Program.cs                  # 啟動點 + DI 設定
```

### 命名規則（CLAUDE.md）

**資料表**：PascalCase，無下劃線  
例：`User`, `Note`, `TaskCard`, `CanvasCategory`

**欄位**：`{TableName}_{FieldName}` 形式  
例：`Note_Title`, `TaskCard_Status`, `User_TimeZone`

**C# 類別成員**：camelCase；帶繁體中文 `<summary>`

```csharp
public class Note
{
    /// <summary>
    /// 筆記的唯一識別碼
    /// </summary>
    public Guid Note_Id { get; set; }
    
    /// <summary>
    /// 筆記標題
    /// </summary>
    public string Note_Title { get; set; }
}
```

### 每個實體的 6 審計欄（必須）

```csharp
/// <summary>
/// 筆記建立時間（UTC）
/// </summary>
public DateTime Note_CreatedDateTime { get; set; }

/// <summary>
/// 筆記建立者（UserId）
/// </summary>
public string Note_CreatedUser { get; set; }

/// <summary>
/// 筆記最後修改時間（UTC）
/// </summary>
public DateTime Note_UpdatedDateTime { get; set; }

/// <summary>
/// 筆記最後修改者（UserId）
/// </summary>
public string Note_UpdatedUser { get; set; }

/// <summary>
/// 筆記軟刪除時間（nullable，未刪除為 null）
/// </summary>
public DateTime? Note_DeletedDateTime { get; set; }

/// <summary>
/// 邏輯刪除旗標（false = 已刪除，不在查詢結果中）
/// </summary>
public bool Note_ValidFlag { get; set; } = true;
```

### 多租戶隔離（UserId 直接隔離）

```csharp
// EF Core 全域查詢過濾設定（DbContext）
modelBuilder.Entity<Note>()
    .HasQueryFilter(n => 
        n.Note_UserId == _currentUserId &&  // 使用者隔離
        n.Note_ValidFlag == true);          // 軟刪除過濾

// API 層確保 _currentUserId 來自已驗證 HttpContext
var userId = HttpContext.User.GetUserId();  // 自訂擴展方法
if (string.IsNullOrEmpty(userId))
    throw new UnauthorizedAccessException();
```

### 程式碼與註解規範

- **中文註解**：所有複雜邏輯、商業規則、決策理由都要有繁體中文註解
- **換行**：參數多於 3 個時主動換行
- **可讀性優先**：不要寫簡寫變數；不用單字母迴圈（除非確實是簡單迴圈）

例：

```csharp
/// <summary>
/// 根據 Markdown 內容生成筆記 HTML，並建立反向連結
/// </summary>
/// <remarks>
/// 邏輯：
/// 1. Markdig 解析 Markdown
/// 2. 提取 [[WikiLink]] 並建立 NoteLink 關聯
/// 3. 快取 HTML（Note_ContentHtml）
/// 决策：不動態重新解析，避免效能耗損（記在決策文件）
/// </remarks>
public async Task ProcessNoteContentAsync(
    Note note,
    string markdownContent,
    CancellationToken cancellationToken = default)
{
    // 1. 解析 Markdown
    var pipelineBuilder = new MarkdownPipelineBuilder()
        .UseWikiLinks();
    var pipeline = pipelineBuilder.Build();
    var html = Markdown.ToHtml(markdownContent, pipeline);
    
    // 2. 提取 Wiki link 並建立反向連結
    var links = ExtractWikiLinks(markdownContent);
    // …省略詳細程式碼…
}
```

### 時間一律 UTC，前端依時區顯示

```csharp
// 後端存儲（UTC）
note.Note_CreatedDateTime = DateTime.UtcNow;

// 前端讀取並轉換
const dateTimeUtc = new Date(apiResponse.note_CreatedDateTime); // UTC
const userTimeZone = user.userTimeZone; // "Asia/Taipei"
const localDateTime = dateTimeUtc.toLocaleString('zh-TW', {
  timeZone: userTimeZone
});
```

---

## 相關文件

| 文件 | 內容 |
|---|---|
| [使用說明書.md](./docs/使用說明書.md) | **新手必讀**：每個功能怎麼用、為何要分狀態/優先度/分類/標籤/父子任務/關聯/反向連結，附圖文 |
| [MCP使用說明.md](./docs/MCP使用說明.md) | 讓 Claude 等 AI 助理直接讀寫 ZonWiki（45 工具、安裝、認證、故障排除） |
| [升級執行計畫.md](./docs/design/升級執行計畫.md) | 鎖定決策、目標架構、資料模型、分階段路線圖 |
| [升級藍圖-個人知識與任務作業系統.md](./docs/design/升級藍圖-個人知識與任務作業系統.md) | 願景與系統定位 |

---

## 常見問題

**Q: 開發時需要 Google OAuth 嗎？**  
A: 不需要。本機開發可自行註冊帳號直接登入；正式部署時才設定 Google OAuth。

**Q: 筆記怎麼編輯？**  
A: 全部在網頁上編輯，直接寫入 PostgreSQL（DB 為唯一真相）；不再有 Markdown 檔案或檔案同步機制。

**Q: 如何區分「本機開發」的資料與「正式」的資料？**  
A: 使用不同的 PostgreSQL 資料庫名稱或連接字串（`appsettings.Development.json` vs `appsettings.Production.json`）。

**Q: 如何升級資料庫？**  
A: EF Core Code-First 流程：修改 `Entities` → 跑 `dotnet ef migrations add MigrationName` → `dotnet run` 自動應用。

**Q: 怎樣確保多人編輯不衝突？**  
A: 目前筆記／任務／節點為 last-write-wins（後存者覆蓋），但每次更新都會寫入 NoteRevision／NodeRevision 版本快照，被覆蓋的內容可從版本歷史還原。**樂觀鎖（rowversion）已排入導入計畫**（見 [docs/DECISIONS.md](./docs/DECISIONS.md) 2026-07-06 一則），完成後衝突時會回 409 並提示使用者選擇覆蓋或重載。

**Q: AI 金鑰存在 DB，會不會洩露？**  
A: 金鑰存 `AiModel_ApiKeyEncrypted`，用 ASP.NET Core Data Protection 加密（依賴機器金鑰），僅解密時還原。不存明碼。

**Q: 如何監控正式環境？**  
A: 健康檢查端點 `/healthz` + `/api/health/ready`；正式環境已接 **GCP Ops Agent**，把容器 log 送進 **Cloud Logging**、機器指標（CPU／記憶體／磁碟）送進 **Cloud Monitoring**，皆可在 GCP Console 以 GUI（Logs Explorer／VM 的 Observability 分頁）查詢。

---

## 授權與貢獻

- 此專案為個人知識系統，主要維護者自行規劃進度
- 貢獻指引：遵守 CLAUDE.md 命名規則、TDD 流程、繁體中文註解
- 提交 PR 前確保測試通過、無 lint 錯誤、覆蓋率 >= 80%

**最後更新**：2026-07-06
