# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。

---

## 2026-07-06 ｜ 端點限流用 .NET 內建 RateLimiter（單機記憶體，不引入 Redis）

- **背景**：審查發現 #30/#58——全站無 rate limit。對外的 PAT（Bearer）與 AI 提問／精煉端點會實際觸發付費 LLM 呼叫（HttpClient timeout 甚至到 600 秒）並以 fire-and-forget spawn yt-dlp/ffmpeg 子行程；一個被盜權杖或迴圈就能灌爆外部 API 額度或撐爆 2GB VM 記憶體。密碼登入端點也無嘗試次數限制（可暴力破解）。
- **考慮過的選項**：(1) 分散式限流（Redis 計數，跨實例一致）；(2) .NET 內建 `System.Threading.RateLimiting` 單機記憶體計數；(3) 反向代理層（Cloudflare/Nginx）限流。
- **最終決定**：採 **(2) .NET 內建 RateLimiter**（`AddRateLimiter` + `UseRateLimiter`），三個具名 policy：
  - `zonwiki-login`：密碼登入／註冊，以**用戶端 IP** 分區的 FixedWindow（10 次/分，較嚴，防暴力破解）。
  - `zonwiki-ai`：AI 提問／精煉，以 **UserId** 分區的 SlidingWindow（20 次/分，防迴圈灌爆付費 LLM）。
  - `zonwiki-pat`：PAT 對外整合端點（/api/ai/notes）與權杖產生，以 **UserId／權杖** 分區的 TokenBucket（容量 30、每分補 15）。
  逾限一律回 **429＋Retry-After＋明確 JSON 訊息**；以 `RequireRateLimiting(policyName)` 掛端點。`UseRateLimiter` 置於驗證/授權之後，使分區函式讀得到 `user_id` 宣告。IP 解析優先採 `CF-Connecting-IP`／`X-Forwarded-For`（正式環境走 Cloudflare Tunnel，`RemoteIpAddress` 會是代理 IP）。
- **理由與取捨**：本系統為**單實例部署**（單台 VM），分散式一致性目前用不到，Redis 是額外運維負擔（YAGNI）；內建方案零依賴、夠用。**取捨**：計數只在單行程記憶體，重啟即歸零、且日後水平擴充時各實例各算各的——屆時再換 Redis 後端或移到代理層。
- **已涵蓋端點清單（`zonwiki-ai` = AiPolicy）**（2026-07-06 補記）：
  - `AiEndpoints.cs` → `POST /api/ai/ask`
  - `RefineEndpoints.cs` → 精煉（URL）＋上傳精煉兩端點
  - `KaiWenCanvasEndpoints.cs` → **開問啦畫布本體三個核心 AI 提問端點**：`POST /api/canvas/canvases/{canvasId}/ask`、`/ask-followup`、`/ask-inline-link`（初版 W2 漏掛，對抗式復審抓出後補上——這三個是站上互動量最大、fire-and-forget 呼叫付費 LLM 的路徑，未掛則整個「AI 端點無上限觸發」風險只解一半）。
  - `zonwiki-pat`（PatPolicy）：`AiIntegrationEndpoints.cs`（/api/ai/notes）、`ApiTokenEndpoints.cs`（權杖產生）。
  - `zonwiki-login`（LoginPolicy）：`AuthPasswordEndpoints.cs`（登入／註冊）。

## 2026-07-06 ｜ CORS 允許來源正式環境須顯性提供（缺省不再回退 localhost）

- **背景**：`Cors:AllowedOrigins` 缺省時原本一律回退 `http://localhost:3000`；正式環境未設 `Cors__AllowedOrigins`，靠前後端同源才沒出事（審查 Low 發現）。
- **最終決定**：缺省回退 `localhost:3000` **僅限開發環境**；正式環境未設定時回退為**空清單（不允許任何跨域來源）**，強迫由環境變數/設定顯性提供。
- **理由與取捨**：讓正式環境設定顯性化、避免靜默沿用不合實情的 localhost。**取捨／注意**：**部署正式環境務必設 `Cors__AllowedOrigins`**（例如 `https://zonwiki.pee-yang.com`），否則跨子網域/第三方前端的帶認證請求會被 CORS 擋下。

