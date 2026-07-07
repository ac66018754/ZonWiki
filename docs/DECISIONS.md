# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。

---

## 2026-07-07 ｜記帳 AI 供應者維持 Vertex（claude -p 優先實測撞 cold start，改回 Vertex）

- **背景**：使用者原鐵則「新功能一律用 GCP 服務吃額度」→ 記帳用 Vertex。後實證 **prod api container 內有可用的 claude CLI（2.1.197，`/home/User/.local/bin/claude`，`claude -p --model sonnet` 實跑回 OK）**——先前以為「prod 沒 claude」是照 `Program.cs:104-115` 過時注釋臆測（那段停用的是 DB 的 ClaudeCli **資料列**、不影響注入的 `_default` provider 實例）。claude -p 走 Max 訂閱免費、不吃 GCP 額度，使用者遂要求記帳改「claude -p 優先＋Vertex 備援」。
- **各功能選型評估（判準：claude -p 是文字 CLI，碰語音的任務做不到）**：記帳／單字庫補釋義＝純文字，claude 能做；**英文教練（即時語音）與 TTS（語音合成）claude 根本做不到，只能 Vertex Live／Gemini・Cloud TTS**。
- **實作與實測（推翻 claude 優先於記帳的可行性）**：Opus 已實作 `AiProviderFactory.ResolveExpenseChainAsync`（claude 第一棒＋Vertex try-build 備援棒，含 csharp-reviewer 對抗式復審修一個 HIGH，測試 66+279 綠）。但**本機 Playwright 實測**：claude 是 one-shot 子進程、每次記帳都 cold start，`backend.log` 實證 **12,356ms 撞滿 12 秒硬預算 → 降級 CaptureItem**；且 **Vertex 備援因與 claude 共享同一條 12 秒預算的 CancellationToken，claude 吃光後 ct 取消、Vertex 備援沒機會發請求**（Seq 零 aiplatform outbound）。對照 Vertex 直打實測 2,291ms 成功。
- **最終決定**：**記帳維持 Vertex**（即 commit `0a05b92` 原狀，快 2.3 秒、一筆 gemini-2.5-flash-lite 約 $0.0001／上百筆一個月才幾分錢，成本可忽略）。claude 優先的「真備援」方案（給 claude 較短子預算、超時換 Vertex 接手）評估後**未採用**、改動已 `git stash`（訊息 `expense-claude-priority`）暫存備查。claude -p 留給「不急且 token 量大」的功能再評估。
- **理由與取捨**：記帳的本質是「手機一句話快速記」，claude cold start（每次都發生）與「快」直接矛盾，且共享預算讓備援形同虛設；而記帳用 claude 想省的錢（$0.0001／筆）在此場景幾近於零，代價卻是 12 秒＋降級要重試。「省額度」的價值在長對話／大量 token 的功能才成立，記帳不適用。真正會固定吃 GCP 額度的是 Phase 3 的教練與 TTS（語音，claude 做不到）——那也是額度最該花的地方。

## 2026-07-07 ｜記帳核心（工作包 A・Phase 1）後端實作定案

