# 「其他」功能群 Phase 2／3 執行準則（給 Opus 4.8 的作戰手冊）

> 撰寫者：Fable 5（Phase 1 監工）｜日期：2026-07-07｜對象：日後執行 Phase 2／3 研究・實作・驗收的 Opus 4.8
> 目的：把 Phase 1 驗證過有效的方法論、這個專案的特定鐵則、以及 Phase 2／3 的重點風險與驗收標準，寫成一份能自主遵循的手冊。
> **這不是設計書**——設計「做什麼」看 [其他功能群設計書.md](./其他功能群設計書.md)（v3.1）；這份講「怎麼做、怎麼驗、有哪些坑」。

---

## 0. 開工前必讀（依序）

1. [docs/design/其他功能群設計書.md](./其他功能群設計書.md)（v3.1，GCP 純血版）——你要實作的完整規格。Phase 2＝§3（單字庫）＋§6（TTS/Podcast）＋§5.5-5.6（記帳分析頁）；Phase 3＝§4（英文教練）＋§6.6（Podcast 進階）。§9 資料表總表、§10 GCP 計費、§11 主題對比、§12 裁決事項（**全部採推薦選項**，已定案）。
2. [docs/DECISIONS.md](../DECISIONS.md) 最上方數則（2026-07-06/07）——已定案的架構決策，尤其「記帳維持 Vertex（claude cold start 撞預算）」「GCP 純血選型」「本機 DB 用 prod 覆蓋」。
3. 本檔全部。
4. 專案根 [README.md](../../README.md)（技術棧、啟動方式）＋根 CLAUDE.md（若有）＋ `~/.claude/rules/` 全域鐵則。

**現況交接（2026-07-07）**：Phase 1 已完成並 push（分支 `feature/others-phase1`，HEAD `4674ed9`；設計書在 `docs/others-feature-design`）。`git stash@{0}` 有一版「記帳 claude 優先＋Vertex 備援」的改動（實測 cold start 撞預算，已棄用改回 Vertex，暫存備查——Phase 3 若要做「真備援子預算」可參考，但別直接 pop 到主線）。

---

## 1. 通用工作方法（每個 Phase 都適用，Phase 1 實證有效）

### 1.1 研究先行——設計書給方向，你要實證「未確認」項
設計書已把大方向定了，但裡面標「**未確認**」的事實**絕不可照抄盲做**。Phase 1 就是先開多代理平行研究＋對抗評審才動手（省下踩雷）。做法：

- **開 Workflow 平行研究**（fan-out sub-agents），每路一個明確主題、要求「事實附來源 URL／碼庫附檔案:行號、查不到明標未確認、嚴禁捏造」，用 schema 收結構化結果。
- 研究完**開對抗式評審**（獨立 sub-agent，立場是「設法推翻這份研究/計畫」），Phase 1 靠這個在設計階段就抓出破綻。
- **魔術值/API 能力回原始定義核對**，不沿用先前 sub-agent 報告或記憶裡的假設值（鐵則 #26）。

### 1.2 實作——TDD＋對抗式復審（不是可選，是必須）
1. **TDD**：先寫測試計畫 → **獨立 sub-agent 審查計畫** → 寫測試（RED）→ 實作（GREEN）→ 重構（鐵則 #15）。
2. **對抗式 Code Review（關鍵）**：實作完**開獨立 sub-agent 以「設法推翻」立場復審**，不可只自我審查（鐵則 #14）。Phase 1 就是靠這個抓到一個 **CRITICAL**（VertexAdc 讓任何登入者外流伺服器 ADC token）——若沒做對抗復審，這洞會直接進 prod。至少跑 csharp-reviewer（後端）＋ code-reviewer（前端）＋ security-reviewer（碰認證/外部 API/DB 的一定要）。
3. **範圍紀律**：只改工作包點名的檔案；順手看到的其他問題**寫進報告、不動手**（鐵則 #5）。動了未點名的既有東西＝扣分。