## 2026-07-06 ｜ 導入樂觀鎖（rowversion）處理並發編輯

- **背景**：審查發現 Note／Node／TaskCard 皆為 last-write-wins、無任何併發權杖，多裝置或「使用者＋外部 AI」同時編輯同一筆會靜默覆蓋；且 README 曾誤稱「已採樂觀鎖」。各功能實際衝突機率不高。
- **考慮過的選項**：①維持現狀只修文件；②悲觀鎖（DB 層 lock）；③樂觀鎖：PostgreSQL `xmin` 系統欄當 concurrency token；④樂觀鎖：自建 `byte[] RowVersion` 欄。
- **最終決定**：採**樂觀鎖，選項③以 PostgreSQL `xmin` 系統欄當 concurrency token**（免新增資料欄位）。更新端點接受 client 可選 `baseVersion`，`SaveChanges` 遇 `DbUpdateConcurrencyException` 回 HTTP 409，前端提示「已被其他來源修改」讓使用者選擇覆蓋或重載。
- **理由與取捨**：衝突機率低 → 悲觀鎖成本過高不划算；樂觀鎖足夠且體驗好。既有 NoteRevision／NodeRevision 版本歷史已可還原被覆蓋內容，樂觀鎖補上「事前偵測」這一環。
- **實作備註（Npgsql 10）**：Npgsql EF Core 10 已**移除** `UseXminAsConcurrencyToken()`；改以等價設定「影子屬性 `xmin` 映射到系統欄 `xmin(xid)` + `ValueGeneratedOnAddOrUpdate()` + `IsConcurrencyToken()`」（見 `Configurations/XminConcurrencyConfiguration.cs`）。另因本專案有 `{Table}_{Column}` 命名慣例，必須在 `ModelBuilderExtensions` 中**略過 xmin 欄的前綴改名**，否則欄名變 `Note_xmin` 會被 Npgsql 當一般欄位而在 Migration 產生 `AddColumn`。Migration `AddXminConcurrencyToken` 對 xmin 系統欄不產生任何 DDL（`ef migrations script` 實測 0 筆 xmin/xid DDL），對既有 DB 為安全 no-op。
- **範圍取捨**：節點「佈局拖曳」為高頻操作，前端**不帶** `baseVersion`（維持 last-write-wins，避免拖曳時誤觸 409）；只有「內容／表單保存」路徑（筆記 handleSave、任務編輯、節點內容）帶版本並處理 409。

## 2026-07-06 ｜ Rate limiting 用 .NET 內建、不引入 Redis

- **背景**：全站無 rate limiting，AI／精煉／PAT／登入端點可被無上限觸發（燒錢／暴力破解）。正式環境為單台 GCE VM（asia-east1-b, e2-small 2GB）。
- **考慮過的選項**：①.NET 內建 `RateLimiter`（行程內記憶體計數）；②Redis 分散式計數；③反向代理層（Cloudflare）限流。
- **最終決定**：用 **.NET 內建 `RateLimiter`**（`AddRateLimiter` + `UseRateLimiter`），per-user／per-IP 分區。**不引入 Redis**。
- **理由與取捨**：目前是單實例部署，行程內計數即足夠、零額外基礎設施與成本。**待日後真的要水平擴充多實例時，再改用 Redis backplane**（屆時 SseHub 也需要同一套 backplane，一併處理）。

## 2026-07-06 ｜ 正式環境 DB 備份：VM → 本機每日 pg_dump（免費方案）

- **背景**：prod 資料只在單台 VM 的持久卷；原本有「VM to Local」的手動備份習慣，但未自動化、未碼化、無成功／失敗告警。要求不採需額外付費的方案。
- **考慮過的選項**：①手動（現狀）；②VM 端 cron 每日 `pg_dump` → 由本機定時拉回（免費）；③上傳 GCS bucket（需付費）；④GCE 磁碟快照排程（可能產生費用）。
- **最終決定**：**VM 端 cron 每日 `pg_dump`（gzip），本機定時拉回並保留數份**；加上成功／失敗告警避免「備份沒跑卻沒人知道」。備份腳本納入版控。
- **理由與取捨**：完全在免費額度內；資料就是產品本體，自動化＋告警是最低保險。取捨是還原需人工操作（可接受，RPO＝一天）。