- **背景**：實作設計書 §5 記帳核心後端——實體＋migration、VertexAdc 供應者、文字解析服務、CRUD／解析／彙總端點、MCP 工具。以下為實作期間的關鍵取捨。
- **VertexAdc 供應者＋未知類型一律拋錯**：`AiProviderFactory` 新增 `VertexAdc` 分支（重用 `OpenAiCompatibleStreamingProvider`，僅把「靜態金鑰」換成「ADC access token」——`IVertexAdcTokenProvider`/`VertexAdcTokenProvider` 以 `GoogleCredential.GetApplicationDefaultAsync().CreateScoped(cloud-platform)` 取 token，singleton 持有 credential 讓底層自動快取／刷新）。**同時把原本 `AiProviderFactory.cs:127-129` 對未知 Provider 字串的「靜默退回預設 Claude」改成拋 `InvalidOperationException`**（設計 §1.2 明訂：DB 設定打錯字不得整批靜默走 Claude、既不吃 credits 也無人察覺）。合法的 ClaudeCli／OpenAiCompatible 行為不變（回歸測試鎖死）。新增 NuGet：`Google.Apis.Auth` 1.75.0。
- **記帳解析主路不加 response_format（§12.6 未決項的取捨）**：設計 §12.6「主路是否小改 provider 加 response_format 拿硬 schema」在設計書中**無「(推薦)」標記**，屬未決；「§12 全採推薦」對它沒有可套用的推薦。本實作選擇**不改動 provider（維持零改動）、改以「prompt 約定＋圍欄剝除（StripFence）＋保底解析」取得 JSON**，與 §5.3「零改動 provider 拿不到 response_format」及工作包「provider 本體零改動」一致。日後若要硬 schema，再走「provider 加 response_format」或「原生 generateContent＋responseSchema」。
- **跨組件契約：Phase 0 種子的 `AiModel.Key` 必須等於設定鍵 `Expense:VertexModelKey`（預設 `vertex-gemini-lite`）**。`ExpenseParsingService` 以此設定鍵向 `AiProviderFactory.ResolveAsync` 要 VertexAdc 模型；若種子的 Key 與此不一致，`ResolveAsync` 會**靜默退回既有共用鏈（Claude／banana）**（此屬「找不到指定模型鍵→退共用預設」的既有行為，非未知 Provider 類型，故不會被新加的 throw 攔到）。**已知限制**：本地／CI 無 VertexAdc 列時，記帳解析走既有共用退路（非 Vertex），真實 Vertex 路徑屬 Phase 0＋Seq 手動驗收（§1.2「從 Seq 確認請求打到 aiplatform.googleapis.com」）。
- **金額 decimal(18,2)、時間 UTC、月界 UTC**：金額以 `decimal` + `HasPrecision(18,2)`（Npgsql→numeric(18,2)）避免浮點誤差；`OccurredDateTime` 一律存 UTC（相對時間由 LLM 依裝置時區換算後輸出 UTC）；`GET /api/expenses/stats` 的月彙總 Phase 1 **以 UTC 月界 [firstDayUtc, nextMonthUtc) 計算**並在回應標明 `month`，跨時區精算（使用者時區月界）列後續。
- **保底 CaptureItem 一律用未取消的權杖寫入（審查 HIGH）**：解析端點以 linked CTS（request ct ＋ 硬時間預算）施加取消；逾時／解析失敗／壞 JSON 的保底 CaptureItem 建立與存檔，一律用 **`CancellationToken.None`**（絕不重用已逾時的 linked token），否則 `SaveChanges` 會立即被取消、CaptureItem 永遠寫不進去——直接推翻設計 §5.3「一句話永不丟失」。整合測試 `PostParse_逾時_降級為CaptureItem且確實落庫` 斷言「逾時後 CaptureItem 確實從 DB 查得到」。
- **所有「AI 失敗」皆走保底、不回 500（對抗式復審補強）**：端點對解析過程的 catch 一律涵蓋**任何例外**——逾時（OperationCanceledException）、供應者硬錯誤（ExpenseParseException），以及**解析供應者建構失敗（ADC 不可用／未知 Provider／不安全 BaseUrl 拋的 InvalidOperationException）**——全部降級建 CaptureItem。原本只攔前兩者，ADC 不可用會漏成 500，違反設計 §1.6「ADC 不可用時...讓解析走保底路」；逾時記 Information、其餘記 Warning（Seq 可追）。整合測試 `PostParse_供應者拋例外_降級為CaptureItem` 鎖死此行為。
- **冪等在並發下攔 23505 改回既有（審查 MEDIUM）**：`/api/ai/expenses` 的 clientRequestId 冪等除了「先查既有」外，`INSERT` 時另攔 `(UserId, ClientRequestId)` 過濾式唯一索引違反（`DbUpdateException` 內層 `DbException.SqlState == "23505"`），攔到改查既有列回其 DTO（200），使並發重送不回 500。整合測試含「同 clientRequestId 並發送出仍只建一筆」。
- **解析硬預算預設 12 秒、clamp 下限放寬到 0.2 秒（測試用）**：設定鍵 `Expense:ParseBudgetSeconds` 預設 12（落在設計 §5.3 的 10–15 秒 band 內）。clamp 上限 15、**下限刻意放寬到 0.2 秒**——純為讓「逾時降級」路徑能寫成快速的確定性整合測試（TDD 要求逾時後 CaptureItem 必落庫）；**生產設定應維持 10–15**。
- **組合限流：GlobalLimiter＋端點 marker＋CreateChained（TokenBucket＋SlidingWindow）**：`RequireRateLimiting` 疊掛只取最後一筆、單一具名 policy 無法同時跑兩種 limiter。故 `/api/ai/expenses` 改用 `options.GlobalLimiter = PartitionedRateLimiter.CreateChained(tokenBucket, slidingWindow)`＋端點 `.WithMetadata(new PatAiRateLimitMarker())`：只對帶 marker 的端點生效（TokenBucket 15 容量／8 每分鐘＋SlidingWindow 30／分），其餘端點回 `GetNoLimiter`（永不拒絕）故既有端點零影響；逾限共用既有 `OnRejected`（統一 429 JSON）。另 `POST /api/captures` 補掛既有 `PatPolicy`（原本完全沒掛限流）。
- **並發首建分類撞唯一索引具韌性（審查 LOW）**：`ExpenseCategoryService` 的種子／名稱式 find-or-create 除了復活軟刪列外，`INSERT` 撞 `(UserId, Name)` 唯一索引時也攔 23505 改查既有列使用，確保並發首建不回 500。
- **測試策略（審查 MEDIUM：整合基座 Fake 回中文散文）**：整合基座 `Ai__Provider=Fake` 的預設 Fake 回中文散文（非 JSON）。成功入庫路徑改以 `WithWebHostBuilder`＋`ConfigureTestServices` 在 Testing 覆寫 `IAiProvider` 為「回定值 JSON 的 Fake」（**不改動基座對其它測試的預設 Fake 行為**）；降級／逾時路徑則用不依賴特定 JSON 的預設 Fake。
- **對抗式復審後補修（同日）**：①CRITICAL——VertexAdc 供應者三道防線：只允許系統共用身分（SharedModelUserId）名下的列取 ADC token、BaseUrl 只放行 `aiplatform.googleapis.com`／`<region>-aiplatform.googleapis.com`＋https、`SaveModelsConfig` 伺服器端白名單拒收 VertexAdc（堵死「任何登入者自建假模型列把伺服器 GCP token 外流」的攻擊鏈）；②`/api/expenses/parse` 加掛 PatAiRateLimitMarker（堵 PAT 換路繞過組合限流）；③解析文字上限 1000 字＋CRUD 輸入驗證（應用層，無 schema 變更）；④分類 ensure-defaults 批次化（修 N+1；過程實測抓到並發死結 40P01，加攔 40P01/40001 走逐筆 fallback）；⑤清單缺省 limit 預設 50（前端 useExpenses 同步補傳 pageSize）；⑥ParseAndStoreAsync 例外攔截縮小到只包 AI 呼叫，儲存層非預期例外 log Error 後外拋。
- **前端 PWA manifest 色票寫死之例外（鐵則 #11「禁止硬編碼色票」的記錄在案例外）**：`app/manifest.ts` 的 `background_color`/`theme_color` 直接寫 warmpaper token 實值（`#faf9f7`／`#2d5016`）——manifest 是靜態 JSON、拿不到 CSS 變數，且 OS 只在安裝/啟動畫面用到；值已與 `globals.css` 的 warmpaper token 核對一致，換主題色時需同步這兩處。
- **noteNav「重訪截斷」修正（Playwright 活體實測抓到）**：原堆疊語意「重訪即截斷」會讓「從分類頁點進曾造訪過的筆記」按返回錯回舊位置（丟失分類脈絡）。改為：返回鈕導頁前 `markBackNavigation(target)` 一次性標記——`recordNoteNav` 遇已存在 URL 時，有標記＝back 移動→截斷（原語意），無標記＝前進→move-to-top（保留新脈絡）。瀏覽器硬體返回鍵無標記會走 move-to-top，屬已知取捨。