### 1.3 實測推翻假設——「宣稱做好前必須這回合實測」（鐵則 #1，最高頻失誤）
- `tsc`／`dotnet build`／lint 過**不算**驗證，只證明能編譯、不證明行為對。
- 算數的：測試 PASS、Playwright 進畫面截圖看到正確、實打一次 API 看到回應、Seq 看到真的走對路徑。
- Phase 1 血淚：claude cold start 撞記帳 12 秒預算是**實測 backend.log 才發現**的（12356ms 超時降級），編譯測試全綠也看不出來。**別信「邏輯上對」，要跑給自己看**。
- 遇連續 2 次被否決／實測不通＝方向錯了，回報使用者換路，不要硬修第三次（鐵則 #7）。

### 1.4 每個決策當下寫進 DECISIONS.md（鐵則 #16）
重大選型／取捨「當下就寫」`docs/DECISIONS.md`（新在上，格式：日期／背景／考慮過的選項／最終決定／理由與取捨）。Phase 1 每個決策都有記。

---

## 2. 專案特定鐵則（Phase 1 踩過的坑，違反視同 bug）

### 2.1 本機環境
- **本機 DB 每日兩次被 prod 覆蓋**（見 DECISIONS「本機 DB 用 prod 覆蓋」）：你種進本機 DB 的任何列（如 VertexAdc 模型列）、本機註冊的帳號，**活不過 12 小時**。覆蓋後本機後端啟動會自動跑 migration 補回分支 schema。**教訓：本機驗證用的種子資料是一次性的；測試帳號一律用 prod 註冊的**。
- **測試帳號**：`zonwiki_qa_1` / `zonwiki_qa_0`，密碼 `ZwQa#2026test`（prod 註冊、靠每日覆蓋同步到本機）。**不要動使用者主帳號**（除非 Playwright 驗證 prod，見 memory prod-login-credentials）。
- **Node 版本**：本機預設 Node 是 v18，**Next 16 跑不動**。前端指令一律先 `export PATH="/c/Users/User/AppData/Roaming/nvm/v20.12.2:$PATH"`（Bash）。
- **後端啟動**：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-backend-hidden.ps1`（背景常駐）；停用 `netstat -ano | grep :5009` 找 PID → `taskkill /T /F /PID`（`/T` 連程序樹才會釋放埠）。改完 code 要**停後端→重啟**才載入新編譯（跑中的後端會鎖住 Debug DLL）。
- **埠**：前端 3000、後端 5009、Postgres 5533。撞埠自行 +100。
- **Playwright 用完自行關閉**（鐵則 #20）；截圖收進 `tmp/playwright/<主題>/`（鐵則 #10）。

### 2.2 AI 供應者（Phase 1 定案，別重蹈覆轍）
- **記帳＝Vertex，別再試 claude**：claude one-shot 每次 cold start 撞預算降級（見 DECISIONS 2026-07-07）。文字任務（單字庫補釋義）理論可 claude，但**同有 cold start 顧慮**，Phase 2 要用前先實測延遲。
- **Vertex 走 ADC**（Application Default Credentials）：本機需先 `gcloud auth application-default login`（一次互動，agent 環境開不了瀏覽器→請使用者跑）。ADC 沒設時 `VertexAdcTokenProvider` 拋錯→記帳走保底 CaptureItem（優雅降級）。
- **VertexAdc 安全鐵則（對抗復審抓到的 CRITICAL，絕不可退）**：`AiProviderFactory` 的 VertexAdc 分支**只允許 `SharedModelUserId`（…00a1）名下的列**取 ADC token；`IsVertexBaseUrlAllowed` 只放行 `aiplatform.googleapis.com`／`<region>-aiplatform.googleapis.com`＋https；`SaveModelsConfig` 白名單拒收使用者建 VertexAdc。任何新程式碼碰到「用系統 ADC token 打外部 URL」都要維持這三道，否則就是讓任何登入者外流伺服器雲端憑證。
- **未知 Provider 類型一律拋錯，不得靜默 fallback 回 Claude**（否則 DB 打錯字整批靜默不吃額度也無人察覺）。
- **prod 有 claude CLI**（2.1.197，`/home/User/.local/bin/claude`）；`Program.cs` 那段「prod 停用 ClaudeCli」停的是 **DB 資料列**、不影響注入的 `_default` provider 實例。

### 2.3 資料庫（每張新表都要照做）
- **命名鐵則**：表 PascalCase 無底線；欄位 `{Table}_{Field}`（恰一個底線）。繼承 `AuditableEntity`＋實作 `IUserOwned` 就自動獲得 6 稽核欄＋全域查詢過濾＋fail-closed 具現化攔截器＋欄名自動 `{Table}_{Property}`（不必手寫欄名）。
- **一律軟刪除**（ValidFlag=0），絕不跑 DELETE SQL（有 delete-guard hook 會攔）。
- **唯一索引不含 ValidFlag**（碼庫慣例；含了會讓「同鍵 1 活+1 死並存、第二次軟刪違反唯一約束」）；重複入庫走「復活軟刪列」upsert。
- **白名單三處登記，逐表判斷**（不是每表都登記）：`TrashTypeRegistry.TypeMap`（進垃圾桶）、`ActivityLogInterceptor.MapEntity`（進活動流）、`AskQueueService validKinds`（有 AI 背景工作才登記）。Phase 1 教訓：Expense/ExpenseCategory/VocabularyWord/CoachSession 進 Trash+ActivityLog；**CoachMessage（每 10 句一批會灌爆活動流）與 TtsAudio（快取品，進垃圾桶語意錯誤）兩處皆不登記**。
- **背景工作先 `bgDb.SetCurrentUserId(userId)` 再查詢**（否則全域過濾以 Guid.Empty 濾掉一切）。
- **時間存 UTC**，前端依裝置時區顯示。
- **跨 Phase 的 FK**：Phase 2 的 `VocabularyWord.SourceCoachSessionId` FK→CoachSession（Phase 3 才建表）**延到 Phase 3 migration 再加**（nullable 欄後補零成本）。

### 2.4 限流（ASP.NET Core 陷阱）
- `RequireRateLimiting` **疊掛只取最後一筆**（middleware 只讀最後一個 metadata）。「PAT 對外＋會打 LLM」的端點要組合限流，用 `PartitionedRateLimiter.CreateChained`＋端點 marker（Phase 1 記帳已建 `PatAiRateLimitMarker` 範本，照抄）。

### 2.5 編碼（跨界一律 UTF-8，鐵則 #17）
- 所有跨行程/檔案/網路/終端的文字 I/O 明示 UTF-8。含中文的 .ps1 存 UTF-8 with BOM（有 ps1-bom-fix hook 但其他管道要自顧）。
- **踩過的坑**：中文放進 bash/PowerShell 傳給 gcloud/curl/psql 會 CP950 亂碼——JSON/SQL 帶中文時寫進**檔案**（UTF-8）再 `--data-binary @file`／`psql -f`／`docker exec -i psql < file`，別在指令列直接嵌中文。

### 2.6 除錯先查 Seq（鐵則 #27）
本機 Seq：<http://localhost:5341>（`Application='ZonWiki.Api'`）。後端 HttpClient 的 outbound URL 會進 Seq（Phase 1 就是靠它看到 `HTTP POST https://aiplatform.googleapis.com/...` 確認真的走 Vertex）。API 查詢：`GET http://localhost:5341/api/events?count=N`（RenderedMessage 有時為空，抓 raw JSON 找關鍵字）。`tmp/backend.log` 是 UTF-16，用 python `open(...,'rb').read().decode('utf-16')` 讀。

