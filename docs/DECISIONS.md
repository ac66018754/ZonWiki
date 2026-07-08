# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。

---

## 2026-07-08 ｜ 筆記貼圖改「磁碟附件＋短網址」，廢除 base64 內嵌

- **背景**：編輯器貼圖用 `FileReader.readAsDataURL` 把 base64 直接內嵌 Markdown（浮層圖片輪播同樣）。一張 1MB 截圖＝約 137 萬字元進內文：Note 的 `ContentRaw`＋`ContentHtml` 存兩份；`IX_Note_ContentRaw_Trgm`（GIN trigram）被高熵 base64 灌爆（trigram 幾乎全唯一，2GB e2-small 上是實際威脅）；筆記詳情 API 一次回兩份；AI 重排把 base64 整包餵 LLM 炸 token；編輯器游標/undo 卡頓。
- **考慮過的選項**：①附件存磁碟＋DB 存中繼資料（沿用畫布 NodeImage 模式）；②附件存 DB bytea（備份簡單但 2GB VM 的 Postgres 記憶體壓力＋DB 膨脹）；③GCS bucket（多一個雲深依賴、本地開發要模擬）。
- **最終決定**：採 **①磁碟＋中繼資料表 `NoteAttachment`**（使用者裁示）。
  - **後端**：`POST /api/attachments`（multipart）→ ImageSharp 3.1 處理 → 落地 `App_Data/attachments/{userId:N}/{id:N}.webp`；`GET /api/attachments/{id}` 驗登入＋使用者隔離、回檔案＋`Cache-Control: private, max-age=31536000, immutable`＋`nosniff`。內文只放相對短網址 `![圖片](/api/attachments/{id})`（跨環境通用；顯示層再補 API base）。
  - **影像處理安全（對抗式審查全採納）**：不信任 client MIME（一律 `Image.Identify` 實測）；解壓炸彈防護（header-only 探測像素數 ≤24MP 才完整解碼＋MemoryAllocator 256MB 上限）；EXIF `AutoOrient` 再縮圖（最長邊 2560）重編碼 WebP q80；GIF 原樣存（保留動畫，靠 nosniff 補償未重編碼清洗）；格式白名單 PNG/JPEG/WebP/BMP/GIF（SVG=XSS 風險、HEIC 無解碼器，拒收）；單檔 10MB＋每使用者總量 500MB 配額＋`zonwiki-upload` 限流（TokenBucket 20/補 10 每分）；先寫檔後寫 DB、DB 失敗補償刪檔。
  - **前端貼上體驗**：貼上瞬間插入**純文字**佔位「〔圖片上傳中 #token〕」（刻意不用圖片語法——預覽零客製、就算防線全漏存進去也是無害文字）→ 上傳完成在最新內容替換成短網址；上傳中「保存」與 AI 動作 disable（否則佔位文字會被永久存庫——審查抓出的 CRITICAL 競態）；替換時找不到佔位（使用者刪了）→ 視同取消、toast 告知、孤兒掃描回收。
  - **孤兒回收**：`AttachmentOrphanCleanupService` 每日一輪，建立超過 48h 且附件 Id 未出現在同使用者的 `Note.ContentRaw`／`NoteRevision.ContentRaw`（版本還原要看得到圖）／`NoteOverlayItem.DataJson`（含軟刪除列＝垃圾桶可還原）→ **只軟刪除**（ValidFlag=0，磁碟檔案保留，符合絕不硬刪鐵則）。比對用 `EF.Functions.ILike`（大小寫不敏感，防手貼大寫 GUID 誤殺）。
  - **部署/備份**：compose 的 api 掛 `zonwiki-api-appdata:/app/App_Data` 具名卷（**prod 的 docker-compose.prod.yml 需比照補掛**，見 docs/deployment）；`scripts/backup-db.sh` 擴充為 DB＋附件雙備份（`files-*.tar.gz`，各自輪替 N 份）。