---

## 2026-07-06 ｜「其他」功能群定案：GCP 純血選型＋分期實作（設計書 v3.1）

- **背景**：新增「其他」頁功能群——單字庫／英文教練（Midoo 式即時語音對話）／記帳（語音一句話入帳）／筆記 TTS・Podcast 模式／筆記返回鈕重定義／iPhone 快速啟動。使用者裁示鐵則級約束：**新功能所有雲端服務一律用 GCP（讓花費吃既有 credits）、拒絕對其他家付費，接受體驗較差、開發較久的代價**。
- **考慮過的選項**：AI 供應端 Gemini Developer API（AI Studio key）vs Vertex AI；教練通道「瀏覽器直連＋ephemeral token」vs「.NET 後端 WebSocket 代理」vs「STT→LLM→TTS 管線」；TTS 走 Gemini-TTS vs Chirp 3 HD vs Web Speech；記帳音檔轉錄 Groq Whisper vs Cloud STT vs Vertex 直接吃音訊。
- **最終決定**：**全面走 Vertex AI**——Gemini Developer API 自 2026-03 起官方明文吃不到 GCP credits，Vertex 是唯一能吃額度的路。教練＝Vertex Live API（gemini-live-2.5-flash-native-audio，GA，退役日 2026-12-13）＋**.NET 後端 WS 代理**（Vertex 無 ephemeral token，瀏覽器直連被堵死）＋接受美區 +120–160ms 延遲；文字解析＝AiProviderFactory 新增 **VertexAdc** 供應者（OpenAI 相容端點＋ADC token）；記帳音檔路＝Vertex generateContent 直吃音訊（棄 Groq）；TTS＝Gemini-TTS via Cloud TTS API（cmn-TW 為 Preview 需 PoC）＋英文內容走 Chirp 3 HD 月 1M 字元免費層。設計書 §12 其餘推薦全數採納：`/others` 路由、CoachSession/CoachMessage 新表、SRS 用 SM-2 起步（DB 欄位照 FSRS）、音檔 Opus 格式、iPhone 實體鍵分工（Action Button=記帳／鎖屏鈕=隨手記／主畫面圖示=教練）、返回鈕乙案（堆疊優先＋階層 fallback 修正版）、不裝核彈級計費斷路器（改應用層三上限＋include-credits budget 告警）、教練每日 60 分鐘上限、記帳音檔直傳路暫不做。分期：Phase 0（GCP 前置）→ 1（骨架＋記帳＋PWA＋捷徑＋返回鈕）→ 2（單字庫＋TTS＋分析頁）→ 3（教練＋Podcast）。
- **理由與取捨**：完整比較、成本估算（教練 30 分/天約 $17–36/月，吃 credits）、風險與兩輪對抗式評審採納紀錄，見 [docs/design/其他功能群設計書.md](./design/其他功能群設計書.md)（v3.1）。主要取捨：延遲與開發工時，換「花費 100% 吃 GCP 額度」；暫時鎖在 Gemini 2.5 世代（3.1 Live 不在 Vertex）；2026-12-13 模型退役前需換後繼模型（模型代號已設定值化）。