---

## 3. Phase 2 執行指南：單字庫＋TTS v1＋記帳分析頁

### 3.1 範圍與前置
- 交付：①單字庫（SM-2 複習＋清單/複習 UI）②TTS 子系統 v1（Gemini-TTS cmn-TW 筆記朗讀＋聲音選擇 UI）③記帳分析頁（Recharts）④**cmn-TW Gemini-TTS 品質 PoC**（Preview 語言，先實聽再定案）。
- 前置：本機要能走 Vertex/TTS（ADC 已設）；Cloud TTS 的 IAM/scope 已就緒（Phase 0 補過 cloud-platform；voices:list 實打過，cmn-TW 有 6 個 classic 聲音，但 **Gemini-TTS 的 30 聲走另一端點，Phase 2 要實測**）。

### 3.2 建議研究（開工前開 Workflow 平行實證這些「未確認」）
1. **cmn-TW Gemini-TTS 品質 PoC（最優先）**：拿一篇真實中文夾英文術語的筆記，用 `gemini-2.5-flash-tts` cmn-TW（Preview）實際合成音檔、實聽——台灣腔道地度、繁體破音字、中英夾雜。不過關的退路：Wavenet cmn-TW（腔對音舊）或 Chirp3 cmn-CN（音好北京腔）。設計書 §6.1 有備援階梯。
2. **Gemini-TTS 端點與計費單位**：走 Cloud TTS API 還是 Vertex？token 計價還是字元計價（設計書標「半確認」）——開通後看第一張帳單 SKU 核對。
3. **Recharts × React 19 相容性**：`npm view recharts@latest peerDependencies` 實查（設計書 §5.6：實測到含 React^19 的是 v2.15.x，v3 證據不足）；不合改 v2.15.x 或手刻 SVG。
4. **SM-2 vs FSRS**：設計書 §3.1 定案 SM-2 起步（DB 欄位照 FSRS 設計，未來換不動表）。SM-2 數十行可實作，別過早上 FSRS。