- **理由與取捨（已知限制，之後別當 bug 追）**：
  - 「永久清除（PurgedDateTime）」的筆記其 ContentRaw 仍留在 DB → 其引用的附件**永遠算被引用、永不回收**（磁碟單調成長；Phase 2 可考慮永久清除時一併清空內容欄）。
  - **不**幫 `NoteRevision.ContentRaw` 建 trigram 索引：存量 base64 會讓 GIN 索引爆炸（正是本功能要解的問題）；孤兒掃描每日一輪 seq scan，單人規模可接受。
  - 本地 DB 每日被 prod 覆蓋但**附件檔案不會跟著同步** → 本地看 prod 貼的圖會 404（Phase 2 可擴充 pull-backup 連 `files-*.tar.gz` 一起拉回解開）。
  - **存量 base64 遷移為 Phase 2**（掃 ContentRaw 解出落地、替換短網址、重算 ContentHtml/Hash）；在遷移完成前**不加**「拒收 data URL」的存檔驗證，否則舊筆記無法再儲存。
  - ImageSharp 釘 **3.1.12**：4.0 起 build-time 強制 License Key（公開 repo＋CI 會直接卡編譯）；3.1 為 Split License（個人/開源免費）無此機制。
- **對抗式復審（第二輪）追加修正**：
  - 【C】QuickCreateTaskModal 標題欄 Enter 鍵繞過「上傳中禁存」→ 防線一律放進 save/handleSave **函式本體**（按鈕 disabled 只是外觀），全站五處統一。
  - 【H】配額 SUM 檢查非原子（並發可繞過 500MB）→ 交易內 `pg_advisory_xact_lock(使用者鍵)` 序列化「檢查＋寫入」，配額改以**落地後大小**計。
  - 【M】轉檔加 `SemaphoreSlim(2)` 併發閘門（TokenBucket 擋不住瞬時並發的記憶體疊加）；上傳端點收斂 `MaxRequestBodySize`（Kestrel 預設 28MB > 單檔 10MB，避免整包讀進記憶體才拒絕）。
  - 澄清：ImageSharp `AllocationLimitMegabytes` 只限「單一緩衝區」配置、非累積總量；總量靠併發閘門。
  - 任務/畫布節點共用同一編輯器也能貼圖 → 孤兒掃描引用範圍含 `TaskCard.Content`、`Node.Content`、`NodeRevision.Content`；畫布 NodeContent 渲染補 urlTransform；節點抽屜（blur 即存）上傳中略過 blur 存檔、歸零時補存。

## 2026-07-06 ｜ 重複任務用「到期具現化」＋自寫 RRULE 子集展開器（#17）

- **背景**：TaskCard 早有 `RecurrenceRule`（iCal RRULE）欄位，但完全無 UI、無產生引擎——存了規則也不會有任何重複發生產生。使用者要求做成完整可用功能（不重複／每天／每週選星期／每月選日／自訂 RRULE），且必須「不重複、不無限、可打勾、可停止重複」。
- **考慮過的選項**：
  1. **虛擬展開（不落地）**：查詢時即時算出發生、不寫入 DB。→ 發生無法各自打勾/加註/獨立狀態（單人知識/任務 OS 需要「這次做了、那次沒做」）。
  2. **到期具現化（落地成實體卡）**：背景服務把到期發生產生成獨立 TaskCard。← 採用。
  3. RRULE 解析：(a) 引入 `Ical.Net` NuGet；(b) 自寫涵蓋 UI 子集的展開器。