## 2026-07-06 ｜ 產品定位維持「單人」，協作為未來議題

- **背景**：README 首行「支援多人使用」易被誤讀為「多人協作」，但系統實為多帳號各自隔離、無分享／邀請／協作；升級計畫早已決策拿掉 Workspace。
- **最終決定**：**維持單人定位**，文案改為「支援多人各自獨立使用（單人為主，暫無跨帳號協作／分享）」。若未來要做協作，另立決策討論模型（分享單篇 vs Workspace）。
- **理由與取捨**：聚焦單人體驗的打磨；協作是大工程，不在此階段承諾。

---

## （以下為回填的歷史關鍵決策）

## 2026-06 ｜ DB 為唯一真相（DB-as-truth），移除 Markdown 檔案同步

- **背景**：早期為「檔案即真相＋唯讀」，升級方向轉為可編輯的個人知識／任務 OS。
- **考慮過的選項**：①維持檔案為真相＋雙向同步；②DB 為唯一真相、一律網頁編輯。
- **最終決定**：**PostgreSQL 為唯一真相**，筆記／任務／畫布／節點／關聯全部存 DB，移除 MD 檔案同步子系統。
- **理由與取捨**：雙向同步的一致性與衝突處理成本過高；DB 單一真相簡化模型、支援多裝置。取捨是失去「純檔案可攜性」，以匯出 PDF／API 補足。

## 2026-06 ｜ 多租戶用「單 User 隔離」，不做 Workspace

- **背景**：曾規劃 Workspace／成員／角色的多租戶模型。
- **最終決定**：**每表帶 UserId + EF Core 全域查詢過濾**（`WHERE UserId = 現行使用者 AND ValidFlag = true`），不做 Workspace／角色。
- **理由與取捨**：單人系統下 Workspace 過度設計；直接用 User 隔離最簡單。日後要升 Workspace 再遷移。

## 2026-06 ｜ 共用預設 AI 模型（系統身分種一份，金鑰只存一份）

- **背景**：全新 clone 的 DB 無任何 AI 模型，AI 功能會靜默失敗；又不想把擁有者金鑰複製給每位使用者。
- **最終決定**：`ai-models.json` 中 `isDefault: true` 的模型以「系統身分」(`SharedModelUserId`) 植入**一份**，金鑰 Data Protection 加密；不出現在任何人的設定頁，只作為節點未選模型時的預設。
- **理由與取捨**：所有人免設定即可用 AI；金鑰不外洩、不重複。取捨是預設模型由系統統一控管。

## 2026-06 ｜ 快捷鍵覆寫存 DB（非 localStorage）

- **背景**：快捷鍵可自訂改鍵，需決定存哪。
- **最終決定**：存 DB 的 `User_ShortcutsJson`（只存與預設不同的最小 JSON），**跨裝置同步**。
- **理由與取捨**：遵循「DB 為唯一真相」方向並讓設定跨裝置一致。取捨是每次改鍵需一次 API 往返（可接受）。

## 2026-06 ｜ 一律軟刪除（ValidFlag），絕不硬刪

- **背景**：使用者可能誤刪，需可救回。
- **最終決定**：所有刪除一律 `ValidFlag = false`＋`DeletedDateTime`，統一垃圾桶可還原；**絕不執行 DELETE SQL**。
- **理由與取捨**：資料安全優先。取捨是 DB 會累積軟刪除列（以查詢過濾與日後清理作業處理）。

## 2026-07-01 ｜ 正式 VM 遷移至 asia-east1-b（彰化）e2-small

- **背景**：原 e2-micro（1GB, us-central1-a）記憶體吃緊、延遲高。
- **最終決定**：遷至 **asia-east1-b（彰化）e2-small（2GB）**，IP 34.80.67.108，冷啟動 59s→3s。
- **理由與取捨**：就近降延遲、記憶體翻倍。**注意**：deploy.yml 的 `--zone` 當時漏改（2026-07-06 審查發現並修正為 asia-east1-b），舊 us-central1-a 實例已 TERMINATED。