### 3.3 實作重點（照設計書 §3/§6，但注意）
- **單字庫**：`VocabularyWord` 表（§3.2，唯一索引 `(UserId, Word)` 不含 ValidFlag、Word 入庫前 trim+小寫正規化、SourceCoachSessionId FK 延後）；SRS 排程一律**後端計算**；發音**預設永久 Web Speech**（前景短句免費可靠），只有實測 iPhone 品質不可接受才納入後端 TTS 快取。
- **TTS 播放狀態機（§6.3，Phase 1 評審定的，別做壞）**：首播分段合成→段檔子端點供檔＋前端單一 `<audio>` 佇列換源；**全段完成後 ffmpeg concat 成單檔**、算 ChaptersJson、之後走單檔＋HTTP Range（總時長/拖曳/±15秒/鎖屏 seek 才會正確）。**語速＝`playbackRate`（不重合成）**，別把播放語速綁進合成快取鍵。
- **TTS 供檔端點務必自行核對 UserId 授權**（App_Data 不可靜態公開；NodeImage 的「磁碟+供檔」慣例沒有可運行參考實作，要從零寫授權供檔）。
- **快取清理 v1 只做「同 NoteId+聲音重合成即失效舊列」**（一行 replace），別預建 LRU/每日排程（TTS 成本天花板 <$5/月，靠既有磁碟 80% 告警當保險）。
- **記帳分析頁**：Phase 1 刻意沒做（上線時零資料）；Phase 2 才做，屆時有真實資料可驗收圖表。stat tile／月趨勢／分類環圈下鑽／日曆熱圖（Tailwind grid 手刻）／商家 Top N。
- **口語稿 Markdown→朗讀規則**（§6.4）：表格報欄位再敘述、程式碼唸用途不唸碼、圖片唸 alt、標題播報+停頓＝章節切點。用便宜文字模型（**注意：記帳教訓，若用 claude 有 cold start；Vertex flash-lite 較穩**）產口語稿。

### 3.4 Phase 2 驗收標準
- `dotnet test ZonWiki.slnx` 全綠（真 Postgres 整合測試實跑；並發路徑連跑兩次穩定）；前端 tsc/eslint/`pnpm run build` 全綠。
- **Playwright 活體**（Node 20、prod 測試帳號）：①單字庫新增單字→複習卡四鍵評分→下次到期排程正確（查 DB 確認 Due 有變）②一篇筆記選聲音朗讀→有音檔播放（首播分段、完成單檔）→重播零成本（DB 看 TtsAudio 快取命中，不再打 Vertex/TTS——Seq 確認）③記帳分析頁圖表渲染。
- **四主題×WCAG AA**（§11，硬規則）：所有新 UI 只用既有 CSS 變數 token、禁硬編色票；圖表/熱圖主題感知色票；關鍵前景/背景組合跑 `node ~/.claude/tools/contrast-check.cjs`；Playwright 四主題（warmpaper/light/dark/night）各截一張＋375px 手機寬，console 零錯。
- **cmn-TW PoC 結論寫進 DECISIONS**（實聽比對後定的預設聲音）。
- **對抗式復審 CRITICAL/HIGH 清零**（TTS 供檔授權、單字庫多租戶隔離是重點攻擊面）。