- **最終決定**：
  - **模型**：設有 `RecurrenceRule` 的卡片＝「母規則（範本）」，本身即序列第 0 次發生。新增兩欄 `RecurrenceSourceId`（指回母規則，純量無 FK）與 `RecurrenceOccurrenceDateTime`（該次發生時間）於具現化出的實體卡。
  - **引擎**：輕量 `RecurringTaskMaterializationService`（`BackgroundService`），啟動跑一次＋每 24 小時一次；跨使用者以 `IgnoreQueryFilters` 掃母規則（背景無 HttpContext → `CurrentUserId=Guid.Empty`，隔離攔截器放行；建立時明確帶回母規則 `UserId`）。
  - **不重複／不無限**：只展開「錨點（Planned??Due）之後、且不晚於現在」的發生——**不預先產生未來**；以（母規則, 發生時間）去重，且**把含軟刪除的既有發生一併納入去重**（使用者刪掉某次發生後不會被重新產生）；母規則錨點視為第 0 次發生永不重製；單母規則單輪上限 500、展開器內建 20000 次硬性迭代上限。
  - **可打勾／可停止**：具現化卡是獨立、`RecurrenceRule=null` 的一般任務（可打勾、可編輯，且自動出現在 /api/tasks 與 /api/calendar 既有查詢，無需改查詢）；把母規則 `RecurrenceRule` 清空（前端送空字串→後端正規化為 null）或軟刪除母規則即停止產生。
  - **RRULE 解析採選項 3(b) 自寫子集展開器**（`RecurrenceRuleExpander`，純函式、置於 Domain、16 個單元測試）：支援 FREQ=DAILY/WEEKLY/MONTHLY/YEARLY、INTERVAL、BYDAY、BYMONTHDAY、COUNT、UNTIL；不支援關鍵字安全略過、規則無效回空。
- **理由與取捨**：具現化落地讓每次發生能各自打勾/獨立狀態，貼合本產品定位。自寫展開器 vs Ical.Net：本機 build-gate 無網路保證、且前端只產生上述子集，自寫零依賴且完全可控/可測；**取捨**——不支援完整 RFC 5545（如 BYSETPOS、負數 BYMONTHDAY、多重 BYxxx 組合），日後若使用者需要更複雜規則再評估引入 Ical.Net。背景每日一次的**取捨**：剛建立的重複任務其「下一次發生」最慢隔日才出現（單人系統可接受，不需即時）。

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

## 2026-07-06 ｜ 樂觀鎖 xmin 版本投影：讀原生 uint 再於記憶體轉 long（禁止 SQL 端 CAST）

- **背景**：W4 樂觀鎖（#4/#34）以 PostgreSQL 系統欄 `xmin`(xid) 當併發權杖。列表／載入端點（`GetCanvasGraph` 節點投影、`GetNoteBySlug`）原本在 LINQ `Select` 內寫 `(long)EF.Property<uint>(n, "xmin")`。
- **問題（對抗式復審＋真實 PostgreSQL 整合測試實證）**：`(long)` 轉型會被 EF 下推成 SQL `CAST(xmin AS bigint)`，但 PostgreSQL 不允許 `xid→bigint`，執行期丟 `42846: cannot cast type xid to bigint`——**整張畫布載入與單篇筆記檢視在正式（Npgsql）環境會直接 500**。InMemory 單元測試不會下推 CAST，故先前 32 筆測試全綠卻漏掉此洞。
- **最終決定**：投影只讀「原生 xid→uint」（`EF.Property<uint>(n, "xmin")`，不加任何轉型、不下推 CAST），`ToListAsync`／`FirstOrDefaultAsync` 材質化後，再於記憶體用 `record with { Version = (long)uint }` 安全放大回填 DTO。單筆更新端點原本走 `db.Entry(e).GetConcurrencyVersion()`（記憶體讀 CurrentValue，無 SQL 轉型）不受影響。
- **理由與取捨**：xid 無合法的 `→bigint` 直接轉型；正確作法是讓資料庫原生回 uint、轉型留在 CLR。取捨是投影多包一層匿名型別（可讀性成本極小）。
- **測試**：新增 `OptimisticConcurrencyTests`（Testcontainers 真實 PostgreSQL）鎖死版本回傳＝DB 實際 xmin、過期 baseVersion→409、相符 baseVersion→成功，以及 `ConcurrencyTokenExtensionsTests`（提供者無關）鎖死 `GetConcurrencyVersion`／`ApplyBaseVersion` 契約（含 >int.MaxValue 的 uint↔long 無損往返）。