## 2026-07-06 ｜ 本機 DB 每日兩次「用 prod 覆蓋」（本機＝prod 可拋棄副本）

- **背景**：使用者要「本機開發環境直接用 prod 的真實資料」，每日兩次自動把 prod 內容**覆蓋**掉本機 dev DB（`zonwiki`＠5533）。（初版曾做成「另存獨立鏡像 DB、不碰 dev DB」，經使用者澄清後改為「直接覆蓋 dev DB」。）
- **最終決定**：`scripts/local/pull-backup.ps1` 拉回 prod 備份後，`DROP DATABASE zonwiki WITH (FORCE)` + `CREATE` + 灌入，用 prod **整個覆蓋本機 `zonwiki`**。加雙保險旗標 `$OverwriteLocalDb`（要明確 opt-in 才會執行此破壞性覆蓋）。
- **schema 落差處理（重要）**：prod 跑的 code 比本機分支舊（少了 xmin／重複規則／搜尋索引等 migration）。覆蓋後本機 DB＝prod 舊 schema；**本機後端下次啟動時 EF `MigrateAsync` 會自動把它補到分支新 schema、prod 資料保留**（實測：覆蓋後 188 notes、後端啟動套用 4 個分支 migration、TaskCard 補上 Recurrence 欄位、資料無損）。因此**每次同步後需重啟本機後端**（腳本會 log 提醒）；若後端在同步當下正運行，`DROP … FORCE` 會斷其連線、需重啟才恢復。
- **理由與取捨**：使用者明確要「本機用 prod 資料」；本機 dev DB 視為可拋棄副本（prod 為權威來源、只讀）。取捨：本機該 DB 原有的 dev/測試資料每 12 小時被清掉（使用者接受）；此覆蓋屬「刻意用權威來源重建可拋棄的本機副本」，非誤刪正式資料，符合資料安全鐵則的意圖。同步後本機登入帳號＝prod 帳號（本機原 dev 帳號會一起被覆蓋掉）。
- **實作坑（記給後人）**：① `pull-backup.ps1` 的 gcloud 必須帶 `a0987461866@zonwiki`（不指定 user 會連到空家目錄、抓不到備份）。② PowerShell 5.1 會把傳給原生指令的 `"識別碼"` 雙引號吃掉→psql 收到未加引號 `Note`→摺成 `note`→報「relation 不存在」；SQL 驗證查詢改用純單引號（`information_schema`）或 stdin 管線避開。
- **備註**：此則原由另一 session 寫入但未提交，期間曾被外部寫入者（疑似編輯器舊緩衝存檔）從工作區抹除；2026-07-06 由本 session 依當時實讀內容原文還原並提交保全。

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