---

## 4. Phase 3 執行指南：英文教練＋Podcast

> Phase 3 是技術風險最高的一塊（實機驗證項最多、全新 WebSocket 基建、Preview→GA 但有退役日）。設計書 §4 全節是規格，這裡補「執行順序與陷阱」。

### 4.1 前置實測（開工第一週，未過別往下做）
1. **Cloudflare Tunnel × WebSocket（第一件事）**：教練是後端 WS 代理連 Vertex Live，前端經 `/ws/coach` 走 Cloudflare Tunnel。**Tunnel 對 WebSocket 的支援與逾時未確認**——先用一個最小 WS echo 端點經 Tunnel 實測能不能長連。不行的備援：另開 Tunnel hostname 或 Tailscale（設計書 §4.1/§12.13）。
2. **Vertex Live ephemeral token 不存在於 Vertex**（只有 Developer API 有）→ 瀏覽器直連被堵死，**後端 .NET WebSocket 代理是唯一路**（設計書 §4.1 定案）。`Google.Cloud.AIPlatform.V1` 沒有 Live client，用 raw `ClientWebSocket` 照官方 JSON 協定實作，ADC token 當 Bearer。
3. **e2-small 跑 WS 代理的記憶體**：單人 1-2 併發、純轉發 PCM，預估可承受但要實測（含孤兒連線回收，§4.2）。
4. **非同步 Function Calling 的 scheduling 欄位**在 GA 模型 `gemini-live-2.5-flash-native-audio` 的實際行為（舊 preview 曾拒收）——實測，不行退循序 FC。
5. **iPhone 16 Pro 實機清單**（模擬器測不出，§12.17）：Wake Lock、standalone 麥克風權限、MediaSession 鎖屏、background 音訊 WebKit #198277。

### 4.2 實作重點（照設計書 §4）
- **連線生命週期狀態機（§4.2，必補）**：單一 WS 約 10 分鐘壽命（GoAway 提前 60 秒）、音訊 session 15 分鐘上限——**一堂課必然跨越，重連是常態不是異常**。開 `context_window_compression`；GoAway→帶 resumption handle 重連（**斷線後約 10 分鐘內、快取最長 24h**，兩個窗都要處理）；跨日續聊靠 SummaryText+逐字稿注入。**孤兒連線回收**：heartbeat 偵測前端死亡→寬限 60-120 秒→主動關 Vertex WS。
- **糾錯卡（Midoo 核心體驗，§4.4）**：Live API 只回逐字稿，結構化糾錯要靠**第二個 NON_BLOCKING Function Call `show_correction(original, corrected, explanation_zh, better_version)`**，system prompt 明示「每次三明治回饋時同步呼叫」；後端代理收 toolCall→寫 CoachMessage_CorrectionJson→推事件給前端。呈現用同氣泡逐字 diff（**顏色＋刪除線/圖示雙載體**，紅綠在 dark/night 過不了 WCAG）。
- **通道護欄（§4.8，計費防護）**：`/ws/coach` 是唯一按分鐘燒錢的功能，budget 只告警不斷路——必須有應用層三上限：Origin 白名單、每使用者最多 1 併發 session、每日上課分鐘數硬上限（設計 60 分/日）。前端重連指數退避＋上限次數（防重連迴圈整夜燒 credits）。
- **模型退役日 2026-12-13**：`gemini-live-2.5-flash-native-audio` 是 GA 但一年內要換後繼模型，模型代號一律設定值化。
- **前端音訊層**搬官方 `google-gemini/live-api-web-console`（Apache-2.0）的 AudioWorklet 模組（PCM16 16kHz入/24kHz出），移植進 Next.js client component。
- **教練頁滿版**：`/others/coach` 回傳 sidebar--hidden 變體（保 MobileSectionNav）＋data-route 滿版，路由用 path（hash 會反覆重跳麥克風權限）。首次開啟需登入一次（standalone cookie 隔離，returnUrl 回 /others/coach）。

### 4.3 prod 部署前置（部署時做，屬使用者職責範疇但你要備好）
- **prod DB 種系統共用 VertexAdc 列**（本機那筆每日被覆蓋洗掉，prod 要另種）：`UserId=SharedModelUserId(…00a1)`、`Key=vertex-gemini-lite`、`Provider=VertexAdc`、`ModelId=google/gemini-2.5-flash-lite`、`BaseUrl=https://aiplatform.googleapis.com/v1/projects/zonwiki-prod/locations/global/endpoints/openapi`、`ApiKeyEncrypted=null`。經 IAP tunnel 連 prod DB（memory prod-db-access-iap-tunnel）或部署腳本。
- **VM scope 已是 cloud-platform**（Phase 0 補過）；Live 模型**只在美/歐區、亞洲無**——彰化 VM 連 us-west1 約 +120-160ms，已接受。
- prod 部署與驗證**一律由使用者做**（鐵則 #25），你只做本機驗證與交付。

### 4.4 Phase 3 驗收標準
- 後端測試全綠；WS 代理有單元/整合測試（連線生命週期、toolCall 處理、逐字稿落地、孤兒回收）。
- **本機活體**：教練頁開課→講話→雙向即時字幕→糾錯卡逐字 diff→「加入單字本」FC 真的入庫（DB 確認）→續舊對話載入歷史逐字稿→Seq 確認走 Vertex Live。iPhone 實機清單逐項驗（使用者協助）。
- 四主題×WCAG（字幕氣泡、糾錯 diff 紅綠在 dark/night 的對比、迷你播放器）。
- 通道護欄實測（每日分鐘上限觸發即拒開、重連退避）。
- **對抗式復審**（WS 代理的認證/租戶邊界、ADC token 不外流、每分鐘計費的 DoS 面是重點）。

---

## 5. 通用驗收清單（每個 Phase 交付前逐條打勾）

- [ ] `dotnet test ZonWiki.slnx` 全綠（真 Postgres via Testcontainers；並發路徑連跑兩次穩定）。
- [ ] 前端 `pnpm exec tsc --noEmit`、對改動檔 eslint、`pnpm run build`（Next 16 生產建置）全綠（Node 20）。
- [ ] **Playwright 活體驗收**（不是只看 code）：關鍵流程實跑、進畫面截圖看到正確、console 零錯誤。
- [ ] **四主題 × WCAG AA**：新 UI 只用 CSS 變數 token、contrast-check 實測、四主題＋375px 截圖收進 tmp/playwright/。
- [ ] **Seq 確認真的走對路徑**（打對 API、沒誤 fallback）。
- [ ] **對抗式復審**（獨立 sub-agent 設法推翻）**CRITICAL/HIGH 清零**；MEDIUM 記錄或修。
- [ ] DB 新表：命名鐵則、6 稽核欄、軟刪除、多租戶隔離、白名單逐表登記、唯一索引不含 ValidFlag、背景工作 SetCurrentUserId。
- [ ] 重大決策寫進 DECISIONS.md；跨 session 的坑寫進 memory。
- [ ] 類別成員/介面/Enum 繁中多行 summary、複雜邏輯繁中註解、參數>3 換行。
- [ ] Playwright 用完關閉；本機後端記憶體異常膨脹（>2GB）就重啟；截圖/腳本收整。
- [ ] **份內事一路做完**（能查能改能跑的現在做完）；只在破壞性動作、prod 部署、或真的需要使用者裁決時才停下問。

---

## 6. 給 Opus 的一句話心法

設計書告訴你「做什麼」，但**別把設計書當聖經照抄**——它有很多「未確認」是等你去實證的（Phase 1 的 claude cold start 就是設計沒料到、實測才炸出來的）。**先研究實證、TDD 實作、對抗式復審、Playwright 實跑給自己看**，四關都過才叫「做好了」。編譯過不算，邏輯上對不算，上一個 sub-agent 說好了也要自己複驗。這個專案的使用者很重視「拿證據說話」——每個「完成」都要附得出實測證據（測試 PASS／截圖／Seq log／DB 查詢）。

有疑義、連續實測不通、或要動破壞性/prod 的事——**停下來問使用者**，別硬做第三次。
