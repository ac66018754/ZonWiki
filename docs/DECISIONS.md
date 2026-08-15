# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。

---

## 2026-07-08 ｜Phase 3 交付：整合驗證＋兩輪對抗復審（Fable5 監工）

- **背景**：Phase 3（英文教練 Vertex Live WS 代理＋雙主持人 Podcast）由三個並行批次實作（批次1 資料層/護欄/Podcast、批次2 教練 WS 後端、批次3 教練前端），各自對抗復審過。監工做整合驗證與最終跨批復審，記關鍵發現與取捨。
- **整合驗證（實證，非只 tsc/測試）**：①後端 `dotnet test` **613 綠**（Api 547＋Infra 66）；②**真 Live smoke 經 .NET CoachLiveClient→真 Vertex(us-central1)**：文字回合取回 91KB PCM16 24kHz 音訊＋逐字稿全句，DB 驗 CoachMessage 逐字稿落地＋CoachSession 收尾 ended＋課末摘要生成（vertex-gemini-lite）＋resumption handle 持久化；③**真 Podcast E2E**：筆記→對談腳本(vertex-gemini-lite)→多講者合成(Cloud TTS cmn-TW Kore/Charon)→ffmpeg concat→ready，產 226 秒雙聲 MP3；④多講者 TTS 格式先以獨立探針去風險（975KB cmn-TW 真音檔）；⑤前端 Playwright 四主題（糾錯卡紅綠 diff 對比 4.83–6.81 全 ≥4.5）＋狀態機＋fatal 終態＋375px＋所有事件行為。
- **跨批契約漂移（監工整合時抓到、各批自審抓不到）**：三個並行批次照同一計畫各自具體化，前端 parseServerMessage 未完全對齊後端實際的 `{type:...}` 信封——①audio 後端送 `data` 欄／前端只讀 `audio`；②interrupted 後端送 `{type:"interrupted"}`／前端讀布林欄；③vocab_added 後端 `type` 值／前端找同名鍵。全修為容忍雙形狀並實測。**教訓：並行開發必須在整合點做真訊息往返驗證，單批自審與單回合 smoke 都抓不到跨批接縫。**
- **兩輪最終對抗復審（三路：資安/DoS、跨批契約、並發/三不變式）**：
  - **R1（9 findings）**：最關鍵 HIGH＝**重連狀態機死鎖**——後端 GoAway 訊號式重連送 `{type:"reconnecting"}`，前端 `isActiveState` 不含 reconnecting→重連後的 `state:listening`＋音訊全被守門吞→**每場超過單條連線壽命(~10分)的對話第一次 GoAway 就永久卡死**（會毀掉每場真實 30 分鐘課）。另修 REST 巢狀信封契約、強制終止逐字稿落地遺失、糾錯卡陣列落地、字幕定案（文字模式多回合串接）等。
  - **R2（在 R1 修正碼上又抽，1 CRITICAL＋2 HIGH）**：CRITICAL＝accept 競態自我終止路徑繞過 SignalDisplaced→幻影分鐘吃日額度＋SessionBudgets 靜態字典洩漏（修：保守當跨場收尾，因 finalize 冪等）；HIGH＝入站 text>2000 靜默丟棄前端卡 thinking（修：回 `{type:"rejected"}`＋前端 notice 條撥回 listening，實測「訊息過長，請縮短後再試」）；HIGH＝背景補釋義 fire-and-forget 未 join 污染跨測試共享計量表 flaky（修：FinishAsync join 加逾時）。
- **理由與取捨**：兩輪對抗復審各抓到真問題（尤其會毀掉每場長對話的重連死鎖、與窄競態的幻影分鐘 CRITICAL），驗證「並行批次＋各自自審」不足以保證整合正確，跨批整合復審＋真訊息往返驗證是必要關卡。全部修正後 613 測試綠、Live/Podcast/前端行為實測通過。
- **交付邊界（使用者職責，已於計畫標註）**：prod 需跑 migration `AddCoachTablesAndVocabSourceFk`＋種 `vertex-gemini-lite` 共用列；CF Tunnel×WebSocket 長連逾時、iPhone 實機（Wake Lock/standalone 麥克風權限/MediaSession 鎖屏/送出取樣率確為 16k）、prod CSP 放行 `blob:`（worklet）需實機驗；多講者 cmn-TW（Preview）計費 SKU 待第一張帳單核對。

## 2026-07-08 ｜Phase 3 教練「批次 1」資料層／護欄／Podcast 的三個實作偏離（相對定案計畫）

- **背景**：實作 Phase 3 批次 1（教練資料層＋護欄/預算服務＋雙主持人 Podcast，不含 WS/CoachProxy＝批次 2）時，為滿足計畫要求做了三處計畫未明列的結構決定。
- **決定 1——新增全站計量表 `CoachBudgetLedger`**：計畫 §1 只列 CoachSession/CoachMessage，但 §3/§4 要求 `CoachBudgetService`「DB 持久化累計」全站每日/每月花費。故新增一張**非 IUserOwned**（全站、無使用者隔離過濾）的 AuditableEntity 計量表（唯一鍵 (Scope, PeriodKey)，每日一列、每月一列），不登記垃圾桶/活動流（比照 TtsAudio 排除）。考慮過「把 token 累加在 CoachSession 上再跨用戶 SUM」——否決（需跨租戶掃全表、CoachSession 無 token 欄、與「全站」語意不符）。
- **決定 2——自建 `CoachDbContextFactory` 而非 EF `AddDbContextFactory`，且落點在 Infrastructure DI（非 Program.cs）**：既有 `AddDbContext`（scoped）已註冊 `DbContextOptions<ZonWikiDbContext>`，再呼叫 EF 的 `AddDbContextFactory` 會重複註冊該選項並造成生命週期衝突，可能連累整個 App 的 DbContext 解析。故自建極簡工廠捕捉一份**獨立選項**（同一 Npgsql 連線、忽略 ManyServiceProviders 警告），與既有 scoped 註冊完全隔離。放 Infrastructure 是為了與既有 AddDbContext 共用連線字串來源、避免在 Program.cs 重複組態。供 `CoachBudgetService`（singleton）建短命 context 用（【審修-A2】）。
- **決定 3——`TtsAudio` 新增 `Mode` 欄（read/dialogue）**：計畫 §10「快取鍵含 mode（read≠dialogue 不撞快取）」。除把 mode 併入 ComputeContentHash 外，另加持久欄 `Mode`，讓「同筆記＋聲音重合成即失效舊列」的清理**只在同模式內**作用（read 與 dialogue 兩份快取各自獨立並存，不互相失效）。既有列一次性回填為 "read"。
- **理由與取捨**：三者皆為「計畫要求的行為」在資料層的最小落地；偏離處都往「不破壞既有 scoped DbContext／既有 TTS 快取語意」的保守方向走。**未做**批次 2（CoachLiveClient/CoachProxyService/CoachPromptAssembler/`/ws/coach`/UseWebSockets/前端音訊層）與批次 3。
- **對抗式復審後的修正（3 項）**：①日分鐘計量讀路徑（`GetDailyUsedSecondsAsync`）現在<b>先做懶惰殭屍修正</b>並改用「今日交集裁切」演算法——否則死掉的 active 場會以 now 一路累加把使用者整天鎖死（計畫明列要避免的失敗）；②`CoachBudgetService` 花費累計改為<b>伺服器端原子遞增</b>（`SET x = x + n`），正確性不再依賴 in-process 鎖，多實例下也不會 lost-update（低估花費＝熔斷最危險失效）；③短命工廠只註冊<b>具體型別</b> `CoachDbContextFactory`（非泛型 `IDbContextFactory<>`），封住「未來誤注入無隔離 context 查 IUserOwned 實體」的跨租戶地雷。
- **已知取捨（復審確認、刻意保留）**：(a) mode 併入 ContentHash 後，<b>部署後對既有筆記首次朗讀會 cache-miss 重合成一次</b>（重付一次 TTS 費用）——必要之惡（唯一索引 (UserId, ContentHash) 不含 Mode，若 read/dialogue 不分會撞唯一約束），且會經 mode-scoped 失效自我修復，不留孤兒；(b) 懶惰殭屍修正走 `ExecuteUpdate` 繞過活動流攔截器，故「殭屍收尾」不進活動流（系統清理非使用者動作，避免噪音；正常收尾仍會記）。
- **驗證**：`dotnet build` 0 error、`dotnet test` 全綠（Api 500+ 綠、Infrastructure 66 綠，新增約 43 筆）、migration `AddCoachTablesAndVocabSourceFk` 生成且 has-pending-model-changes=none、前端 `tsc --noEmit` 0 error。

---

## 2026-07-08 ｜Phase 3 英文教練：Vertex Live region 改 us-central1（實測推翻設計書的 us-west1）＋協定去風險

- **背景**：Phase 3 教練用 Vertex AI Live API（`gemini-live-2.5-flash-native-audio`，GA），架構＝瀏覽器→自家 .NET WS 代理→Vertex Live WS。開工前依準則 4.1「前置實測未過別往下做」先驗協定。
- **關鍵修正——region 從 `us-west1` 改 `us-central1`**：設計書 §4.1 定 `us-west1`，但研究查官方支援清單發現 **native-audio GA 不含 us-west1**（支援 us-central1／us-east1/4/5／us-south1／europe-west1/4/8）。**本機實跑 Python 探針證實**：`us-central1` 完整打通（WS 握手 200＋ADC Bearer 認證＋setupComplete＋文字回合回 226KB PCM16 24kHz 音訊＋逐字稿全句 "Hello! I'm here to help you practice your English…"＋generationComplete→turnComplete→usageMetadata，exit 0）。故 region 一律 `us-central1`、且**模型 region 設定值化**（退役日 2026-12-13 前換後繼模型）。彰化 VM→us-central1 RTT 比 us-west1 略高但同屬美中西，可接受。
- **協定去風險定案（實證，非臆測；供實作照抄）**：
  - WS URL＝`wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`（**Vertex 版 LlmBidiService，非 Developer API 的 generativelanguage**）。
  - 認證＝WS header `Authorization: Bearer <ADC token>`（重用 `IVertexAdcTokenProvider`）；**不需 x-goog-user-project**（project 已在 model 路徑內）。
  - `setup.model` ＝完整資源路徑 `projects/zonwiki-prod/locations/us-central1/publishers/google/models/gemini-live-2.5-flash-native-audio`（Vertex 專有格式，非 `models/{m}`）。
  - setup 帶 `generationConfig.responseModalities:["AUDIO"]`（native-audio 一次只一種 modality）＋`speechConfig`＋`systemInstruction.parts[].text`（物件非字串）＋`inputAudioTranscription:{}`＋`outputAudioTranscription:{}`（空物件即開逐字稿）＋`realtimeInputConfig.automaticActivityDetection`（VAD）＋`contextWindowCompression`＋`sessionResumption:{}`＋`tools.functionDeclarations`（`behavior:"NON_BLOCKING"`）。
  - 音訊：上行 PCM16 16kHz（`realtimeInput.audio{mimeType:"audio/pcm;rate=16000",data}`）、下行 PCM16 24kHz（`serverContent.modelTurn.parts[].inlineData`）——**代理不可搞混上下行取樣率**。
  - server→client 一律 camelCase；**一個 frame 可同時含多個頂層 key**（實測見 `{serverContent, usageMetadata}` 同幀）→ .NET parser 不可假設單一頂層 key。三旗標 `interrupted`／`generationComplete`／`turnComplete` 分別出現。
- **考慮過的選項**：(a) 照設計書用 us-west1——被官方清單＋實測否決；(b) 用 global 端點——native-audio 不支援 global；(c) us-central1——**採用**（官方支援＋實測通）。
- **理由與取捨**：先花小額（探針幾秒音訊 ≈$0.001）實證換掉一個會讓「setup 後拿不到音訊」的隱藏地雷，遠比實作到一半才發現便宜。此為準則 4.1／鐵則 #21（先實證再動手）的正面案例。探針腳本存 scratchpad/live_probe.py，協定全譜規格存 scratchpad/phase3-live-spec.md。

---

## 2026-07-08 ｜記帳分析頁後端（Phase 2・工作包 A）實作定案

- **背景**：實作設計書 §5.5／§5.6 的記帳分析頁後端——一次回五大區塊彙總（本月總額＋與上月比、近 N 月趨勢、分類佔比、日彙總、商家 Top N），供前端 Recharts 圖表＋Tailwind 日曆熱圖。以下為關鍵取捨與六條審查修正（HIGH×1／MEDIUM×3／LOW×2）的落實。
- **新增 `GET /api/expenses/analytics`、`/stats` 零改動**：分析回應是重量級彙總，塞進 Phase 1 已被前端消費的輕量 `/stats`（`ExpenseStatsDto(total,count,month)`）會跨波破壞既有消費者、且讓「本月一個數字」被迫收大 payload。故新增獨立端點，`/stats` 維持原狀。取捨：`monthTotal` 在兩端點各算一次 SUM（成本可忽略）。無限流（read-only、不打 LLM，比照 `/stats`）。
- **月界數學抽 `ExpenseMonthRange` 共用（同時重構 `StatsHandler`）**：把 Phase 1 `StatsHandler` 私有的 `TryResolveMonthRange`／`TryParseMonth` 原封搬到共用靜態類別 `ExpenseMonthRange`，並新增 `TryResolveAnalyticsRange(month, trendMonths)` 產三段 UTC 半開區間（選定月 `[Start,End)`、上月 `[PrevStart,Start)`、趨勢窗 `[TrendStart,End)`）。`StatsHandler` 改呼叫共用版（行為保持的純搬移；既有 `GetStats_*` 測試為回歸鎖，實跑續綠）。沿用 DECISIONS「月界 UTC」慣例。
- **SQL GROUP BY／SUM（DB 端彙總）＋日/月分組經實證為 UTC 安全**：金額 decimal 在 DB 加總、不拉原始列。日/月分組用 `e.OccurredDateTime.Year/Month/Day`——**經 `ToQueryString()` 實證** Npgsql 譯為 `date_part('day', col AT TIME ZONE 'UTC')`（顯式帶 `AT TIME ZONE 'UTC'`），故不依賴連線 session 時區、恆為 UTC 日/月界（整合測試 I6 以 `2026-07-01T23:30Z`＋`2026-07-02T00:30Z` 鎖死 UTC 分日）。每句彙總皆 `IgnoreQueryFilters()`＋明確 `UserId`＋`ValidFlag`（多租戶＋軟刪除鎖，與 `StatsHandler` 一致）。
- **分類佔比取 metadata 走「保底方案」（GroupBy 純量 CategoryId＋記憶體 join 名稱/圖示）**：主方案（GroupBy 含導覽欄 `e.Category!.Name/Icon`）有 EF 翻譯風險，故直接採保底——Q1 只按純量 `CategoryId`（含 null 未分類桶）分組彙總，再一句 `ExpenseCategory`（`IgnoreQueryFilters`＋UserId，不濾 ValidFlag 讓「已軟刪分類但仍有歷史消費」的名稱也能顯示）撈 metadata 記憶體 join。多 1 句查詢、確定可翻譯。**另**：商家 Top N 的 `GroupBy→Select(具名 record)→OrderBy/Take` 實測 EF 無法翻譯（`could not be translated`），改用**匿名型別**中繼投影後材質化再映射 DTO（實測修正）。
- **與上月比 `prevMonthTotal` 用獨立區間、不由趨勢窗推導（審查 MEDIUM：N=1 邊界）**：原計畫從趨勢窗聚合 map 取上月，當 `AnalyticsTrendMonths=1` 時趨勢窗只含選定月→上月恆 0→deltaPct 恆 null（即使上月有消費）。**改為上月專屬區間 `[PrevStart, Start)` 單獨一句 SUM**，與 N 解耦。單元＋服務層 N=1 整合向量鎖死（上月 200、本月 300 → prevMonthTotal=200、deltaPct=50.0，trend 僅 1 筆）。
- **`deltaPct` 單一擁有者＝後端（審查 LOW：重複計算/死欄位）**：後端計算並回傳 `deltaPct`（`(monthTotal-prevMonthTotal)/prevMonthTotal*100`，`MidpointRounding.AwayFromZero` 1 位；`prevMonthTotal==0`→`null`）。前端應**消費此值、移除自算路徑**；後端不回計畫中的 `previousMonth` 字串（前端如需自 `month` 推導）。避免兩邊各做一份白工。
- **前後端契約欄名鎖定（審查 HIGH：欄名不一致靜默壞掉）**：後端權威欄名＝`month／monthTotal／monthCount／prevMonthTotal／deltaPct／monthlyTrend／categoryBreakdown／dailyTotals／merchantTopN`；子物件 `monthlyTrend[].{month,total,count}`、`categoryBreakdown[].{categoryId,name,icon,total,count}`、`dailyTotals[].{date,total,count}`、`merchantTopN[].{merchant,total,count}`。以 `ExpenseAnalyticsContractSerializationTests`（`JsonSerializerDefaults.Web` camelCase）逐欄斷言鎖死。**前端 WP-B 的 normalizeAnalytics 別名表必須把這些後端真名全列入 fallback**（`monthTotal→currentTotal`、`monthCount→currentCount`、`prevMonthTotal→previousTotal`、`merchantTopN→merchants` 等），勿只列臆測的 total/count/topMerchants/lastMonthTotal。
- **`monthlyTrend`／`dailyTotals` 補上 `count`（審查 MEDIUM：宣告卻永遠 undefined）**：前端 TrendPoint/DailyPoint/DayCell 帶 `count`，故後端 Q2/Q3 一併回 `Count()`（缺月/缺日補 0）；避免前端拿到 undefined。
- **空狀態語意（審查 MEDIUM，前端 WP-B 需落實）**：空月時後端仍回**完整 N 筆趨勢**（含前幾月真實數字，讓趨勢圖有完整軸），`categoryBreakdown/dailyTotals/merchantTopN` 為 `[]`、不報錯。**前端不可用 `monthTotal===0 && monthCount===0` 藏掉整頁**——本月零消費但有跨月歷史時，仍要渲染趨勢圖與 delta（各子圖自帶 mini 空狀態）。整合測試 I1 鎖「空月回零＋6 筆全零趨勢＋末筆＝選定月」。
- **下鑽區間邊界（審查 LOW，前端 WP-B 注意）**：分析頁分類/日彙總用半開 `< endUtc`；下鑽重用的 `GET /api/expenses` 其 `to` 是 `<=` 閉區間。前端下鑽 `to` 應傳「次月月首前最後一個可表示瞬間」以逼近半開（**不可直接傳次月月首**，否則會多收午夜那筆）。此為已知微秒級容差（個人記帳極低機率），後端不改 list 端點（範圍紀律）。
- **設定值化**：`Expense:AnalyticsTrendMonths`（預設 6，clamp 1..24）、`Expense:AnalyticsMerchantTopN`（預設 10，clamp 1..50），具名常數、無魔術數字。**無 schema 變更**（分析全走既有欄位與既有索引 `(UserId,OccurredDateTime,ValidFlag)`，不新增 migration）。
- **自測**：`dotnet build -c Release` 0 error；`dotnet test ZonWiki.slnx -c Release` 全綠（Api 460＋Infra 66＝526）**連跑兩次穩定**（本機後端佔 5009／Debug DLL，全程 Release）。新增 43 筆分析測試（單元 math／month-range／契約序列化＋整合 I1–I15＋N=1）。活體（真實資料打一次端點＋Seq）由監工驗收。

## 2026-07-08 ｜記帳分析頁：對抗復審後修正落實（Fable5 監工）

- **背景**：分析頁前後端實作完成後，三路對抗復審（csharp／frontend／security）回報前端 3 MEDIUM＋3 LOW、後端 3 LOW。以下為 Fable5 監工的修正裁定與落實（全數已修並活體驗收）。
- **分析載入錯誤語意：真正失敗改 `throw`、只有 not-ready 回 `null`（前端 MEDIUM）**：原 `getExpenseAnalytics` 用 try/catch 把所有失敗吞成 null，導致 5xx／斷線與「真的零消費」無法區分、AnalyticsView 的錯誤四態成死碼。改為 **404（端點未就緒）／401（未登入，另有全站彈窗）回 null；5xx／網路／JSON 損毀／其餘 4xx 一律 throw**，讓 SWR 的 error 被填、進錯誤框並可自動重試。取捨：not-ready 仍走友善空狀態以保前後端平行開發體驗。
- **趨勢柱過去月 opacity 0.55→0.75（前端 MEDIUM／§11 WCAG 1.4.11）**：過去月柱本身即資料載體且無逐柱數值標籤，0.55 在兩淺色主題對卡面僅 2.30–2.54:1（<3:1）。實算四主題後取 0.75（最低 light 3.21、warmpaper 3.78），四主題過去月柱皆 ≥3:1。
- **日曆熱圖：階梯下限 0.18→0.4＋所有日格統一邊框（前端 MEDIUM／§11）**：原最低桶對卡面僅 1.2–1.35 幾乎不可見；且「無消費日有實框、最低消費日無框」造成顯著性反轉（消費日看起來比沒消費還空）。修法：opacity 階梯改 `[0.4,0.55,0.7,0.85,1.0]`（桶1 升到 1.6–2.1、五級仍可辨），**所有日格一律 `border-default` 邊框**、綠色填充當唯一差異載體 → 任何消費日一律 ≥ 無消費日。熱圖最低桶在保留 5 級下無法各自達 3:1（sequential 天性），但色非唯一載體（aria-label＋title＋離散 legend）符合準則。
- **環圈扇形 onClick 索引防護（前端 LOW）**：`onClick={(_, index)=>handleDrill(folded[index])}` 若 recharts@3 傳入非數字/越界 index，`slice.categoryId` 會拋 TypeError 讓整頁崩。改為 `typeof index==='number'?folded[index]:undefined` ＋ handleDrill 對 undefined 早退。
- **商家 Top N 排除純空白商家（後端 LOW）**：`.Where(e=>e.Merchant!=null && e.Merchant!="")` 漏放 `"   "`，與「排除 null／空白」契約不符。改 `e.Merchant!.Trim()!=""`（EF 譯 btrim，仍 DB 端過濾）。
- **整合測試容器設 `TZ=Asia/Taipei`（後端 LOW：修「假綠」）**：測試容器原無 TZ（session 預設 UTC），日/月分組測試「剛好」通過而抓不到「分組未帶 UTC 轉換」的回歸。對齊 prod／docker-compose 的 `TZ: Asia/Taipei` 後，既有 I6（`23:30Z`＋`00:30Z` 在台北時區皆落 7/2 本地日、但斷言分成 7/1 與 7/2 UTC 日）成為真正的回歸鎖——實跑 526 測試在 Asia/Taipei 下仍全綠，證實分組確走 `AT TIME ZONE 'UTC'`。
- **另有 2 LOW 依裁定處理**：下鑽 pageSize=200 截斷 → 面板加「共 N 筆，僅顯示前 200 筆」提示（不加分頁，範圍紀律）；環圈淺主題多色 <3:1 → 維持現況（已文件化取捨：身分靠 legend＋icon＋文字承載，色非唯一載體）。
- **Fable5 活體驗收**：backend 526 綠（新 TZ）；前端 tsc/eslint/build/純函式向量 73 全綠；本機種 39 筆真實消費（3 月/8 分類/12+ 商家）後 Playwright 實測——四主題（warmpaper/light/dark/night）桌機＋375px 手機截圖（收 `tmp/playwright/phase2-analytics/`）、環圈 legend／扇形／熱圖日三條下鑽皆開正確明細、console 零錯誤、375px 無爆版。

## 2026-07-07 ｜TTS 後端（Phase 2・工作包 A）實作定案

- **背景**：實作設計書 §6.1/§6.3/§6.4 的筆記朗讀 TTS 後端 v1——`TtsAudio` 表＋Gemini-TTS 供應者＋口語稿服務＋背景合成管線＋六端點（synthesize/status/serve/voices/tts-settings GET·PUT）。v1 採監工裁定的「穩健路線」：背景合成全部段落→ffmpeg 併成單一檔→授權供檔＋HTTP Range（分段串流首播留 v2）。以下為關鍵取捨與八條審查修正的落實。
- **快取鍵以「筆記內容」為上游、非口語稿（達成設計目的的正確實作）**：設計 §6.3 字面寫「快取鍵＝SHA-256(口語稿正規化文字＋…)」，但口語稿由 VertexAdc 產生——若以口語稿當鍵，每次重播都得先打一次 Vertex 才算得出鍵，無法達成 §5 驗收②「重播零成本」。**修正為 `ComputeContentHash(Normalize(note.ContentRaw) ∥ voice ∥ language ∥ format ∥ TtsScriptService.PromptVersion ∥ ttsModelName)`**（0x1F 分隔、SHA-256 hex）：`POST /synthesize` 能在產口語稿與呼叫 TTS 之前就查快取→命中直接回 ready（零 Vertex／零 TTS）。Normalize＝Trim＋`\r\n`→`\n`＋摺疊連續空白。
- **前端契約欄名鎖定（審查 #1/#2/#7，後端對齊工作包指定契約）**：①合成/狀態回應音檔主鍵欄名一律 **`ttsAudioId`**（非 `id`）；②章節時間欄名一律 **`startSeconds`**（非 `offsetSeconds`）；③聲音顯示標籤欄名一律 **`label`**（非 `styleLabel`）。另 tts-settings 主動對齊前端 `TtsSettings`＝**`{ voice, language, format }`**（非 `defaultVoice`）。以純序列化單元測試（`TtsContractSerializationTests`）＋整合真 JSON 斷言雙鎖，杜絕與 WP-B 靜默分歧。
- **快取命中路徑也回章節與時長（審查 #3）**：`POST /synthesize` 的 200 ready 回應（含 23505 並發攔截後的 ready 回應）一併帶 `durationSeconds` 與 `chapters`（反序列化自 `ChaptersJson`），讓前端「重播零成本」路徑不需補打 /status 就能顯示章節。
- **processing 陳舊判定＝重跑（審查 #4：背景死於重啟的孤兒列）**：背景合成靠 fire-and-forget＋記憶體 CTS，後端重啟（本機每日 prod 覆蓋後強制重啟、任何重新部署）會讓合成中的列永遠停在 processing、CTS 消失、無復原。**決策表對「processing ＆ Valid」加陳舊判定**：`UpdatedDateTime` 超過 `Tts:SynthesisBudgetSeconds`（預設 600）即視為背景已死→重置 processing＋重跑（非另建啟動復原 HostedService，決策表內判定更簡且可測）。此門檻恰等於合成硬預算：真正在跑的合成在預算內必然完成或被 CTS 取消標 failed，唯有死掉的孤兒才會超過門檻。整合測試 `陳舊processing_可被重新觸發至ready`（用 `ExecuteUpdate` 回溯 UpdatedDateTime 繞過稽核攔截器）鎖死。
- **試聽端點延到 v2（審查 #6，二擇一取「延後並落 DECISIONS」）**：設計 §6.2 列 v1 有「▶ 試聽鈕（合成短句試聽）」，但工作包端點清單無 preview 端點。**決策：v1 不做 `POST /api/tts/preview`，延到 v2**。理由：①試聽的回傳形狀（直接回音檔 vs `{ttsAudioId,status}`＋輪詢＋授權供檔）有跨組件契約分歧，兩端無法各自獨立驗證；②試聽非 §5 驗收項（§5=複習/朗讀播放/重播零成本/分析頁），延後不破壞驗收；③前端 WP-B 已對 preview 404 優雅降級（灰掉試聽鈕）。此為明確的延後決策，非無聲砍規格。
- **前端輪詢上限須 ≥ 後端合成預算（審查 #5，後端契約備註）**：後端 `/status` 在合成期間持續回 processing 直到合成完成或撞硬預算（預設 600 秒）標 failed。**前端不可用固定 90 秒判死**（長筆記切段逐段 us/eu 往返＋ffmpeg concat 極可能 >90 秒，此時後端仍正常進行）。前端應「status 仍回 processing 就持續輪詢，僅在後端回 failed 或連續 N 次取不到才判失敗」——此為 WP-B 需落實項，後端已於契約載明。
- **CORS 暴露 Range 標頭＋供檔走 Cookie 認證（審查 #8/對齊點 D）**：dev（3000→5009）跨源 `<audio>` 拖曳/206 需讀得到範圍資訊，故 `ZonWikiCors` policy 補 `WithExposedHeaders("Content-Range","Accept-Ranges","Content-Length")`（prod 同源不觸發）。並載明：瀏覽器媒體元素只能帶 Cookie、無法帶 PAT Bearer，故 `GET /api/tts/audio/{id}` 在瀏覽器情境等同 Cookie 認證（可接受）。
- **白名單「不」登記＋一律軟刪除**：`TtsAudio` 是快取品——`TrashTypeRegistry` 與 `ActivityLogInterceptor.MapEntity` 兩處皆不登記（進垃圾桶語意錯誤、會灌活動流；準則 §2.3、設計 §9）。回歸測試 `TtsWhitelistTests`（GetEntityType 回 null）＋整合 `TtsActivityLogHttpTests`（synthesize/serve 全程零 ActivityLog）鎖死。DB 列一律軟刪除；唯一索引 `(UserId, ContentHash)` 不含 ValidFlag（復活 upsert，並發首建攔 23505 改查既有）。
- **v1 清理＝同筆記＋聲音重合成即失效舊列與舊檔**：未命中要建新列前，先軟刪同 `(UserId, NoteId, VoiceName)` 但不同 ContentHash 的舊列，並 `File.Delete` 其實體快取檔（快取檔可完全再生，屬快取品定位；DB 列走軟刪保留 metadata）。runtime `File.Delete` 是後端 C# 執行、非 agent 跑 shell，不受 delete-guard 約束。不建 LRU／排程（成本天花板 <$5/月，靠磁碟 80% 告警當保險）。整合測試 `I3` 鎖「舊列 ValidFlag=false＋舊檔已刪」。
- **ADC token 不外流（沿用 VertexAdc 三道防線）＋供檔無路徑穿越**：`GeminiCloudTtsService` 打的是固定官方端點 `texttospeech.googleapis.com`（設定值 `Tts:Endpoint`，非使用者可控），ADC token 只當 Bearer 送該端點＋固定 `x-goog-user-project`（值取自 `Gcp:QuotaProject`，Cloud TTS URL 無 project 缺此 header 會 403）；口語稿走 `AiProviderFactory.ResolveAsync`（既有安全路徑零改動）。授權供檔核對 `UserId＋ValidFlag＋Status=ready`（他人 404 不洩漏）；`FilePath` 由伺服器以列 Id 生成（`{cacheDir}/{id:N}.{ext}`，非使用者輸入）→ 無路徑穿越。
- **口語稿降級不 throw＋章節時間 best-effort**：`TtsScriptService` 走 VertexAdc flash-lite（reuse `AiProviderFactory`；記帳教訓避免 claude cold start），LLM 回壞 JSON／空→降級為「Markdown 去記號的單一 speech 片段」（保底至少能唸原文，章節=無）。章節時間位移逐塊 `ffprobe` 量測，量不到→章節退化為 null（`ChaptersJson=null`），總時長退 null 由前端 `<audio>.duration` 補；ffprobe 不可用不讓合成失敗。背景管線任何例外一律 catch 標 failed（安全 ErrorText、保底存檔用 `CancellationToken.None`），絕不冒成未攔截。style prompt v1 不帶（recon 標未確認），param 保留待 v2。
- **設定值化＋Fake 短路測試**：新增設定鍵 `Tts:Provider`（Fake→測試）、`Tts:Endpoint`、`Tts:ModelName`（gemini-2.5-flash-tts）、`Tts:DefaultVoice/Language/Format`（Kore/cmn-TW/MP3）、`Tts:ScriptModelKey`（vertex-gemini-lite）、`Tts:MaxInputBytes`（4000）、`Tts:CacheDirectory`（App_Data/tts-cache）、`Tts:SynthesisBudgetSeconds`（600）、`Gcp:QuotaProject`（zonwiki-prod）、`Tts:FfprobePath`；ffmpeg 重用既有 `Refine:FfmpegPath`。整合測試以 `Tts__Provider=Fake`（FakeTextToSpeechService＋FakeAudioComposer）短路真外呼與 ffmpeg，並把快取檔導到暫存目錄避免污染 repo。
- **自測**：`dotnet build -c Release` 0 error；`dotnet test ZonWiki.slnx -c Release` 全綠（Api 399＋Infra 66＝465）連跑兩次穩定（本機後端佔 5009／Debug DLL，全程 Release）。migration `AddTtsAudioAndUserTtsSettings` 人工核對：唯一索引 `UX_TtsAudio_UserId_ContentHash`（無 ValidFlag、無 filter）、`IX_TtsAudio_UserId_NoteId_ValidFlag`、Status varchar(16)、DurationSeconds double、SizeBytes bigint、`timestamptz` 稽核欄齊全、FK→Note Restrict、`User_TtsSettingsJson` nullable varchar(1024) 對既有列零成本後補。**已知小取捨**：極端並發下同一 stale/failed 列被兩請求同時重置＋各自背景合成，會對同一列與同一檔重複寫入（末寫者勝，皆產有效音檔）——單人系統機率極低，v1 接受，未加 xmin 樂觀鎖。

## 2026-07-07 ｜TTS 前端（Phase 2・工作包 B）實作定案

- **背景**：實作設計書 §6.2/§6.6 的筆記朗讀前端——筆記詳情頁「🎧 聆聽」→ 底部迷你播放器（單一 `<audio>`＋合成輪詢＋播放/暫停/±15秒/語速/章節跳段/續聽位置/聲音選擇＋試聽）。只碰 `frontend/`。以下為實作期間的關鍵取捨（審查修正一併記錄）。
- **契約層「同時容忍兩種欄名」以吸收兩份計畫的分歧（審查 HIGH #1/#2 + MEDIUM #7 + 設定欄）**：後端計畫曾用 `id`/`offsetSeconds`/`styleLabel`/`defaultVoice`，工作包契約用 `ttsAudioId`/`startSeconds`/`label`/`voice`。`lib/api/tts.ts` 的正規化一律讀「兩者擇一」（`id ?? ttsAudioId`、`offsetSeconds ?? startSeconds`、`styleLabel ?? label`、`defaultVoice ?? voice`），對外統一暴露為工作包欄名；PUT tts-settings 兩個欄名（`voice`＋`defaultVoice`）都送。**實讀後端實作 DTO（`TtsDtos.cs`）確認：後端最終對齊工作包欄名（`ttsAudioId`/`startSeconds`/`label`/`voice`）**，落在正規化的 fallback 分支，前端拿到的主鍵不會是 undefined（避免 `ttsAudioUrl(undefined)` 全鏈崩潰）。此容錯讓前端對「後端不論選哪套欄名」都不會壞。
- **快取命中「重播零成本」仍顯示章節（審查 MEDIUM #3）**：`SynthesizeResult` 一併接收後端在 ready 回應帶的 `chapters`/`durationSeconds`（後端 `TtsSynthesizeResponseDto` 已在快取命中路徑回這兩欄）；若 ready 卻無章節，`applyReady` 才補打一次 `/status` 取章節（`/status` 不打 TTS/Vertex 外呼，不違反「零成本」）。
- **前端輪詢上限對齊後端合成硬預算（審查 MEDIUM #5）**：不以固定 90 秒判死（長筆記切段合成可能 >90s）。改為「只要 `/status` 持續回 processing 就繼續輪詢」，僅在：①後端回 `failed`、②連續 8 次取不到狀態、或 ③絕對上限 15 分鐘（> 後端 `Tts:SynthesisBudgetSeconds` 預設 600 秒）才判失敗。逾時顯示失敗＋重試；重試對「後端已重啟致 processing 陳舊」的列有效——後端已實作 `IsStale`（UpdatedDateTime 超過合成預算即重置重跑，審查修正 #4），故重試會重新觸發而非卡死。
- **試聽（▶）端點延到 v2（審查 MEDIUM #6）**：設計 §6.2 列「▶ 試聽鈕」，但後端 v1 無 `POST /api/tts/preview`（實讀 `TtsEndpoints.cs` 確認只有 synthesize/status/audio/voices/tts-settings 五端點）。前端 `previewVoice` 已完整接線：呼叫 `/api/tts/preview`，命中 404 → 灰掉試聽鈕＋tooltip「後端試聽端點尚未就緒」，不阻斷主流程。**決定：試聽端點延到 v2**；當後端補上該端點，前端試聽鈕自動點亮（無需再改前端）。此為「明確記錄的延後決策」而非無聲砍功能。
- **筆記頁只加單一插入點（範圍紀律，鐵則 #5）**：原計畫在 `page.tsx` 掛兩處（工具列聆聽鈕＋頁尾播放器）。改為 `ListenButton` 一個協調元件——它同時渲染工具列的 🎧 鈕，並以 `createPortal` 把 `position:fixed` 的迷你播放器掛到 `document.body`（避開任何祖先 transform/overflow 影響定位）。`page.tsx` 因此只新增「一顆按鈕＋一行 import」，把對既有超重筆記頁的侵入面降到最小。合成/輪詢/播放整段生命週期收在 `TtsMiniPlayer` 內。
- **UIUX 對比修正（四主題 WCAG AA 實測）**：①播放主鈕用 `--action-primary-bg/-fg`（深底＋白字，四主題實測 4.63–9.25:1），**不用** `--action-secondary-fg`（暗主題是淺藍，配白字只 ~1.x:1 會失敗）；②當前章節高亮改「左側藍色邊條＋粗體＋▸ 圖示」三載體、文字維持 `--text-primary`（10.86–15.80:1），不把藍字放弱對比底（`--action-secondary-fg` on `--bg-surface-secondary` 在 light 只 4.45:1 差臨界）；③失敗重試鈕改外框式（文字＝`--status-danger-fg` 落在錯誤框的 `--status-danger-bg`，四主題 4.73–5.81:1），不用「白字配亮紅底」（暗主題只 3.35:1）。全部用 CSS token、零硬編色票。
- **播放手勢鏈**：`play()` 只在使用者手勢（▶ 鈕點擊／鎖屏 MediaSession handler）內呼叫；輪詢/合成會斷開原始手勢鏈，故 ready 後**不自動播**，一律等使用者按 ▶（iOS/桌機 autoplay 規範）。單一 `<audio>` 全生命週期不重建、只換 `src`（iOS 續播特性）。
- **自測**：TDD 純函式向量（`lib/ttsPlayer.ts` 的 formatDuration/clampSeek/currentChapterIndex/續聽讀寫/語速/狀態機/formatVoiceLabel）以 scratchpad node 腳本鎖死 10 組全過；`pnpm exec tsc --noEmit`、對改動檔 `eslint`、`pnpm run build`（Next 16 生產建置）三者全綠（Node 20.12.2）。Playwright 活體由監工統一驗收。

## 2026-07-07 ｜單字庫後端（Phase 2・工作包 A）實作定案

- **背景**：實作設計書 §3 單字庫後端——`VocabularyWord` 表＋SM-2 排程純函式＋七端點（CRUD/due/review/ai）＋白名單登記。以下為實作期間的關鍵取捨（審查修正一併記錄）。
- **SM-2 → FSRS 欄位映射（DB 照 FSRS 形狀、值由 SM-2 填，設計 §3.1「換 FSRS 不動表」）**：`_Difficulty`＝EF（1.3~2.5+，方向與 FSRS 相反，僅為容器）、`_Stability`＝目前排程間隔（天，並作為成熟卡下次間隔的乘算基底）、`_Reps`＝連續成功次數 n（Again 歸零，與 FSRS 單調不同）、`_Lapses`＝遺忘次數（僅已畢業卡）、`_State`＝New/Learning/Review/Relearning。四鍵→quality：Again=2/Hard=3/Good=4/Easy=5；EF 每次複習更新（含 Again）並 clamp≥1.3。間隔階梯：n0→1（Easy 4）、n1→6（Easy 8）、n≥2→Hard=round(I×1.2)/Good=round(I×EF)/Easy=round(I×EF×1.3)，保底 max(前一間隔+1, 乘算值)。測試向量鎖死 [1,6,15,38] 等。
- **排程一律後端計算（DB-as-truth，審查 HIGH）＋預覽=實際**：`Sm2Scheduler.PreviewIntervals` 與 `Review` 共用單一私有 `Compute` 路徑，保證「四鍵下次間隔預覽＝按下去的實際排程」。**每個 `VocabularyWordDto` 都攜帶 `schedulePreview`（again/hard/good/easy → {intervalDays, due=now+interval}）**，前端複習卡按鍵前直接消費（權威值，不再自行降級估算）。複習回應 `ReviewVocabularyResponseDto` 只回 `Card`（其 schedulePreview 即「下一次複習」的預覽），**移除原計畫的獨立 `Preview` 欄（無人消費、會成死碼）**。前端降級估算若保留，其寫死常數須改為與後端一致（Again≈1 天而非 <10 分、早期 Good/Hard 反映 1/6 階梯），或改用純定性詞。
- **間隔取整鎖 `MidpointRounding.AwayFromZero`（審查 LOW）**：`Math.Round(x, AwayFromZero)` 後套下限 1；.5 邊界一律遠離零進位（例 12.5→13），並補一個 .5 邊界向量鎖死行為，避免日後新增邊界向量時非決定性。
- **複習高頻更新不灌活動流（審查 MEDIUM）**：`ActivityLogInterceptor` 對 `VocabularyWord` 判斷「本次 Modified 是否只動到 SRS 欄（Due/Stability/Difficulty/State/Reps/Lapses/LastReviewDateTime）」，若是則不記活動流（一場複習數十張卡＝數十筆會洗版）；只有 word／釋義等 CRUD 編輯才記 'updated'；新增/軟刪/復活仍正常進活動流。同理由於設計 §9 把 CoachMessage 排除。
- **來源筆記連結（審查 LOW，採選項 a）**：`VocabularyWordDto` 補 `SourceNoteSlug`＋`SourceNoteTitle`（投影時 join Note 取用），前端據此做 `/notes/{slug}` 正確連結；**切勿用 SourceNoteId 硬組 /notes/{id}**（notes 路由為 slug 制）。
- **AI 補釋義（reuse VertexAdc、記帳已定案 Vertex）＋失敗一律降級不 500**：`POST /api/ai/vocabulary` 先 `UpsertAsync`（word 永不丟失、復活軟刪列），再以硬時間預算（`Vocabulary:EnrichBudgetSeconds` 預設 15、clamp 0.2~30）跑 `EnrichAsync`；成功只填「原本為空」的釋義欄（不覆蓋使用者既有內容）、`Enriched=true`；逾時／壞 JSON／供應者建構失敗（ADC 不可用等 InvalidOperationException）／Error 事件 → 一律 catch 吞成降級（word 已存、`Enriched=false`），保底存檔用 `CancellationToken.None`。VertexAdc 三道安全防線零改動沿用 `AiProviderFactory.ResolveAsync`。掛 `PatAiRateLimitMarker` 組合限流（比照記帳）。
- **唯一索引 (UserId, Word) 不含 ValidFlag＋復活 upsert（含並發）**：`VocabularyService.UpsertAsync` 依 (UserId, Word) find→有軟刪列復活→無則建 SM-2 新卡；並發首建撞 23505 攔截改查既有列（比照 ExpenseCategoryService）。新增並發整合測試（同字並發 POST 只建一列、皆非 500，手動與 AI 兩路徑）＋ `/due` 跨租戶隔離測試（審查 MEDIUM）。
- **測試隔離修正（實測抓到）**：`VocabularyEnrichmentServiceTests`／`VocabularyAiHttpTests` 的「非-Fake 預設供應者」測試，原依賴 `ResolveAsync` 因「無匹配/共用模型列」回退到注入的測試替身；但 `AiProviderFactoryVertexAdcTests` 會在共用 Testcontainers DB 種 `SharedModelUserId` 名下的 Enabled VertexAdc 列，經「共用預設」退路洩漏進來，使測試依類別執行順序偶發解析到真 provider（實跑第一次全套即抓到 1 例失敗）。**修法：為測試使用者種一筆本人的 ClaudeCli 列（own 勝 shared 排序＋ClaudeCli 分支回退到注入的預設供應者），讓解析確定命中測試替身**，不動其它測試。（此為既有 Expense scripted 測試同款潛在脆弱性，但只在本工作包範圍內修自己的測試。）
- **自測**：`dotnet build -c Release` 0 error；`dotnet test ZonWiki.slnx -c Release` 全綠（Api 339＋Infra 66＝405）連跑兩次穩定（本機後端佔用 5009／Debug DLL，全程用 Release）。migration `AddVocabularyWord` 人工核對：唯一索引 UX_VocabularyWord_UserId_Word（無 ValidFlag、無 filter）、IX_VocabularyWord_UserId_Due_ValidFlag、State integer、Difficulty/Stability double precision、Due timestamptz、FK→Note Restrict、6 稽核欄齊全。

## 2026-07-07 ｜Phase 2 開工前技術偵察定案（Recharts 3、Gemini-TTS 端點）

- **背景**：設計書 Phase 2 有兩個標「未確認」的技術未知會 gate 實作——Recharts 對 React 19 的相容性、Gemini-TTS 的端點形狀。監工（Fable5）用 ADC 實打確認，供 Opus 直接照用。
- **Recharts**：`recharts@3.9.2` 的 peerDependencies 明列 `react/react-dom/react-is: ^19.0.0`，前端是 React 19.1.8 → **直接用 recharts@3**（設計書 §5.6「v3 證據不足」已推翻，不必退 v2 或 override react-is）。
- **Gemini-TTS**：`POST https://texttospeech.googleapis.com/v1/text:synthesize`，body `voice.modelName=gemini-2.5-flash-tts`＋`voice.name`（30 聲選 1）＋`voice.languageCode=cmn-TW`＋`audioConfig.audioEncoding`；認證 ADC Bearer＋**`x-goog-user-project: zonwiki-prod` header（Cloud TTS URL 無 project，user ADC 缺此 header 會 403；prod SA 帶了無害，一律帶）**。實打 cmn-TW 中英夾雜 HTTP 200、MP3 43KB/~15s。細節與 30 聲清單見 scratchpad/phase2-recon.md。
- **取捨**：cmn-TW 是 Preview 語言，PoC 音檔已存待使用者實聽定案；不過關退 Wavenet cmn-TW／Chirp3 cmn-CN。

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
## 2026-08-13 ｜換行體系重整：全域「Enter＝硬換行」＋表格 `<br>` 編輯視圖層（↳ 續行）＋直編對稱＋儲存格多 checkbox＋管線上色（feat/enter-hard-break-and-table-br-view）

### A. 全域「單一換行＝硬換行」（Notion 式）

- **背景**：使用者受夠兩套換行機制——行尾兩空白常忘記打（看起來沒換行超醜）、表格 `<br>` 有學習成本。裁示「渲染上本來就該換行」，既有筆記 reflow 視為修正、不需影響面掃描。
- **考慮過的選項**：①Shift+Enter 自動塞兩空白（不治本，一般 Enter 仍不換行）；②零寬字元標記（搜尋斷裂/隱形垃圾，否決）；③**【採用】改渲染規則**：後端 Markdig `UseSoftlineBreakAsHardlineBreak`＋前端三個 ReactMarkdown 點（MarkdownPreview／StickyBody／NodeContent）加 `remark-breaks`。
- **關鍵配套**：`CurrentRenderVersion` 2→3——ContentHtml 有 DB 快取，不 bump 舊筆記永遠舊渲染；收斂走既有 lazy 重渲染＋啟動一次性遷移。
- **部署注意**：①啟動遷移以 ExecuteUpdate 推進全部筆記 xmin → 部署瞬間跨版開著的編輯 session 會各吃一次 409（既知行為）；②全站 reflow 可能使 NoteOverlay「手繪筆跡」與舊版面錯位（文字錨點畫記不受影響——NoteMarksLayer 走 textAnchor 重錨）；③收斂完成前 GET 過時筆記走記憶體重渲染（短暫 CPU 稅）。
- **互通性取捨**：ZonWiki 內單換行＝換行，貼到「嚴格標準」渲染器（GitHub README、pandoc）會被接回同一行——與 GitHub 留言區／Obsidian／Notion 同陣營，使用者已知悉接受。

### B. 表格儲存格換行：`<br>` 儲存不變＋「編輯視圖層」展開（lib/tableBreakView.ts）

- **背景**：儲存格內換行只能寫 `<br>`，編輯頁一行拉到天邊、重開直編還看到字面 `<br>`。使用者要求編輯頁像多行表格（圖一），但接受「儲存維持 `<br>` 單行＝合法 GFM 跨平台互通」。
- **決定**：沿用 toggle 摺疊的「視圖層」先例——display 把真表格列內的正規形 `<br>` 展開成「換行＋對齊墊片＋`↳ `」，onChange 收斂回單行。分層：full →（表格展開）→ expanded →（摺疊）→ display；**映射順序先徽章、再 join**（對抗式復審 C-1，反了會讓局部排版切錯段）。
- **安全設計（對抗式復審全數採納）**：
  - 不變式 `collapse(expand(x))===x`；round-trip 驗證失敗（病態內容如字面 `↳` 行接在表格列後）＝**整個視圖層 per-instance 停用**（C-2：不只初始化，applyEdit/Shift+Enter/複製全關）。
  - 「真表格脈絡」才展開/收斂：區塊第 2 列須為分隔列；分隔列本身、散文含管線、圍欄內、CRLF 行一律不動（H-4/M-1）。
  - **斷行守門**：斷點前的首段必須仍是合法列且不像分隔列，否則該 `<br>` 維持字面（round-trip 保障）。
  - join 原子區手勢：墊片/標記區內打字→貼齊內容起點；Backspace/Delete→整段刪；選取編輯→範圍擴張覆蓋 join（H-2 防 `↳` 外漏入庫）。
  - 複製/剪下跨 join→剪貼簿放「收斂後完整文字」切片（座標映射、不用正則猜；H-1）；拖放含 join 樣式→擋下提示。
  - Shift+Enter／join 刪除優先走 `document.execCommand`（保留原生 undo；Ctrl+Z 已在真瀏覽器 E2E 驗證）；jsdom/舊瀏覽器退回 applyEdit。
  - 只認**正規形 `<br>`**（小寫無空白）：變體展開會被收斂正規化成幽靈 diff，維持字面。
- **直編對稱**：開儲存格編輯器時 `unescapeCellBr`（白名單共用 remarkHtmlLineBreak.BR_PATTERN，防第三份拷貝漂移）把 `<br>` 家族還原成真換行；「無變更」比較用還原後初值——變體格開了沒改不會被悄悄正規化存檔。
- **已知限制（文件化）**：行動裝置無 Shift+Enter（儲存格插換行僅桌機）；編輯中貼入字面 `<br>` 到下次載入才展開；墊片對齊是視覺寬 heuristic（CJK=2 欄，非等寬字型會偏）。

### C. 儲存格內多 checkbox（一格多待辦，像 OneNote）

- 讀模式（互動集中讀模式＝既有決策）：儲存格以 `<br>` 分段，段首字面 `[ ]`/`[x]` 由 DOM 端換成可點擊核取方塊；點第 k 個→`toggleCellCheckbox` 切 raw 第 k 個標記→既有 `saveCell` 寫回。
- **同構安全比對**：DOM 偵測數必須等於 raw 標記數（`\[ ]` 跳脫等會造成不同構）→ 不等＝整格放棄增強，寧可不互動、不可切錯。
- **`{checkbox}` 控件欄分流**（使用者實測回報後修正）：純 `[ ]`/`[x]`/空 格＝整格單一勾選（既有語意）；多段/帶標籤格（`[ ] 甲<br>[x] 乙`）＝多 checkbox 增強——原本「控件欄一律整格單勾」會把標籤文字整個吃掉只剩一顆空框。radio 欄維持不套用。

### D. 編輯頁表格管線 `|` 上色

- textarea 無法對單字元上色 → 疊「管線標示背景層」（同字體/排版鏡像、文字透明，僅真表格行的未跳脫 `|` 畫 `color-mix(--focus-ring)` 色塊；同 StickyBody 重點底圖先例）。textarea 文字/游標/IME 完全不受影響；寬度以 clientWidth 同步對齊自動換行、捲動同步 translateY。

---

## 2026-08-11 ｜編輯模式 toggle 摺疊：徽章視圖層（不換 CodeMirror）＋墓碑復活；手機閱讀：表格自然欄寬容器橫捲＋overflow-x 兜底（feat/edit-toggle-fold-and-mobile-reading）

### A. 編輯模式 toggle 摺疊（`:::toggle` 不用切預覽就能收合）

- **背景**：使用者撰寫長筆記時大量使用 `:::toggle`，但摺疊只在渲染後（預覽/閱讀）生效，編輯 textarea 裡整片攤開、捲動負擔大。要求「編輯模式下 toggle 也能折疊」。
- **考慮過的選項**：
  1. **換 CodeMirror 6**（原生 code folding）——正解但代價大：MarkdownEditor 的 textarea 被十多個呼叫端依賴（taRef 選取座標、貼圖、Tab、鏡像量測、彈出預覽定位…），全面遷移回歸面過大，且行動端/IME 行為要重新驗證。
  2. **分段塊狀編輯器**（toggle 段各自獨立 textarea）——破壞跨段選取/搜尋/AI 整篇重排，不採。
  3. **【採用】徽章視圖層**：textarea 顯示「display 文字」＝完整文字，但已摺疊區塊的「內文＋結尾 `:::`」被單行徽章（`` ⋯〔已摺疊 N 行 #gk7q〕``）取代；隱藏原文存 React state（`FoldRecord.hiddenText`）。
- **資料安全不變式（本功能的憲法）**：
  - `onChange`／存檔對外**永遠**送 `expandDisplay()` 後的完整文字——摺疊純屬視圖，徽章永不入 DB、隱藏內文永不缺席（round-trip 由 37 條單元測試鎖住，含 `$&` 替換陷阱、CRLF、巢狀、未閉合區塊）。
  - 每次編輯過驗證：徽章 1 份＝正常；**0 份＝整塊刪除**（紀錄進 graveyard，undo 徽章重現時自動「復活」——堵死「刪除→Ctrl+Z→孤兒徽章存進 DB」路徑，這是測試計畫對抗式審查抓到的 CRITICAL）；壞掉（id 殘片仍在）或 ≥2 份＝**拒絕該次編輯**（還原＋toast）。
  - 徽章 id 字母集**排除十六進位字元**（避免與內容中 `#a3f2` 色碼撞名誤判 damaged）。
  - 「會動到徽章」的輸入手勢一律**先自動展開**（點徽章、徽章內打字、緊鄰 Backspace/Delete、選取跨徽章）——使用者永遠不會被拒絕迴圈纏住。
- **座標系鐵律**：textarea 選取座標＝display 座標。編輯器內部全部操作 display；**外部**要用選取座標切完整內容者（NoteAiActions 局部排版）必須經 `foldApiRef.mapSelectionToFull()` 映射，映射不到（跨徽章）就擋下——否則會重排錯段＝靜默毀損。
- **外部變更語意**：value prop ≠ 最後一次自家發出的完整文字 → 視為外部變更（AI 重排、預覽勾 checkbox 等）→ 重設摺疊（全展開）。取捨：AI 重排後要重新摺，換取「徽章絕不對到錯誤內容」。
- **已知限制**：textarea 原生 undo 在程式化改值（摺疊/展開）後會重置（既有工具列行為相同）；IME 正常組字不受影響（拒絕路徑只在破壞徽章時觸發）。

### B. 手機閱讀優化（iPhone 393px；使用者「電腦編輯、手機閱讀」）

- **背景（實測盤點）**：①閱讀頁可左右橫移——根因＝`.note-detail-page` 因 `overflow-y:auto` 使 overflow-x 計算成 auto，而置頂工具列 6 顆 `flexShrink:0` 按鈕最小寬 ~700px、長網址無斷行把它撐寬；②表格難讀——全域 `table{width:100%}` 在 393px 把六欄表擠成「一行一字」直式排版（截圖存證），且桌機拖的像素欄寬會以 `table-layout:fixed` 無條件還原；③浮動繪圖工具列蓋掉下方 1/3 螢幕。
- **決定**：
  - **溢出兜底**：`body` 與 `.note-detail-page` 皆 `overflow-x: clip`（clip 不產生捲動容器、iOS 對 body hidden 的歷史怪癖也繞開）；過寬內容一律由各自捲動容器（`.md-table-wrap`、`pre`）承接。**此後任何元素都不准把頁面撐寬**。
  - **表格策略＝「容器內橫捲」而非「壓縮欄寬」**：≤768px 時 `.md-table-wrap table { width:max-content; min-width:100% }`＋儲存格 `min-width:4em`、表頭 nowrap；未包 wrapper 的表（JS 前瞬間/編輯預覽）以 `display:block; overflow-x:auto` fallback。**不採**卡片化堆疊（互動表格的 radio/checkbox/排序/篩選語意在卡片化下全要重做）。
  - **欄寬記憶在窄視口（<768px）不還原**、**純觸控裝置不掛拖寬把手**（touch-action:none 的把手會把捲表格劫持成拉欄寬並永久寫入 localStorage）；記憶保留、回桌機照常還原。
  - **觸控不綁「雙右鍵直編」**（觸控打不出右鍵，綁了只會因 preventDefault 吃掉 iOS 長按選字）。
  - 置頂工具列 ≤768px 改「可換行＋不 sticky」（多行 sticky 會吃掉 1/3 可讀高度）；繪圖工具列手機**預設收合**；Header 搜尋框樣式自 inline 移到 CSS（inline 蓋掉 640px 斷點是既有失效原因）；長網址/行內 code `overflow-wrap:anywhere`；`100dvh` 取代 `100vh`（iOS 工具列高度）。
- **驗證**：Playwright iPhone 視口實測——修復前後對照截圖存 tmp/playwright/edit-fold-mobile/；修復後全站四頁 doc.scrollWidth=393、表格橫排可讀。真機（iOS Safari）最終確認由使用者進行。

---

## 2026-08-08 ｜讀模式互動表格（表頭宣告控件）＋儲存格/程式碼區塊直編；移除 GenericAttributes（修 stored XSS）＋渲染版本 lazy 自癒（feature/interactive-tables）

- **背景**：使用者要（104 職缺追蹤筆記）表格支援 RadioBox/CheckBox 且**非編輯模式**滑鼠直接勾選、欄排序、欄篩選、雙右鍵直編儲存格、禁用預設右鍵、程式碼區塊雙右鍵直編＋右上 💾、全部進 NoteRevision 歷史；並明點「畫記/便利貼在篩選（要跟著看不到）與排序（要跟著移動）下不可出 bug」。
- **語法決策**：**表頭宣告控件、儲存格只存純文字**——`狀態{radio:未看,考慮中,…}`／`已讀{checkbox}`，儲存格存目前值／`[x]`。100% 合法 GFM、舊筆記零影響、原文人眼可讀。放棄「行內標記語法」選項（會污染儲存格內容與編輯體驗）。
- **對抗式設計審查的兩個實測翻案**：①Markdig `UseAdvancedExtensions()` 內含 GenericAttributes，會把表頭 `{checkbox}` 吃成 `<table>` 的屬性（語法立足點被推翻）；②同機制構成**既有 stored XSS**（`{onclick=alert(1)}` 渲染成真屬性，DisableHtml 擋不住屬性語法）。**最終決定：從 pipeline 移除 GenericAttributesExtension**——一石二鳥（`{…}` 存活為字面文字＝與編輯預覽 remark-gfm 行為一致；XSS 關死）。取捨：放棄 `{.class}` 等屬性語法（本站從未文件化使用）。
- **DOM↔原文對應**：沿 `data-fence-line` 先例（RenderToHtml 的 AST 後處理，**非** IMarkdownExtension），後端對每個表格列吐 `data-md-line`（TableRow.Line+1）、表吐 `data-md-table`；前端以「後端行號＋欄索引」定位改寫，行內欄位切分（`\|` 轉義、blockquote 前綴、CRLF）為良定義純函數。嚴禁前端逐行正則近似 CommonMark（既有鐵律）。
- **存量筆記自癒**：ContentHtml 是寫入時渲染存 DB——舊筆記沒有新屬性（且殘留 GenericAttributes 產物）。加 `Note_RenderVersion`＋`CurrentRenderVersion=2` 常數，GET 單篇時版本落後→從 ContentRaw 重渲染（見下一條的最終形態）。
- **自癒實作的兩次實查翻案（最終＝GET 純記憶體＋啟動一次性收斂）**：
  1. 規格原寫「GET 時重算並以 SaveChanges 回存；ContentHtml 屬 ActivityLog 排除欄→不記活動」——**實查為誤**：排除清單（ActivityLogInterceptor.cs:853）只作用於變更摘要 Detail，判定要不要記 updated 的 `ClassifyAction`（同檔 606-610）把 ContentHtml 也算實質變更→走 SaveChanges 會**多記一筆假活動**；且 AuditingSaveChangesInterceptor（:65）對 Modified 一律推 UpdatedDateTime→舊筆記一被打開就跳到「最近更新」頂端。初版因此改走 /opened 先例的 ExecuteUpdate＋回讀 fresh xmin。
  2. **對抗式復審 HIGH-1 再翻案（實測重現）**：ExecuteUpdate 版仍會推進 xmin——「另一個在自癒前就載入筆記」的 session（別的分頁/裝置/MCP）手上的 baseVersion 立刻過期、存檔撞**跨 session 假 409**（回讀 fresh xmin 只救得了發出 GET 的那個 session）。**最終決定：讀取層純記憶體**——GET 過時筆記只在「回應中」用重算的 ContentHtml，**絕不寫 DB**（讀取不可改變併發權杖）；**收斂層＝NoteRenderMigrationService**（啟動、MigrateAsync 之後背景一次性掃描：IgnoreQueryFilters 跨全使用者、限 ValidFlag、逐筆 ExecuteUpdate＋guard `RenderVersion < Current`、每筆 Information log 存證、單筆失敗 Warning 續走不中斷）。明文接受：收斂那一刻會動 xmin，部署當下跨版開著的編輯 session 可能吃到一次 409（重整即復原），與 schema migration 同級的一次性成本。三個「不」（不產 Revision、不記活動、不動 UpdatedDateTime）、「GET 完全不落 DB」、「跨 session 假 409 已消」皆有整合測試鎖住（NoteRenderVersionHttpTests）。ExecuteUpdate 禁區不變：嚴禁改 Title/ContentRaw（NoteRevisionInterceptor 註解已更新列出兩個合法使用處：/opened 與收斂服務）。
- **一併移除 GridTableExtension（復審 HIGH-2，實測重現）**：grid table（`+---+` 語法）的「一列」可跨多個原始行，「列行號＋欄索引→改寫 ContentRaw」座標系對它不成立，卻會被 AST 後處理照樣標上 data-md-table/data-md-line→前端直編會改寫到錯誤的行（跨行資料損毀）；且編輯預覽 remark-gfm 本來就不支援 grid table。與 GenericAttributes 同手法自管線移除，grid 語法退回字面文字（回歸測試 GridTableRemovalTests 鎖住）。
- **錨定安全（畫記/浮層）**：篩選＝**只用 CSS `display:none`**（textContent/Range 座標不變→畫記不斷錨、浮層錨點 rects 空→自然隱藏）；排序＝**搬移既有 tr 節點**（畫記 `[data-anno]` 包裹跟著列走）。排序/篩選作用中 table 標 `data-zw-view-altered`：NoteMarksLayer「標失效」回寫**延後**（復活照常放行——復活永遠安全）、**暫停新建標註**（此刻座標會以重排後位置入庫、永久錯位）；變動後派發 `zonwiki:layout-changed` 讓浮層立即 rebase。已知取捨：rebase 會持久化座標（多裝置間座標乒乓、自癒無損毀）；塗鴉跨列長筆畫仍整體平移。
- **寫回管線**：三種讀模式編輯（程式碼 meta／圍欄內文／表格儲存格）統一走 `applyReadingEdit`——draft（appliedTo/result）基準防過期覆寫＋樂觀鎖 `baseVersion`（409 專屬提示）＋失敗棄 draft；文字直編**不做樂觀 DOM 替換**（textarea 保留至成功，失敗不摧毀輸入），chip/checkbox 為值級樂觀更新＋失敗還原。
- **右鍵語意**：抑制範圍限縮在「互動表格＋可直編程式碼區塊」內（單次右鍵也抑制，與 2026-08-06 已測試釘死的取捨一致）；豁免編輯中 textarea（保留原生貼上）；`e.defaultPrevented`（NoteOverlay 繪圖取消先吃掉的那下）不計入雙擊。
- **檢視狀態**：localStorage `zonwiki:tableView:v1`，鍵＝noteId:表序號＋「剝尾碼表頭簽章」雙保險（照欄寬先例）；排序指示/漏斗 icon 一律 CSS pseudo-element（不進 th.textContent，否則簽章與欄寬比對被污染）；還原只在表格首次增強時執行一次，MutationObserver 回呼絕不主動套狀態。副作用：表頭顯示文字改變使既有欄寬紀錄一次性失效（可接受）。

---

## 2026-08-06 ｜答題彈窗回答預設預覽＋雙右鍵切編輯；「彈出預覽」以 Document PiP 實現置頂（feature/qa-answer-preview-mode）

- **背景**：使用者要求（便利貼／T 文字框「?」的回答）①打開彈窗時回答區預設是「預覽」、預覽中快速點兩下右鍵切回編輯、關閉瀏覽器預設右鍵選單；②「彈出預覽視窗要置頂，不要被其他視窗蓋掉」。
- **需求②的解讀**：「彈出預覽」精準對應編輯器既有的「⬈ 彈出預覽」功能（window.open 獨立視窗，一點回主視窗就被蓋到後面）；答題彈窗本身（z 2000+）在頁內幾乎不會被其他面板蓋住。故解讀為「該獨立視窗要 OS 層級置頂」。（若使用者實指頁內 z-index 疊放，另案處理。）
- **考慮過的選項（置頂手段）**：(a) `window.open`——Web 無任何 API 能讓一般視窗 always-on-top，做不到；(b) 調高答題彈窗頁內 z-index——只解頁內疊放、離開瀏覽器仍會被蓋，且與解讀不符；(c) **Document Picture-in-Picture（採用）**——Chromium 系提供的「永遠置頂」視窗，Web 唯一正解；不支援的瀏覽器（Firefox/Safari）自動退回既有 window.open，按鈕文案同步降級（不假承諾「置頂」）。
- **實作**：`MarkdownEditor` 新增三個可選 props（預設值＝既有行為，12 個既有呼叫端零回歸）：`defaultView`（答題彈窗傳 "preview"）、`rightClickTogglesEdit`（僅「預覽」檢視的預覽窗格：一律 preventDefault contextmenu；兩次右鍵間隔 ≤500ms（pin 在 `Date.now()`，測試以 spy 控制）切回編輯；split/編輯檢視維持原生右鍵）、`popoutAlwaysOnTop`（PiP 路徑：requestWindow → 複製主文件樣式表＋`data-theme` → React portal 把 ToggleAwareMarkdown 渲染進 PiP 文件（吃 live state，不需 BroadcastChannel）→ pagehide 恢復內嵌預覽；主題切換以 MutationObserver 即時同步）。僅 `QuestionAnswerPopup` 啟用三者（範圍紀律；筆記編輯頁等其他呼叫端不變）。
- **已知限制（明文接受）**：PiP 僅 Chromium；同分頁同時只能有一個 PiP（開第二個會擠掉第一個，靠 pagehide 恢復第一個的狀態，按鈕 title 有註明）；PiP 內右鍵維持「定位來源行」語意（與舊 popout 對等）；「置頂」本身是視窗管理器行為、自動化測不到，以「PiP 視窗存在＋內容渲染」為代理驗證。
- **對抗式復審後補強（4 HIGH）**：①PiP 請求 pending 期間彈窗被關（元件卸載）→ resolve 後直接 close、不留「使用者關不掉的孤兒置頂視窗」（unmountedRef，StrictMode 下 setup 時要重設）；②彈出鈕連點 → in-flight 旗標防併發雙視窗；③PiP 失敗 fallback 的 `window.open` 在非同步 catch 內易被彈窗攔截器擋 → 回傳 null 時 toast 告知且**不**進入彈出狀態（修掉既有「假態」隱患）；④不支援 PiP 時按鈕文案不承諾置頂。
- **驗證**：TDD（單元 RED→GREEN，MarkdownEditor 18 條＋QuestionAnswerPopup 2 條，全站 78/78）＋Playwright E2E 8/8（預設預覽、雙右鍵切換＋defaultPrevented、>500ms 不切、T 文字框同款、PiP 開/收、暗主題＋PiP 主題複製、375px、console 零錯誤）；截圖存 zonwiki-ui-tests/2026-08-06-qa-answer-preview/。測試環境教訓：vitest 3 預設 fake 全組計時 API（會誤傷 rAF 與輪詢 interval）→ 雙右鍵間隔用 `vi.spyOn(Date,'now')` 而非 fake timers；jsdom 沒有 BroadcastChannel（能動是 Node 全域殘留）→ 顯式 stubGlobal；React 19 portal 可渲染進 `createHTMLDocument` 的 body（跨文件事件委派正常）。

---

## 2026-07-31 ｜問題清單定位改「循著階層展開」＋定位不關面板＋便利貼答鈕（fix/question-list-ux）

- **背景**：使用者回報三個問題：①筆記頁點「問題清單」面板列項目後，面板會被自動關閉（連續定位多個問題要一直重開）；②問題（便利貼）的錨定文字位於收合的 :::toggle 內時，點定位完全沒反應——因為被收合隱藏的浮層項目**整個不會渲染**（collapsedByToggle 過濾），scrollToOverlayItem 的重試迴圈找不到 DOM 而靜默失敗，應比照「目錄」先循著階層展開；③便利貼有 ❓ 可標記問題、T 文字框有「答」鈕，但便利貼本體沒有「答」鈕（只能從問題清單開答題彈窗）。
- **考慮過的選項（②的修法）**：(a) 被收合的項目改成「照渲染但隱藏」讓定位找得到——會破壞既有「跟著 toggle 收合」的整套語意與效能假設；(b) **定位前先展開錨定文字的收合祖先 details（採用）**——與目錄 TocPanel.scrollToHeading 同一行為模式，展開觸發既有 toggle→recompute 鏈路，項目自然恢復渲染，scrollToOverlayItem 的重試機制無縫接手。
- **實作**：`overlayAnchor.ts` 新增 `openAncestorDetails`（祖先鏈展開、止步 container、旁支不動）與 `revealAnchor`（reAnchor 文字重定位→展開；**刻意純 DOM 判定、零幾何量測**，jsdom 可測）。`NoteOverlay.handleLocateQuestion` 定位前先 reveal（釘住者不做；舊資料走 stickyAnchorRef 元素回退；錨文字被編輯掉時 reveal 失敗**仍照常定位**——此時項目以絕對座標渲染、永遠可見）。
- **連帶範圍決策（計畫復審 HIGH）**：`?overlay=` 深連結（全域問題清單頁/搜尋跳轉）有同樣症狀，且 page.tsx 拿不到浮層錨點資料無從展開——**深連結定位改由 NoteOverlay 承接**（新 prop `locateOverlayId`＋等 itemsLoaded、短輪詢錨定文字出現再定位），page.tsx 移除舊的 scrollToOverlayItem effect。行為差異：舊版 previewHtml 每次變動都重新定位、新版每個 overlayId 只定位一次（使用者捲走後不會被拉回去，視為改善）。
- **測試基礎設施決策**：vitest 設定（package.json test script／vitest.config.mts／jsdom）在 main 尚不存在、只存在於未合併的 feature/backlinks-union——本分支**自帶一份同構設定**（版本/內容對齊，另補 `resolve.alias` 的 @→src 對應），日後兩分支合併時內容相同、無痛去重。jsdom 用 **26**（30 的相依 html-encoding-sniffer@6 是純 ESM，Node 20.12 的 CJS require 會炸）。
- **驗證**：TDD——單元 9 條（reveal/展開邊界，先 RED 後 GREEN）＋Playwright E2E 11 場景（面板不關、雙層展開、深連結、錨點失效兜底、答鈕含 pinned/已答上色、✕ 回歸、亮暗截圖、console 零錯誤）對未修復基線 8/11 紅、修復後 11/11 綠；截圖存 zonwiki-ui-tests/2026-07-31-question-list-ux/。
- **對抗式復審後補強**：①（HIGH）補 Testing Library 元件測試鎖住面板契約（點列項目只觸發 onLocate、絕不觸發 onClose）；②（MEDIUM）深連結單次防護的正確性依賴「page.tsx loading 閘門換筆記時整棵卸載」——已在 handledLocateIdRef 旁註解文件化；③（視覺稽核實測）答鈕原用 --text-tertiary 在暗主題的淺黃便利貼標題列上對比僅 2.75 → 改「膠囊」樣式（未答白底深字 20.5:1／已答主色底白字 4.63–9.25，四主題全 ≥AA），且問題便利貼縮放下限 120→150（五顆鈕在 120px 會溢出裁切；API 舊資料若仍 <150 僅輕微裁切、拖寬即復原）。

---

## 2026-07-30（第三批）｜浮層錨點「行級細化」：跨螢幕寬度跟著文字走（feature/note-revision-interceptor）

- **背景**：使用者回報「不同螢幕尺寸下畫筆等顯示位置會不同」。實查發現既有 overlayAnchor 機制（2026-07-08 為解 toggle 收合位移而建）已把浮層/筆畫錨定到文字並以 rebase 平移跟隨——但錨定粒度是**元素級**（錨在段落開頭）：容器寬度改變時段落左上角幾乎不動（rebase 差量≈0），段內文字卻全部重新折行，畫在第 N 行的東西便對不上原本的字。
- **考慮過的選項**：①版心固定寬（根治但整站閱讀版面大改，UX 代價高）；②整層等比縮放（垂直折行是離散的，縮放補不了）；③**錨定粒度細化到「行級」（採用）**——rebase 機制不動，只把錨點從「段落開頭」細到「點所在那一行的行首字元」，折行後 reAnchor 找到那行文字的新位置，差量即文字位移，浮層自然跟著字走；不動任何版面。
- **實作**（只改 `frontend/src/lib/overlayAnchor.ts` 的 `computeAnchorAt`）：新增 `refineStartOffsetToLine`——在 elementsFromPoint 選出的內容元素內：走訪文字節點蒐集逐行矩形（`Range.getClientRects`＝每個 line box 一個）→ 取垂直距離點最近的行 → 節點內**二分搜尋**「第一個落在該行」的字元位移（collapsed Range 的 top 對 ltr 節點內位移單調不減）→ 轉容器純文字位移。錨定文字改從容器純文字切 64 字。細化失敗（空白/無文字）退回元素級；**刻意不用 `caretRangeFromPoint`**——它以最上層元素 hit-test，點被浮層/繪圖 SVG 蓋住時打不到內容，而既有 elementsFromPoint 過濾鏈能穿透。
- **相容性**：錨點資料格式不變（text/start/prefix/suffix/ex/ey），舊的元素級錨點照常運作；重畫/拖曳一次即升級為行級。塗鴉筆畫共用同一 computeAnchorAt，同步受益（跨多行的長筆畫仍是剛體平移，屬已知殘餘限制）。
- **驗證**：Playwright E2E 實測——長段落（互不重複句子，防 reAnchor 消歧義失真）拖便利貼到段中某行，視窗 1300→720 折行後：**錨定文字位移 48.0px、便利貼位移 48.0px 完全一致**，rebase 座標正確持久化，console 零錯誤。教訓：測試素材用重複句子會讓錨定文字多處出現、量測與消歧義雙雙失真。

---

## 2026-07-30（第二批）｜歷史分頁合併時間軸＋浮層手動快照＋關聯活動攝影（feature/note-revision-interceptor）

- **背景**：使用者續提三需求：①筆記「歷史」分頁要看得到完整相關變更（活動紀錄頁有記不夠，歷史分頁也要）；②便利貼/T 文字框/畫筆不受版本保護要補，但**不要自動記錄**（筆數會爆炸）——右下角工具列加「儲存」鈕、按了才記一筆；③畫筆跨螢幕尺寸漂移只要解法分析（未動工，見對話紀錄）。
- **關鍵發現（測試計畫審查抓到的 CRITICAL）**：「筆記↔任務」關聯有**兩套並行系統**——通用 `EntityLink`（/api/links，關聯列 UI）與專用 `NoteTaskLink`（/api/notes/{id}/tasks，任務關聯管理 UI）——只攔一套會讓「歷史看得到關聯」落空。**兩套都納入活動攝影**。第三套「畫記關聯」（NoteMark kind=link）屬內文標註體系，刻意不記（範圍決策）。
- **實作**：
  1. `ActivityLogInterceptor` 新增關聯攝影：EntityLink/NoteTaskLink 的建立（含復活）/軟刪 → 兩端（限 note/taskcard，有歷史檢視者）各記一筆 updated，Detail=「建立關聯／移除關聯：{型別}「{對端標題}」」；對端標題批次補查（task/subtask/node，sync/async 雙路徑）。
  2. `GET /api/notes/{id}/activities`：單一筆記維度活動查詢（倒序、上限 200 筆——超過會靜默截斷最舊，已知取捨）。
  3. `NoteOverlaySnapshot` 新表（(NoteId,SnapshotNo) 唯一）＋ `POST/GET /api/notes/{id}/overlay/snapshots`：**伺服器端**讀當下 NoteOverlayItem＋NoteMark 序列化保存（不信任 client payload）；**刻意不去重**（按下儲存＝明確存檔意圖，與 NoteRevision 的同值不寫相反，測試鎖住防後人「順手」加去重）；**不註冊 TrashTypeRegistry**（快照不可由使用者刪除——稽核價值）；**無還原端點**（本階段救援走 DB 人工，同軟刪救援流程）。
  4. 前端：歷史分頁合併三來源時間軸（版本卡片＋活動細列＋浮層快照細列；created/deleted 與純標題/內容 updated 活動因與版本卡片重複而隱藏——用整串正則判定，split('；') 會被含全形分號的標題值打爆）；工具列 Row1 常駐「💾 儲存」鈕（DrawingToolbar 新增 persistentControls 插槽，不動 extraControls 的條件渲染語意）。
- **必記眉角**：
  1. **孤兒附件掃描器已擴充** `NoteOverlaySnapshot.ItemsJson`——任何新的「存內容 JSON/Markdown 的欄位」都必須同步擴掃描器（既有不變式，測試鎖住）。
  2. 攔截器的標題補查用 IgnoreQueryFilters（軟刪對端也要有標題）但**顯式保留 UserId 隔離**——防未來新增關聯路徑漏做擁有權驗證時跨租戶洩漏標題（對抗復審 HIGH）。
  3. 快照儲存前前端會等待飛行中的位置 PATCH 落地（上限 2 秒；逾時照存但顯示「未含拖曳中變更」）。
  4. 已知未修（現況不可觸發，留紀錄）：同一 SaveChanges 內「筆記欄位變更＋關聯變更」會產生兩筆分開的 updated 活動（現行程式碼關聯永遠獨立儲存，不會發生）；活動端點 200 筆截斷無 hasMore。
- **驗證**：TDD——14 條新整合測試（真 Postgres，含並發雙擊快照、不可變快照、使用者隔離雙重驗證、孤兒掃描器快照引用）先 RED（12 敗）後 GREEN；全套零回歸；對抗復審（後端 1 HIGH＋前端 2 HIGH 全修）；本機部署＋Playwright 實測。

---

## 2026-07-30 ｜筆記版本快照改為 EF 攔截器唯一寫入點（feature/note-revision-interceptor）

- **背景**：使用者發現「從任務建立並連結筆記」（`POST /api/links/note-from`）建立的筆記完全沒有版本快照，並裁示：「任何方式改變了筆記的內容，都要被保存成一個版本，不論是建立還是修改皆是」——系統仍在測試階段、可能有未知的覆寫問題，完整版本紀錄是防止重要筆記遺失的最後防線。
- **考慮過的選項**：①逐點補漏（在 note-from 加上顯式寫入）——但原本 8 個顯式寫入點就是這樣長出來的，未來新端點還是會忘；②**EF `SaveChangesInterceptor` 唯一寫入點（採用）**——防線設在所有寫入的唯一瓶頸（SaveChanges），任何現在與未來的路徑（端點/背景服務/MCP）自動涵蓋。
- **最終決定**：新增 `NoteRevisionInterceptor`（仿既有 `ActivityLogInterceptor` 前例）：Added→create、Title/ContentRaw 確有變更→update、ValidFlag true→false→delete（保留刪除當下全文快照）；還原（false→true）、純中繼資料變更（分類/標籤/草稿旗標）、同值重送**不寫**（消除噪音版本——舊行為是每次 PUT 都寫一版，即使只改分類）。移除全部 8 個顯式寫入點。
- **關鍵眉角（都有測試鎖住）**：
  1. **攔截器順序與自行蓋章**：必須註冊在 `AuditingSaveChangesInterceptor` 之後，且快照列的 Id/時間/使用者欄位全部自行設定——稽核攔截器先跑、不會回頭補章，漏蓋會存出 0001-01-01。
  2. **取號無視查詢過濾器**：(NoteId, RevisionNo) 唯一索引不分 ValidFlag；舊程式取號只看有效列，版本列一旦被軟刪（垃圾桶），下一次存檔就撞唯一索引整批 500（潛在 bug，本次一併修掉）。
  3. **併發衝突統一 409**：兩個併發請求對同一筆記取到同一序號時，敗方撞唯一索引丟的是 `DbUpdateException`（23505）而非併發例外→裸 500。於 `ZonWikiDbContext.SaveChanges` 集中將「該唯一索引的 23505」轉譯為 `DbUpdateConcurrencyException`，各端點既有 409 處理一體適用。
  4. **快照歸屬取 note.UserId**：背景服務（AI 精煉/框選提問）無 HTTP 脈絡、CurrentUserId 為空，快照仍須歸屬筆記擁有者，否則查詢過濾器會讓歷史隱形。
  5. **⚠️ 結構性禁令**：`ExecuteUpdate/ExecuteDelete` 不走 SaveChanges、不觸發攔截器——日後嚴禁用它改 Title/ContentRaw（目前唯一使用處是 LastOpenedDateTime，無內容變更、安全）。
- **行為變更**：純分類/標籤/草稿旗標變更不再產生版本（舊行為每次 PUT 必寫一版噪音）。內容未變＝快照與上一版完全相同＝無資料損失，且歷史更乾淨、真正的救援點不被淹沒。
- **驗證**：TDD——14 條新整合測試（真 Postgres + 真 HTTP，含真併發 Task.WhenAll 實測）先 RED（6 敗證明漏洞存在）後 GREEN；全套測試零回歸；本機部署（新 build 換掉 3000 實例）＋Playwright 實測（亮暗×1280/375、console 零錯誤）。
- **同批 UI**：筆記頁查看模式 header 下方常駐顯示「分類：/標籤：」兩列（📁 完整路徑 chip 可點往分類清單、🏷 標籤；空狀態顯示「未分類/無標籤」；超長名稱 240px 截斷＋title 提示完整文字）。
- **對抗式復審修正（1 HIGH 後端＋1 HIGH 前端已修）**：
  - 【HIGH·後端】DeleteNoteHandler 原本沒接 `DbUpdateConcurrencyException`，併發刪除的敗方會把 409 轉譯又吞成裸 500 → 補 catch＋併發 DELETE 整合測試（敗方允許 409 或 404、絕不 500、不留孤兒快照）。
  - 【HIGH·前端】`note.categories` 實際是後端 `TagRefDto{id,name}`、**沒有 parentId**（前端型別宣告與 API 契約不一致的既有技術債），直接用 `c.parentId` 組完整路徑 100% 失效 → 改以 SWR 分類選項池（含 parentId）反查組路徑，池未載入前退回葉名。
  - 【MEDIUM】chip 加 240px 截斷防 375px 爆版；分類 chip 補 hover 態。已知既有技術債（不擋合併）：`LinkedEntitiesBar` 的 chip 同樣缺 hover 態；分類/標籤名稱後端無長度上限。

---

## 2026-07-17 ｜/time 獨立時間儀表板頁：無外殼、加 iPhone 主畫面即點即看（feature/time-dashboard）

- **背景**：Scriptable 小工具是被動快照（iOS 自行排程刷新、點列要跳去捷徑），使用者提出：「反正都要點一下才看得到全貌，不如做一頁**專屬統計頁**——無任何站內導覽、加到主畫面點開即看、之後圖表與操作可自由自訂，不被小工具框架綁死」。
- **考慮過的選項**：①繼續強化 Scriptable widget（受 iOS 硬限制：非即時、互動要跳捷徑）；②原生 App（成本完全不成比例）；③**站內獨立極簡頁（kiosk 模式，採用）**——與小工具互補：widget 管「不點就瞄一眼」，此頁管「點一下看全貌＋操作」。
- **作法**：`/time` 頁直接吃既有 `GET /api/time-entries/summary?scope=day|week`（與 iOS 小工具同端點、同「帳號時區」歸日週口徑）；隱藏外殼沿用既有 `data-route` CSS 慣例（比照 home/canvas/trash），另在 `<head>` 加 `routeInitScript` 讓 `data-route` 於**首次 paint 前**就定案（原本 RouteAttr 是 useEffect，冷載入會閃一下標題列；此改良全站無殼路由都受益）。進行中秒數＝後端快照＋前端補算（now−fetchedAt），聚焦/切回分頁/每 60 秒自動更新。
- **刻意不加 standalone PWA meta**（`apple-mobile-web-app-capable`）：standalone 視窗有**獨立 cookie 空間**，而登入頁登入後一律導回 `/`、`/time` 又無站內入口，會把使用者困在首頁出不來。以一般 Safari 分頁開啟＝共用既有登入態、零摩擦。日後要「更像 App」需先做登入 returnTo 回跳，再回頭開 standalone。
- **對抗式復審修正（2 HIGH 全修）**：【HIGH】全域快捷鍵洩漏導覽——本頁無輸入框，實體鍵盤誤觸 h/t/q/n 會被靜默導走 → `ShortcutRuntime` 對 `/time` 停用除 cycleTheme 外的全域快捷鍵；【HIGH】切「今日/本週」顯示舊範圍資料＋快速連切競態 → 請求世代號（只採納最新回應）＋切換時以載入骨架蓋住舊資料；【MEDIUM】偏好「本週」者開頁多打一次 day API → scope 以 null 起始、偏好還原後才首抓；【MEDIUM】ConfirmProvider 全站單例、兩顆結束鈕重疊呼叫會吞掉第一個確認 → 結束流程（含確認框等待期）鎖住全部結束鈕；【MEDIUM】長分類（可到 128 字）chip 溢出撐爆 375px → max-width＋ellipsis。「結束」加確認框與首頁面板「點即停」**刻意不同**：儀表板是快速瀏覽情境更怕手滑、且結束不可逆（不能清回進行中），面板屬主要工作流維持零摩擦。
- **驗證**：對比度 4 主題×22 組配對全過 WCAG AA（contrast-check 實測）；tsc／eslint（新檔零錯，ShortcutRuntime 既有 2 條 react-hooks/refs 為 main 上原有噪音未動）；Playwright E2E（亮暗×375/1280、無外殼、頁面零連結、按 h 不被導走、結束流程含確認框並即時消失、60 字分類無橫捲、console 僅首頁面板既有噪音）。

**第二輪擴充（同分支，同日）：行程（行事曆）＋三種圖表**

- **行程區塊**：以彙總回傳的同一組 `[from,to)` 打既有 `GET /api/calendar`（口徑與統計一致）；日檢視平鋪、週檢視依帳號時區歸日分組；可直接勾完成（`updateTaskCard` 不帶 baseVersion＝last-write-wins，**比照任務頁「快速欄位更新」既有慣例**）；逾期＝紅字時刻＋紅框 chip。**重複規則任務勾完成只影響該張卡、不停止未來具現化**（實查 `RecurringTaskMaterializationService` 只看 RecurrenceRule 不看 Status，與全站語意一致）。
- **圖表（使用者指定要長條/折線/圓餅）**：純 SVG 自繪、不引圖表函式庫（輕量＋可自訂＝本頁存在理由）。長條＝時段分布（日:24 小時格／週:7 日格，`[from,to)` 均分、逐筆重疊秒數累加、進行中隨秒跳動）；折線＝累積走勢；甜甜圈＝分類占比（**前 4 大＋其他**——dataviz 參考色盤前 4 槽是全對 CVD 驗證通過的上限）。色盤以 dataviz skill 驗證器對四主題實際表面實測（亮組/暗組各自選階非反轉）；亮主題第 3/4 槽對比 <3:1 → 以「依分類」清單（色點＋名稱＋數值）兼任圖例與表格視圖補償。
- **⚠️ lightningcss 搖樹陷阱（位元組級實測＋prod build 複驗）**：只被 React inline style／SVG 引用的 CSS 自訂屬性（`--viz-*`）會被建置器整段移除（它看不到 CSS 外的 var() 引用）→ globals.css 需保留 `.time-dash-viz-anchor` 錨定規則（在 CSS 內引用每個變數）。**日後任何「CSS 變數只給 JS/inline 用」的場景都要錨定**。
- **兩輪對抗式復審全修**：行程輪【HIGH】跨界任務（重疊語意回傳）用範圍外日期分組會冒出上週標頭→錨點優先取範圍內時間、範圍外夾回邊界；【M】背景 reload 蓋掉剛勾的完成→勾選飛行中跳過行程覆寫；【M】錯誤文案不寫「重試」（重試鈕只重讀不重送）；【M】tz 未載入前不分組（先骨架）。圖表輪【HIGH】entries 失敗靜默消失→就地「圖表讀取失敗」；【HIGH】折線終點標籤改用圖表自身累積值（後端彙總不裁切跨午夜時長、圖表有裁切，兩口徑跨午夜項目會不同——記為已知語意差異，後端裁切另案評估）；【HIGH】手機無 hover 讀不到逐格 tooltip→補常駐「尖峰」摘要行；【M】使用者分類撞名「其他」→甜甜圈 key 加 index。已知未修（記錄）：進行中分類即時秒數可能短暫超車第 4 名但色槽不重排（60 秒窗口）；chartBins 未 useMemo（現量級可忽略）；DST 週均分格逐格累積漂移（無 DST 時區不受影響）。

---

## 2026-07-16 ｜時間追蹤 Phase 2/3：備註＋既有項目/彙總端點＋iOS 捷徑×Scriptable 小工具（feature/time-tracking-widgets）

- **背景**：使用者要在 iPhone 主畫面（不開網頁）完成 4 個場景：①開始（新增 or 選既有＋可選備註）②結束（看進行中清單挑一個、防手誤）③今日統計（做了哪些、各花多少、進行中、依分類）④本週統計。承接已合併的時間追蹤 v1（PR #43）。完整設計見 [docs/design/時間追蹤-設計與測試計畫.md](./design/時間追蹤-設計與測試計畫.md) §7.11、教學見 [docs/iOS捷徑-時間追蹤.md](./iOS捷徑-時間追蹤.md)。
- **後端**：TimeEntry 加 `Note`（可空 max 1000，migration `AddTimeEntryNote`）；新增 `GET /recent-items`（歷史 distinct 名稱+分類、最近在前）、`GET /summary?scope=day|week`（依使用者時區歸日/週、進行中即時併入）、`GET /{id}`（單筆，供確認捷徑查名）。**決策：不做正式範本表**（YAGNI，動態撈 distinct）。
- **防手誤走「二次確認」不做 30 秒待定狀態機**（使用者裁示）：小工具點列→跳捷徑確認框→確定才結束；狀態機要放後端且 widget 快照回饋有延遲，不划算。
- **iOS 兩條路**：捷徑（觸發動作，打 HTTP API）＋ Scriptable（被動顯示 widget，因 Apple 捷徑 widget 只顯示按鈕不顯示資料）。腳本 [docs/ios-widgets/](./ios-widgets/) 內嵌 PAT（個人自用可接受，文件提醒勿上傳公開 repo）。
- **對抗式復審（兩路）修正**：【HIGH】`ComputeScopeRangeUtc` 對「DST 春進間隙設在午夜」的時區（如 America/Santiago）在轉換日算「當地 00:00」會丟 `ArgumentException`→裸 500（無全域例外兜底）→ 抽 `LocalWallToUtc`＋`IsInvalidTime` 推進到有效瞬間，加 internal 單元測試鎖住；【HIGH】文件引用不存在的 `GET /{id}`→補該端點；【MEDIUM】時區 catch 過窄改全捕、彙總測試改錨定「當地正午」消 1.4% flaky、「未分類」聚合標籤碰撞記錄取捨。
- **驗證**：TDD——後端 70 個 TimeEntry 測試（含 DST/GET{id}/summary/recent-items/note），全套件 Api 379＋Infra 66 零回歸；前端 tsc/eslint/build 過；本地部署 Playwright 實測備註 新增→顯示（亮/暗/暖紙×1280/375、console 零錯、375 無橫捲）。

---

## 2026-07-15 ｜時間追蹤（TimeEntry）：首頁計時面板＋iOS 捷徑主畫面操作（feature/time-tracking）

- **背景**：使用者要記錄「每天把時間花在什麼上面」：首頁按鈕輸入名稱＋可選分類＝開始計時、回來按結束算時間差、時間可事後編輯、日/週/月/年分組檢視、整塊可收合；且希望 **iPhone 16 主畫面就能開始/結束，不開 ZonWiki**。完整設計與測試計畫在 [docs/design/時間追蹤-設計與測試計畫.md](./design/時間追蹤-設計與測試計畫.md)。
- **資料模型**：新表 `TimeEntry`（`AuditableEntity`＋`IUserOwned`）：Title(200)/Category(128, 自由文字)/StartedDateTime/EndedDateTime(null=計時中)；**時長不落欄位**（DTO 即時算 durationSeconds，免「改時間忘同步時長」）；分類抄 QuickLink 的輕量 `string?`（要升級共用 Tag/Category 樹再另案）。
- **iPhone 主畫面**：**iOS 捷徑＋PAT Bearer**（iOS Safari 不支援 manifest shortcuts，捷徑＝零 App 開發的原生體驗）；既有 SmartAuth 讓端點對 Cookie/PAT 無感、零新認證機制。另設 `POST /api/time-entries/stop-latest`（一鍵結束「最近開始」的進行中項目）讓捷徑免先列清單。教學見 [docs/iOS捷徑-時間追蹤.md](./iOS捷徑-時間追蹤.md)。
- **測試計畫先經 sub-agent 對抗式審查**（鐵則 #15），揪出 3 個 CRITICAL 並全數採納入設計：
  - **stop-latest 平局 tie-break**：`ORDER BY Started DESC` 平局時 PostgreSQL 不保證穩定 → 補 `CreatedDateTime DESC, Id DESC` 次排序（同秒連按兩次捷徑行為固定）。
  - **ActivityLog 時間欄位「只列欄名、不附值」**：既有 `FormatValue` 對 DateTime 只印 `yyyy-MM-dd`，「同日改時分」會記成「相同→相同」白紀錄、且值是 UTC 易生時區混淆 → Started/Ended 歸入 LongTextFields。
  - **限流共桶取捨（經實查非假設）**：`PatPolicy` 以 `user:{userId}` 分區，**Cookie 與 PAT 共桶**（TokenBucket 30、每分鐘補 15）→ 接受（單人手動操作到不了 30 burst；PAT 外洩時同樣受限），寫入端點皆掛、burst 測試鎖 429。
- **其他決策**：入參 DateTime 一律 `NormalizeToUtc`（Utc 原樣／Local→轉 UTC／Unspecified→視為 UTC）——iOS 捷徑是第一個會送「非 Z 尾碼」時間的用戶端；**技術債留痕：既有 `TaskEndpoints` 對 DueDateTime 等無同款正規化**（靠前端一律送 Z 的不變式撐著，本次不修）。併發採 **last-write-wins**（不加 xmin；單人低頻、損失可編輯救回，以測試鎖語意）。`TimeEntry` 註冊進統一垃圾桶（列表/還原/永久刪除三處＋前端分區「⏱️ 時間追蹤」）。允許多項同時計時。PUT 可對進行中項目補結束時間、不可把結束清回 null。
- **前端**：`TimeTrackingSection`（首頁、可收合記 localStorage）；期間邊界以「使用者時區牆上 00:00」`fromLocalInputValue` 換算 UTC，歸日用 `toLocalInputValue`（**不用** `.split("T")[0]`）；編輯用共用 `DateTimePicker`（UTC 進出）。
- **對抗式復審（兩路平行，鐵則 #14）**：C# 路 Approve（0 必修）但挖到**「FieldLabels 全域字串鍵碰撞」**——加 `"Category"` 讓 QuickLink 分類編輯也開始進活動摘要（範圍外連帶行為變更）→ 明確接受＋回歸測試鎖住＋警示註解（日後同名屬性不該外洩時改複合鍵）；GET 補 `AsNoTracking()`。前端路 3 HIGH 全修：刪除失敗訊息被彈窗遮罩蓋住（改彈窗內顯示）、期間切換無競態守衛（加請求世代號）、單檔 1028 行超標（拆三檔：`lib/timeTracking/period.ts`＋`TimeEntryEditModal.tsx`＋主面板）；MEDIUM 也修（anchor 隨 tz 校正、統計即時併入進行中項目並標示）。完整清單見設計文件 §7.10。
- **驗證**：TDD——51 個 HTTP 整合測試先 RED（51 失敗）→ 實作後 GREEN，復審後含回歸測試共 52 案通過，全套件零回歸；前端 tsc/eslint（基準比對零新增）/next build 過；本地部署（後端 5009＋前端 3000 換新 build）＋ Playwright 實測（亮/暗主題、375px/1280px、開始→計時→結束→編輯全流程、console 零錯誤）。

---

## 2026-07-11 ｜搜尋結果附分類/標籤脈絡＋獨立進階搜尋頁＋活動明細記「改了什麼」（feature/search-and-activity-ux）

- **背景（兩個痛點）**：①使用者有多篇同名「README」筆記，Header 搜尋下拉只顯示標題＋一段來源不明的內文片段，**無法分辨是哪一篇**（希望顯示分類/標籤等脈絡），且沒有可做進階篩選的獨立搜尋頁；②個人頁「活動明細」只記到「編輯 筆記 README」這種標題級資訊，**看不出改了什麼**（改標題？調分類？），多篇同名筆記也分不出是哪篇。
- **搜尋結果 enrichment：DTO 加可空欄位、只在最終結果補齊（非全體候選）**
  - **考慮過的選項**：①`SearchResultDto` 加必填欄位（會炸掉現有 9 處 `new SearchResultDto(...)`）；②加**可空選擇性**欄位 `Categories`/`Tags`/`UpdatedAt`/`ParentTitle`，且只對「最終排序後的前 N 筆」批次補分類/標籤（採用）。
  - **最終決定**：採 **②**。`UpdatedAt`（所有型別）與 overlay 的 `ParentTitle`（所屬筆記標題）於各型別查詢內就地帶出；筆記的分類路徑/標籤在 `EnrichNoteResultsAsync` 對「回傳的前 N 筆」批次補（載入本人分類建 `CategoryHierarchy` 拼完整路徑、查 NoteCategory/NoteTag），**非**對每個 ILIKE 候選補（避免放大）。分類/標籤只對筆記填、`ParentTitle` 只對浮層填；筆記一律得「非 null 的空陣列」讓前端免 null 防禦分支。
  - **取捨**：活動明細與搜尋的「分類」都是**查詢當下**的分類，非「動作/命中發生當時」的歷史快照（ActivityLog 不存分類歷史）——單人知識庫夠用，要歷史快照再另設計。
- **進階篩選與瀏覽模式**：`/api/search` 加 `categoryId`（含**所有子孫分類**）、`tags`（CSV，任一命中）、`sort`（relevance｜updated）、`limit` clamp [1,500]。帶 `categoryId`/`tags` 時**只回筆記型別**；**空關鍵字＋範圍篩選＝瀏覽模式**（回該範圍全部筆記、依更新時間排序），空關鍵字且無篩選仍回空（維持現狀）。跨租戶：所有 enrich/scope 查詢明確 `UserId==` 過濾，`BuildPath` 對「不在本人階層」的 categoryId 回空字串被濾除（DB 級異常連結也不外洩他人分類名）。
- **`CategoryHierarchy`（新共用類別，cycle-safe）**：`BuildPath`（回溯到根拼「學習 / 併發」）與 `DescendantsAndSelf`（BFS 展開子孫）皆以 visited 集合防環——API 端有防環但 DB 直改可繞過，不防環會無窮迴圈。搜尋（路徑＋範圍展開）與活動明細（目前分類路徑）共用。
- **活動明細「改了什麼」：ActivityLog 加 `Detail` 欄＋攔截器記變更摘要、攔分類/標籤異動**
  - **最終決定**：`ActivityLog` 加可空 `Detail`（varchar(500)，migration `AddActivityLogDetail`）。`ActivityLogInterceptor` 大改：`updated` 時掃 ChangeTracker 產友善中文摘要（短欄位附「舊 → 新」、長文欄位只列名、**排除**稽核欄/影子屬性 xmin/衍生欄 ContentHtml·Slug·ContentHash）；並攔 `NoteCategory`/`NoteTag` 的 **Added ＋ ValidFlag 翻轉**（本 repo 移除＝軟刪、重加＝復活，故不能只看 Added/Deleted），依所屬筆記**合併成同一筆** note/updated 活動（`加入分類「工作」；移出分類「暫存」`）。
  - **關鍵取捨**：`CreateNoteHandler` 原本「先存筆記→再存分類」**兩段 SaveChanges**，會被攔成 created＋updated 兩筆雜訊；因 `Id` 於實體建構即 `Guid.NewGuid()`，改為**單一原子 SaveChanges**（同時更正確），「建立即帶分類」只記一筆 created。
  - **`/api/me/activity-log`** 回傳加 `detail`，並對 note 項目補「目前分類完整路徑」`categories`（區分同名筆記）。前端明細列改雙行：第一列動作/型別/標題/時間，第二列（若有）分類 chip ＋變更摘要。
- **攔截器在 SaveChanges 內查 DB（補分類/標籤名、筆記標題）**：`SavingChangesAsync` 內對同一 DbContext 發 `AsNoTracking` 查詢——經查證 EF Core 10 的攔截器在真正持有並行臨界區之前派發，循序 await 不會重疊、不死鎖；`AddRange` 在 await 後仍納入本次 save（沿用舊模式）。同步路徑另備一份同步查詢（全 repo 皆 async，屬完備）。
- **對抗式復審（.NET 資安）修正**：
  - 【CRITICAL】`Truncate` off-by-one：`s[..max] + "…"` ＝ **max+1** 字元，塞進 varchar(500) 溢位（22001）→ 因 log 與使用者變更同交易，**整批 rollback、使用者存檔直接 500**。改為 `s[..(max-1)] + "…"` 確保 ≤ max。加回歸測試（一次加兩個 250 字長名分類，摘要 >500，斷言存檔成功且 Detail ≤ 500）。
  - 【MEDIUM】刪除整個標籤會硬刪其在 N 篇筆記上的關聯 → 攔截器誤記 N 筆假的「筆記 updated：移除標籤」。修：掃描先收集「本批次整個被刪除的分類/標籤 Id」，其連帶移除的關聯不記逐筆活動（`CollectDeletedParents`）。加回歸測試。
  - 【查證為安全】跨租戶無外洩、CreateNote 合併 SaveChanges 正確（FK 拓撲排序保證 Note 先插）、瀏覽模式 `similarity(x,'')` 回 0 可轉譯、Detail 只含欄位名/短值不含長文。
- **驗證**：後端 26 個新整合測試（`SearchEnrichmentHttpTests` 12＋`ActivityLogDetailHttpTests` 14，含 2 個復審回歸），全 Api.Tests **309 passed**。前端 tsc/eslint/`next build` 全過。本地部署（後端套新 migration、前端換新 build）後 Playwright 實測：Header 下拉三篇同名 README 以「📁 分類路徑＋🏷 標籤」可辨識、`/search` 頁篩選/高亮/排序、活動明細顯示「標題「README」→「…」；加入分類「工作」」＋分類 chip；亮暗雙主題各截圖、375px 無爆版、console 零錯、新配色組合 WCAG AA 全過（≥4.95:1）。
- **不變式（給後人）**：任何新的「存 Markdown/文字欄位」若要納入搜尋或活動摘要，記得同步 `SearchEndpoints`／`ActivityLogInterceptor`；`ActivityLog.Detail` 一律只存「摘要」（欄位名／短值／分類標籤名），**絕不**塞完整內容。

---

## 2026-07-10 ｜修「開啟筆記即假衝突」＋側欄筆記可拖曳歸類（feature/table-reading-ux）

- **背景（Bug）**：使用者回報「只是改個分類存檔，就跳假的『此筆記已被其他來源修改』」，但全程只有本人、也沒改過別處。實測根因（HTTP 整合測試重現）：載入筆記後前端會呼叫 `POST /api/notes/{id}/opened` 標記「最後打開時間」，該端點以 `ExecuteUpdateAsync` 直接 UPDATE 該列的 `Note_LastOpenedDateTime`；而樂觀鎖權杖 `xmin`（見 2026-07-06 決策）是 PostgreSQL 的「整列」系統欄——**任何** UPDATE 都會使其前進，無法只改某欄而不動它。於是「載入時記下的 Version」在標記打開後立刻過期，接著存檔（帶過期 `baseVersion`）便撲空 → 假 409。此問題與「分類」無關，幾乎每次「開筆記→編輯→存」都會中，使用者剛好用改分類測到。
- **考慮過的選項**：①把 `LastOpenedDateTime` 移到獨立表，讓「開啟」不碰 Note 列的 xmin（根治，但要 migration＋改清單排序查詢，對單人系統過重）；②折進 GET 詳情端點一併 stamp 並回傳 stamp 後版本（少一次往返，但 GET 產生寫入副作用、且 `getNote` 有多個呼叫點會被牽動）；③`/opened` 於更新後回讀最新 xmin 一併回傳，前端據此把 `baseVersion` 同步成最新（採用）。
- **最終決定（Bug）**：採 **③回讀並回傳最新版本**。`/opened` 在 `ExecuteUpdateAsync` 後以「原生 `EF.Property<uint>(n,"xmin")` 讀出、記憶體再轉 long」（沿用既有慣例，避免 `(long)` 下推成 `CAST(xid AS bigint)` 觸發 `42846`）回傳 `{ id, version }`；前端 `markNoteOpened` 改回傳 `number|null`，詳情頁載入後 `markNoteOpened(...).then(v => setNote(prev => prev && prev.id===noteData.id ? {...prev, version:v} : prev))` 把 `note.version` 同步成最新（只覆寫 version 欄、且守衛「仍停在同一篇」避免切走後誤蓋）。
- **理由與取捨（Bug）**：③最小 blast radius——保持 GET 純讀、把版本同步限縮在唯一的「明確開啟」訊號，不像②會讓 4 個 `getNote` 呼叫點都產生寫入。**已知殘留（可接受）**：`markNoteOpened` 未解析前（載入後約 <150ms）若使用者以人力完成「開→讀→編輯→存」仍可能撞一次假 409；人手不可能這麼快，且該對話框本就有「覆蓋/重載」出口自癒，故不為此加「進編輯模式時再抓一次版本」的額外往返。真正根治（選項①獨立表）留待需求變重再做。
- **驗證**：新增 2 則 HTTP 整合測試（`NoteEndpointsHttpTests`）——`MarkOpened_ReturnsFreshVersion_MakingSubsequentUpdateConflictFree`（RED→GREEN 鎖住修法契約，是本次真正的回歸守門）、`MarkOpened_ThenUpdateWithPreOpenVersion_Returns409`（旁路防線：鎖住「打開前版本仍過期＝併發保護未被誤關」，修法前後皆 PASS、對本 bug 不具區辨力，定位如此即可）；全 Api.Tests 281 passed。Playwright 對本機實測「開→改分類→存」無假衝突對話框、分類正確更新。
- **對抗式復審（C#／前端兩路平行）修正**：
  - 【後端 兩路都指出】`/opened` 回讀 xmin 原用 `FirstAsync` 且漏 `ValidFlag` → 極窄競態下（UPDATE 成功提交後、回讀 SELECT 前，該列被同帳號另一請求軟刪）回讀撈空、`FirstAsync` 對空序列丟未處理例外變 500。改用 `FirstOrDefaultAsync`＋補 `&& n.ValidFlag`、投影匿名型別，`null`（回讀當下已消失）視同筆記不存在回 404（前端 `markNoteOpened` 對非 200 靜默回 null、不影響閱讀）。
  - 【前端 HIGH 亂序覆寫】原 `setNote` 只用 `prev.id === noteData.id` 當守衛，只防「寫到錯的筆記」、沒防「同一筆記多次 `/opened`（StrictMode 雙掛載／快速切回同篇／多分頁）回應亂序抵達」把 `note.version` 覆寫成**較舊**值 → 又假衝突。改為**單調取大** `version: Math.max(prev.version ?? 0, openedVersion)`（xmin 隨每次更新遞增，取大＝最新，永不回退；存檔後更大的 xmin 也不會被較舊的 /opened 回應蓋掉）。
  - 【已知殘留・未改（可接受）】`handleSave` 未 `await` 尚未完成的 `markNoteOpened`：使用者若在「載入→編輯→存」全程於單次網路來回（數十毫秒）內完成，仍可能撞一次假 409（人手不可能這麼快，且對話框本有覆蓋/重載出口自癒）。`previewHtml` 的 `useMemo` 依賴整個 `note` 物件、version-only 更新會白跑一次 `buildToc`（下游 `previewHtmlObj` 以字串值記憶保護，不觸發 `dangerouslySetInnerHTML` 重注入——2026-07-08 React19 identity 防線仍成立）。此二者屬 LOW，不值得為之增複雜度。
- **背景（Feature）**：使用者要能「在左側欄直接把某筆記拖到某分類下」。現況：側欄分類列（`CategoryNode`）**本來就會**接收 `NOTE_DND_MIME` 拖入（`handleDropNoteOnCategory` → `addNoteToCategory`，冪等），只是拖曳來源僅有「筆記清單頁的卡片」；側欄裡的筆記列（`NoteRow`）當時不能當拖曳來源。
- **最終決定（Feature）**：讓 `NoteRow` 的 `<Link>` 加 `draggable` + `onDragStart` 帶 `NOTE_DND_MIME`（= note.id），與清單頁卡片同一套拖放協定，drop 端完全複用既有邏輯。**語意＝「加入」**（使用者裁示）：拖到目標分類是把筆記「加入」該分類（來源分類保留，一篇筆記可同屬多分類），與現有「清單頁拖進分類」一致、非破壞性。HTML5 拖曳與 click 互斥，純點擊仍照常開啟筆記。
- **理由與取捨（Feature）**：drop 端與 `addNoteToCategory` 已是既有且測過的路徑，本次只補「側欄可當來源」一小塊，改動面最小。手機無原生 DnD → 側欄拖曳在觸控裝置不可用（不劣化既有行為；批次歸類仍可走清單頁編輯模式）。

---

## 2026-07-10 ｜查看模式就地改程式碼區塊語言/檔名，用「後端圍欄來源行號」定位（feature/table-reading-ux）

- **背景**：閱讀檢視（查看模式）的程式碼區塊標題列原為唯讀；使用者要能就地改語言/檔名、隨改隨存 DB，不必進編輯模式。難點是「使用者在 DOM 上點的那個區塊」要可靠對應到「原文 markdown 的哪一個圍欄」才能改寫圍欄資訊字串（```lang:filename）。
- **考慮過的選項**：①前端逐行正則掃 markdown 數「第 N 個圍欄」、DOM 也數第 N 個 `.code-block`，兩邊對齊（v1 採用，被對抗復審打掉）；②後端 Markdig 給每個圍欄程式碼區塊標來源行號 `data-fence-line`、前端據此直接改該行（採用）。
- **最終決定**：採 **②後端行號**。`RenderToHtml` 對每個 `FencedCodeBlock` 標 `data-fence-line`＝Markdig 的來源起始行號（`fenced.Line + 1`）；前端 `enhanceReadingCodeBlocks` 讀它、`setFenceMetaAtLine` 直接改寫該行。縮排程式碼區塊不是 `FencedCodeBlock`、不標行號 → 維持唯讀。
- **理由與取捨**：選項①有 CRITICAL 資料損毀——**前端逐行正則拿不到 CommonMark 的「容器縮排基準」**：頂層縮排 ≥4 空白的字面 ``` 是縮排碼（非圍欄），但清單/引用內縮排 ≥4 的 ``` 卻是合法圍欄，兩者絕對縮排相同、無法用逐行正則區分。這讓「清單縮排續行段落」「頂層縮排展示字面 markdown 圍欄」等內容的前端計數與後端（Markdig 依 CommonMark）分歧，改到別的區塊並存回 DB。改由後端（有 AST、判定權威）吐行號徹底根治。`NormalizeToggleFences` 只改 `:::` 冒號數、不增減行，故 `data-fence-line` 與原始 `contentRaw` 行號一致（真後端反射實測 13 案例：toggle/巢狀/blockquote/list/CRLF 全對）。
- **健壯性**：跨編輯彈窗/編輯頁保存用 draft 版本標記（記 `appliedTo`/`result`）避免過期草稿覆寫別路徑的整篇編輯（資料遺失）；即存重注入後由 observer 重套 toggle 展開狀態與捲動；圍欄資訊字串剝反引號/換行（含反引號會提前關閉 ``` 圍欄、吃掉後續內容）。
- **已知取捨（LOW，非 bug）**：編輯預覽（非查看模式）仍用「前端逐行過度計數 + `remarkMarkFenced` 過度計數」的自洽機制——對「頂層縮排展示字面圍欄」會誤顯示可編輯下拉，但兩端同步過度計數、改它只動使用者點的那行、不影響別區塊資料。閱讀檢視該區塊仍正確唯讀。完整修復需編輯預覽改用 segment 位移的來源行號定位，另案。
- **教訓**：DOM 元素 ↔ markdown 位置的對應，別用「逐行正則近似 CommonMark」——縮排碼/容器縮排靠逐行拿不到基準。要嘛用真 parser（後端 Markdig／前端 mdast position），要嘛讓權威端（後端 AST）吐位置給另一端。

---

## 2026-07-10 ｜筆記「問題功能」＋搜尋涵蓋浮層（feature/note-questions-and-search）

- **背景**：使用者要能把便利貼／T 文字框標記為「問題」，集中在清單裡檢視、逐題作答（手寫或請 AI 回答），並在分類頁看到該分類（含所有子孫分類）的所有問題；同時搜尋要能搜到浮層文字並可依類型篩選。
- **問題資料模型：用 `NoteOverlayItem` 加欄位，而非獨立「問題表」**
  - **考慮過的選項**：①在 `NoteOverlayItem` 加 `IsQuestion`／`QuestionAnswer` 兩欄（採用）；②獨立 `NoteQuestion` 表，以 FK 指向浮層元件。
  - **最終決定**：採 **①加欄位**。理由：問題本質上就是「浮層元件的一個屬性」，其生命週期完全跟隨 item（item 軟刪＝問題消失、拖曳/改文字都跟著走），獨立表只會多一層 join 與「兩邊同步／級聯軟刪」的負擔。migration `AddNoteOverlayQuestion`（`NoteOverlayItem_IsQuestion` bool 預設 false、`NoteOverlayItem_QuestionAnswer` text 可空）。
  - **取捨**：回答內容與 item 綁死、且「一題一答」；未來若要「一題多答／多人協作答」再拆獨立表。
- **回答「清空」語意（已釘死）**：PUT patch 沿用既有慣例「`!= null` 才套用（含空字串）」——`questionAnswer: ""` ＝清成空字串（未答）、`null` ＝不更動；`HasAnswer` 定義為 `!string.IsNullOrEmpty(QuestionAnswer)`（空字串與 null 都算未答）。
- **AI 回答走既有非同步佇列、只回文字不落地**：新端點 `POST /api/notes/{id}/ask-question` 完全模仿 `ask-selection-answer`（同步建 Running session 立即回 sessionId → 背景後援鏈跑 → 前端輪詢佇列取 `resultText`），以「整篇筆記內容」為脈絡。**新增 AiSession kind `"notequestion"`**（而非複用 `floatingnote`）——語意不同（無框選），且讓「AI 處理佇列」正確標示為「筆記提問」；已同步加入後端 `validKinds` 與前端 `AskQueueKind`／佇列標籤。問題長度上限 **4000 字元**（比照 `NoteOverlayItem_Text` 的 DB 上限；`ask-selection` 本身無上限，刻意不抄）。
- **`GET /api/questions` 的分類範圍**：帶 `categoryId` → 先驗證分類屬本人（全域過濾使非本人／不存在查不到 → **404**，比照 `CategoryEndpoints` 慣例）；再於記憶體端遞迴算「自己＋所有子孫分類」（分類量小），**用 visited set 防環狀 ParentId 卡死**（雖建立端已擋環，仍照多層防線風格防禦）。筆記多分類 → 以「先算 noteId 集合再篩 item」的方式天然**去重**（不把 NoteCategory join 進主查詢）。join Note 讓「所屬筆記被軟刪」的孤兒問題一併被過濾（`DeleteNoteHandler` 不級聯軟刪 overlay）。
- **前端架構**：問題面板與答題彈窗由 `NoteOverlay` 渲染（它擁有 overlay items 與回答狀態，單一真相），頁面只持有「面板開關」與「問題數」；答題彈窗 `QuestionAnswerPopup` 為獨立可重用元件（筆記頁與分類問題清單頁共用），portal＋`position:fixed`＋標題列拖曳，z-index 2000（高於釘住便利貼 1100+、低於未存守門確認框 4000）。**Ctrl+Z 還原 AI 覆蓋**：只在「回答框現值 === AI 覆蓋結果」時攔截還原快照，否則放行交給原生 undo。捲動定位邏輯抽成共用 `scrollToOverlayItem`（與 Phase 2 的 `?overlay=` effect 共用同一份）。
- **搜尋擴充（同分支 Phase 2）取捨**：`/api/search` 新增 `types` CSV 篩選（未帶／全未知值＝回退全部型別，**非空集合**）；浮層納入搜尋——`text` 比對 `Text`、`sticky` 比對 `Text OR DataJson`（**便利貼標題存於 `DataJson.title`，為求簡潔以「整欄 ILIKE」比對**，極少數 JSON 雜訊誤中可接受，不在 SQL 端解析 JSON；標題顯示則於 C# 記憶體端安全解析）；`drawing`／`slide` 不搜。
- **對抗式復審（資安／C#／前端三路平行）修正**：
  - 【資安 HIGH】5 個筆記 AI 端點（reformat／beautify／ask-selection／ask-selection-answer／新增的 ask-question）補掛 `AiPolicy` 每使用者限流——前四個是**既有漏掛**（審查發現 #30/#58 既定政策的補課，比照 `/api/ai/ask`），非本次新引入。
  - 【C# HIGH】`QuestionEndpoints` 全部查詢補「**明確 UserId＋ValidFlag**」條件——縱深防禦，與 SearchEndpoints／NoteOverlayEndpoints 的雙保險慣例一致（過去 Node 實體曾因單靠一道過濾出過跨帳號外洩事故），不再單靠 EF 全域過濾。
  - 【C# M】PUT overlay 寫入端補 Kind 守門（`drawing`／`slide` 設問題屬性 → 400）；回答內容加應用層上限 **100,000 字元**（DB 欄位 text 無上限，防單列重複 PUT 塞爆＝自傷型 DoS）；`Text` 的 4000 上限抽成 `NoteOverlayItem.TextMaxLength` 常數（DB 設定與 ask-question 驗證共用，消魔術數字）；標題推導合併為 `NoteQuestionHelpers.DeriveOverlayTitle`（搜尋與問題清單共用一份，消重複）。
  - 【前端 HIGH】答題彈窗的未存關閉守門改「**彈窗內建確認 UI**」——全站單例 `ConfirmProvider` 只有一個 resolver，與「可多開彈窗」衝突（兩個未存彈窗先後關閉會劫持彼此的確認）；`GlobalSearch` 加**請求序號**防「舊回應覆蓋新回應」競態（篩選 chips 快速切換時結果與篩選狀態不一致）。
- **已知取捨（記錄下來，將來別當 bug 追）**：
  - 搜尋端點沿用既有「ILIKE 撈命中列→記憶體排序→取 limit」模式（同 #W8-1 的刻意取捨），本次多覆蓋兩個浮層型別；全域過濾把範圍鎖在單一使用者、屬自傷型成本，單人系統可接受——單帳號筆記量上千篇長文再考慮 SQL 端粗篩上限。
  - `GET /api/questions` 無分頁：個人問題量級（十～百）可接受，量大再加。
  - 答題彈窗開啟中若同一 item 在別處被刪，彈窗會直接消失（不經未存確認）——極小眾情境，暫不處理。

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

---

## 2026-07-08（第二輪）｜畫記「跟著文字走」：持久化內容錨點＋位移 rebase（fix/note-annotations-and-toc）

- **背景**：第一輪上線後使用者於本地（與 prod 同版）立刻重現新問題：多層 toggle 下，在「只展開 §2」的版面畫記，按「全部展開」後畫記視覺上跑到 §1 的內容上、且之後收合 §2 也藏不掉。根因＝畫記座標是絕對像素，只在「畫記當下的展開狀態」的版面正確；且點錨定機制「可見時重抓」會在版面位移後綁錯內容。第一輪「隱藏而非位移」的取捨在多層 toggle 的真實使用下不成立。
- **考慮過的選項**：①session 級 delta 跟隨（不動持久化格式）——重載後錨點遺失，預設全收合版面下重建必錯，被否決；②持久化內容錨點（採用）。
- **最終決定**：新增 `lib/overlayAnchor.ts`——畫記/便利貼/文字框「建立當下」把壓著的內容元素持久化成**文字錨點**（text/start/prefix/suffix，重定位沿用畫重點既有的 `reAnchor` 容錯）＋基準位置 ex/ey（以「重定位該文字的 Range」量測，與日後 rebase 同路徑、無系統性偏差）。之後任何版面變動（收合/展開/重載/編輯）：文字定位 → 在收合 details 內＝隱藏；可見且位置變了＝把畫記座標平移同量（rebase）並更新基準、800ms 去抖批次持久化。形狀錨點存於 shape.anchor（normalizeShapes 寬鬆驗證）、項目錨點存於 dataJson.anchor（各寫入路徑一律 raw-merge 保留）。拖曳/歸位＝以新位置重錨。舊資料（無錨點）維持第一輪的點錨定隱藏行為，重畫即自動升級。
- **關鍵實測發現（決定實作方向）**：新版 Chrome 對收合 `<details>` 內容採 hidden=until-found 語意——**內容不繪製但 Range/getBoundingClientRect 仍回傳「彷彿展開」的非空矩形**（實測 rect h=96、rects=4）。因此「是否隱藏」不可用幾何查詢，必須用 DOM 祖先鏈（是否位於 closed details 內）判定。
- **驗證**：Playwright 完整重演使用者情境（00 開、僅 §2 開 → 畫螢光筆＋拖便利貼到目標段落 → 收 §2 兩者隱藏 → 全部展開：§2 被 §1 內容推下 844px，**畫記相對目標段落 +12/+18px 分毫不變** → 再收/再開正確 → **重載後（預設全收）隱藏、全部展開後仍 +12/+18**＝跨 session 正確）；舊資料回退回歸（4→1→4）；tsc/eslint 0 error；單元測試 31 PASS。
- **已知取捨**：(a) 舊畫記（此功能上線前畫的）無錨點，維持絕對座標行為——使用者重畫一次即升級；(b) 錨定文字被編輯刪除時回退絕對座標且永遠顯示（不誤藏）；(c) rebase 會改寫持久化座標（單人系統、低頻寫入，換取所有互動路徑維持單一座標系）。

---

## 2026-07-08 ｜筆記頁畫記跟隨 toggle 收合＋繪圖工具體驗＋TOC 三修（fix/note-annotations-and-toc）

- **背景**：使用者回報（prod reamde 筆記）：①收合 `:::toggle` 時只有便利貼會跟著隱藏，手繪畫記/螢光筆/形狀/文字框全部殘留在畫面上蓋到別的內容；②「全部展開」後點右下角「📖 目錄」，整篇筆記莫名變回全部收合；③章節目錄表預設開啟不符期望；④reamde 這種「整篇純 :::toggle、無 h1-h3」的筆記目錄表完全不出現。另要求：螢光筆直線模式、幾何圖形畫完先進「調整中」（滾輪縮放、左鍵完成、維持工具模式）、按 T 取消繪圖模式、右鍵取消所有模式。
- **根因（皆實證，非臆測）**：
  - ①畫記殘留：`NoteOverlay` 的「DOM 錨點＋收合祖先判定」機制只涵蓋 sticky/slide，shapes 與 text 未參與。
  - ②點目錄全收合（**本次最重要的發現**）：React 19 的 `commitUpdate` 對 `dangerouslySetInnerHTML` 以「物件識別」比較——頁面每次 render 都寫新的 `{__html}` 字面量，導致**任何不相關的重繪都會重新注入 innerHTML**、把所有 `<details>` 重建成預設收合。以位元組級插樁證實：重注入內容與原內容完全相同（1315/1315 bytes，零差異），純屬破壞性重寫。「全部展開」按鈕之所以看似正常，是它的 effect 恰好在同一次 commit 後把 open 補回去。此根因同時解釋了歷史上「畫重點標記偶爾消失」的雜症。
  - ④目錄空白：`buildToc` 只掃 `<h1-3>`，toggle 標題是純文字 `<summary>`（Markdig `ToggleContainerExtension`），整篇無 heading → `toc=[]` → TocPanel `return null`。
- **考慮過的選項**：
  - 畫記收合判定曾考慮「幾何範圍」（點是否落在 details rect 內）——沿用既有結論否決（收合歷史造成版面位移 → 判定非決定性）；採既有 DOM 錨點機制推廣。
  - 形狀錨點 key 曾考慮持久化 shape id（改 dataJson 格式）——否決（動持久化格式、遷移成本），改用「形狀 JSON 內容」為 session 內 key：內容不變則 key 穩定；擦除/改樣式/縮放會換 key，但屆時形狀必為可見狀態（隱藏者已被隔離不可操作），會安全重新錨定。
  - ②的修法曾考慮只把「全部展開」effect 加依賴補寫——否決（治標且會清掉使用者手動開合）；根治＝`useMemo` 固定 `{__html}` 物件識別（`previewHtmlObj`），並把「全部展開/收合」effect 改為**序號閘門**（只有按鈕真的被按下才批次寫 `details.open`；初載不再把 `:::toggle-open` 壓成收合）。
- **最終決定（全在前端，無後端/DB 變更）**：
  1. 錨點機制推廣：`computeHidden` 通用化（項目級 key=item.id、形狀級 key=JSON），錨定時機擴充為「toggle 開合（立即）＋捲動/resize（200ms 節流）＋items 變動（60ms 去抖）」——畫完當下（必在視野內）即錨定；從未進過視野的舊畫記維持「無錨點＝永遠顯示」保守行為。
  2. 擦除安全：`eraseVisibleOnly` 讓局部/框選橡皮擦跳過隱藏形狀（不可看不見地誤刪）；渲染層隱藏形狀渲染 `null` 保留原始索引（整筆刪除依索引對應完整陣列，不可位移）。
  3. 螢光筆直線＝`type:'line'+opacity`（沿用既有持久化格式，零遷移）；工具列開關為選項性 props，開問啦畫布端不受影響。
  4. 「調整中」只適用幾何形狀（line/rect/ellipse/螢光直線），**自由筆不進**——手寫（多筆劃）會被「點一下完成」打斷。滾輪縮放走原生 wheel（passive:false 才能擋頁面捲動）、持久化 500ms 尾端去抖＋卸載 flush。
  5. 右鍵取消模式：document capture `contextmenu`，僅在「有模式」時 preventDefault（平時右鍵不受影響）；同時丟棄畫到一半的一筆。
  6. TOC：`buildToc` 單正則掃描 h1-3＋md-toggle summary（details 巢狀深度定層級、cap 3、注入唯一 id 至 `<summary>`）；`tocOpen` 預設 `false`；TocPanel 點章節先展開「祖先」details（目標是 summary 時不動它自己的開合——點目錄＝帶我過去，不替使用者決定展開）。
- **驗證**：零相依單元測試 28 PASS（toc 11＋幾何 17，先 RED 後 GREEN）；tsc/eslint 0 error；Playwright 本地實測（3100/5109 worktree 實例）全數通過——收合跟隨（深層/外層/toggle 外不受影響/展開恢復）、擦除隔離（框選掃過隱藏座標區→隱藏形狀無恙）、整筆刪除索引正確（收合下刪可見者、隱藏者無恙、Ctrl+Z 復原）、調整中（滾輪 40→42.4 放大、頁面零捲動、左鍵完成、工具保持）、螢光直線（斜拖仍兩點直線＋0.4 半透明）、T/右鍵取消、TOC 三項（預設不開/點目錄不再影響展開狀態/純 toggle 筆記有目錄）；亮/暗主題與 375/1280 截圖存證於 worktree `test-artifacts/`；console 0 error。
- **已知取捨**：(a) 收合時畫記採「隱藏」而非「跟著位移」——收合上方章節時，下方仍可見的畫記不會跟著內容上移（與便利貼既有語意一致；若未來要做位移跟隨，錨點基礎已就緒）；(b)「清除全部」仍會清掉隱藏中的形狀（語意＝全部，且可 Ctrl+Z）；(c) 兩個幾何內容完全相同的形狀共用錨點 key（同座標同樣式 → 同收合行為，無害）。
- **對抗式復審後的修正（2 項 MEDIUM，0 CRITICAL/HIGH）**：①「該筆記的第一筆形狀」在 drawing 項目 POST 往返空窗期，items 派生的 shapes 仍為空 → 滾輪/調色短路、第一筆短暫消失、空窗期連畫兩筆會丟第一筆（後兩者為既有縫隙）——修法＝`shapesForUi`（建立中改用樂觀同步的 shapesRef、渲染期不被空值蓋掉）＋建立完成時以最新樂觀值回填 dataJson；已以「全新筆記第一筆＋立刻滾輪→重載」E2E 驗證（即時 112.4×56.2、重載後一致）。②TOC 掃描正則的無界量詞在病態輸入（大量未閉合 `<details`）下 O(n²)（復審實測 4MB→15 秒）；現狀因後端 DisableHtml 無觸發路徑，仍防禦性改為有界量詞（{0,512}/{0,256}）。復審另確認：JSON key 幂等性、eraseVisibleOnly 的 JSON 比較、wheel effect 閉包、contextmenu 不外洩至開問啦、共用元件回歸（TextBox 的左鍵防護反而修掉畫布中鍵誤拖）、TocPanel 展開祖先會同步觸發錨點重算（Playwright 實測 `details.open=true` 會發 toggle 事件）皆安全。

---

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

## 2026-07-09 ｜ 行事曆背景重抓改「stale-while-revalidate」，修「點任務→閃一下＋捲回頂」

- **背景**：關閉任務編輯彈窗時 `TasksPage.handleCloseEditor` 會 `calendarRefreshKey++` 讓行事曆重抓（因彈窗內可能改了日期/狀態）。四個行事曆視圖（月/週/日/年）原本 `if (loading) return <載入中>`——**每次重抓都把整塊內容卸載換成「載入中…」再重掛**，造成使用者看到「閃一下」，且週/日視圖的時間格重掛後 `useEffect` 會把捲動位置重設回 07:00（看起來像「捲回最上面」）。
- **實證（Playwright，鐵則 #21）**：關閉彈窗當下 MutationObserver 觀察到「載入中」出現、時間格 DOM 被移除（remount）、捲動 300→280(07:00)。以 elementFromPoint／scrollTop 位元組級量測重現、修後複驗歸零。（初期誤把 Playwright `scrollIntoViewIfNeeded` 造成的 600→0 當成 bug，追查後確認那是測試工具產生的假象、真兇在關閉時的重抓卸載——對應鐵則 #26。）
- **最終決定**：四視圖一律改為 `if (loading && !events) return <載入中>`——只有「首次載入（尚無資料）」才顯示載入中並卸載；背景重抓保留現有內容顯示、抓完再換上新資料（stale-while-revalidate）。內容不再卸載重掛 → 無閃動、時間格捲動位置保留。
- **理由與取捨**：最小改動即根治；取捨是重抓期間短暫顯示舊資料（可接受，且資料抵達即換）。

## 2026-07-09 ｜ 自訂色盤（畫筆/字色/底色各 10 色）存 localStorage（非 DB）

- **背景**：使用者要求畫筆、形狀、文字字色/底色不要用固定預設色，改為可自存 10 個常用色。
- **最終決定**：以 localStorage 存三組獨立色盤（`zonwiki:swatches:pen` / `:text-font` / `:text-bg`），模組層存放區（`lib/customSwatches.ts`）＋ `useSyncExternalStore` 讓工具列內嵌快選與展開色盤即時同步。`ColorPicker` 新增選用 `swatchKey` prop——只有畫筆與文字色盤傳入；畫重點/便利貼/圖片板等其它呼叫端維持原本 PRESET_COLORS 不變。
- **理由與取捨**：色盤屬「個人裝置的輕量便利設定」，與既有 UI 偏好（主題、側欄寬、工具箱收合）一致都放 localStorage；不像快捷鍵需跨裝置同步（見 2026-06 快捷鍵存 DB 的決策）。取捨是不跨裝置同步（可接受）。

## 2026-07-09 ｜ 互動式 Markdown 待辦核取：範圍限「編輯器預覽」，閱讀檢視暫不動

- **背景**：使用者要求筆記與任務「內容 markdown 區塊」的 checkbox 可直接勾選。
- **最終決定**：`ToggleAwareMarkdown` 新增選用 `onChange`，有傳時待辦核取方塊變可點擊，點擊即以文件順序索引切換原文第 N 個 `- [ ]`（`lib/markdownChecklist.ts`，掃描時略過程式碼圍欄）並回寫。套用於任務內容預覽（本次新開的 withPreview）與筆記編輯器的編輯/並排/預覽。**筆記「閱讀檢視（預覽分頁）」走後端 Markdig 產生的 HTML（dangerouslySetInnerHTML）＋NoteMarksLayer/NoteOverlay 疊層＋React19 innerHTML 識別陷阱**，就地互動風險高，本次暫不動、留待後續。
- **理由與取捨**：編輯器預覽覆蓋「撰寫內容時勾選」的主要情境且實作乾淨；閱讀檢視就地勾選需另一套 event-delegation＋存檔回合，風險/成本較高，分階段處理。

## 2026-07-09（二）｜ 程式碼區塊：VS Code Dark+ 語法上色＋互動式檔名/語言（圍欄慣例 `lang:filename`）

- **背景**：使用者要程式碼區塊像 VS Code——語法上色（註解綠）、左上可填檔名、右上可選語言且依語言配色。
- **最終決定**：
  - 上色用 **highlight.js**（`lib/common` 包＋另註冊 powershell/dockerfile），VS Code Dark+ 顏色以 CSS 對映 hljs token（`globals.css` 的 `.code-block .hljs-*`）；程式碼區塊一律深底 `#1e1e1e`（不隨 App 亮/暗變，貼近 VS Code）。
  - 語言＋檔名以圍欄資訊字串 **`lang:filename`**（例 ```js:app.js）承載——因 react-markdown 與後端 Markdig 都取「第一個詞」當語言 class，中間無空白故兩邊都渲成 `class="language-js:app.js"`，前端統一由 class 解析（`lib/codeBlockMeta.ts`），達成編輯預覽與閱讀檢視一致。
  - **編輯器預覽**（ToggleAwareMarkdown 的 `pre` override → `CodeBlock`）＝互動：檔名輸入框（失焦寫回）＋語言下拉（變更寫回），以 `setCodeFenceMeta` 重寫第 N 個圍欄；索引在「事件當下查 DOM 的 .code-block 文件順序」算出（與互動 checkbox 同一套 StrictMode-safe 模式）。
  - **閱讀檢視**（後端 Markdig HTML）＝唯讀：`enhanceReadingCodeBlocks` 以 DOM 就地把 `<pre><code>` 包成 `.code-block`＋上色＋標題列（取代舊的只加複製鈕的 `codeBlocks.ts`，已刪）。
- **理由與取捨**：`lang:filename` 慣例讓「一份原文、兩端渲染」一致且免動後端；互動只在編輯器（閱讀檢視就地編輯風險高）。取捨：閱讀檢視改語言/檔名要進編輯器。

## 2026-07-09（二）｜ 自訂色盤改「空的開始」；行事曆窄任務格兩段式點擊；複製走前端組合

- **色盤**：三組自訂色盤（畫筆/字色/底）預設值改為 **空陣列**（先前有種子色，使用者要求移除），由使用者用「＋」自己存；`CustomSwatches` 加「✎ 編輯」模式（每格右上 ✕ 移除、點格改成目前色，觸控可用）；「開色盤」鈕改成明顯膠囊（🎨＋▾）。
- **行事曆兩段式**（`useRevealThenOpen`）：月/週視圖窄任務格「太窄看不出是啥」→ 點第一下若標題被截斷就先原地放大顯示完整標題、不開任務；點第二下（或本來就沒截斷）才開。套用月視圖橫條、週全天橫條、時間格任務塊。
- **複製任務/筆記**：以既有 create API 於前端組合（`duplicateTask`＝createTaskCard＋assignTaskTags＋createSubTask；`duplicateNote`＝createNote 帶內容/分類/標籤），標題加「(副本)」。取捨：非後端原子端點、多次請求（個別失敗不影響主體）；副本刻意不帶父任務/首頁釘選。

## 2026-07-10 ｜ 答題彈窗升級：回答＝共用 Markdown 編輯器（可貼圖）→ 孤兒附件掃描器必須納入 QuestionAnswer

- **背景**：問題功能第二批 UX 需求——問題清單面板可拖曳、答題彈窗可整體縮放、「問題／回答」支援 Markdown（含預覽）、T 文字框 ❓ 旁加「答」鈕（已答上色）。
- **考慮過的選項**：回答區自寫輕量 Markdown 輸入 vs 直接共用 `MarkdownEditor`；彈窗縮放用 CSS `resize: both` vs 自訂右下角握把。
- **最終決定**：
  - 回答區直接共用 **`MarkdownEditor`（withPreview）**——與筆記/任務/節點同一套工具列與編輯/並排/預覽行為，免重複造輪子；新增 `.mde--fill` 樣式（選配 class）讓編輯器在「外層固定高度」場景撐滿並內部捲動。「問題」區以 `ToggleAwareMarkdown` 唯讀渲染。
  - 彈窗縮放用**自訂握把**（pointer events，MIN 320×360、夾在視窗內）——CSS resize 的原生握把不可控且跨瀏覽器不一致，也難與「初始高度自動」共存。
  - 「Ctrl+Z 還原 AI 覆蓋」改掛在編輯器外層 `onKeyDownCapture`（capture 先於 textarea 原生 undo），行為與原版一致。
  - 圖片上傳中停用「儲存／請 AI 回答」（接 `onUploadingChange`），比照筆記編輯器，避免把「〔圖片上傳中〕」佔位存進 DB。
- **關鍵連動（易漏）**：回答（`NoteOverlayItem.QuestionAnswer`）從此可能引用附件短網址，**孤兒附件掃描器的引用判定必須加查 QuestionAnswer**（`AttachmentOrphanScanner`），否則只被回答引用的附件會在寬限期後被誤判孤兒軟刪除（圖片變死圖）。已以整合測試 `Scan_ReferencedByQuestionAnswerOnly_IsUntouched` 固定此不變式。日後若再有新的「存 Markdown 的欄位」，記得同步擴掃描器。
- **對抗式復審追加（同日）**：
  - 復審指出既有同類缺口——`NoteOverlayItem.Text`（便利貼／文字框**本文**）一直以 ReactMarkdown 渲染、手貼附件短網址即可顯圖，但掃描器從未查它。已一併補查＋測試 `Scan_ReferencedByStickyTextOnly_IsUntouched`（掃描器測試 11/11）。
  - **顯式取捨**：開問啦畫布的 `CanvasAnnotation`（DataJson/Text）目前**不在掃描範圍**——前端畫布標註尚無任何貼圖上傳路徑，寫不進附件 id；日後若畫布標註接上附件上傳，必須同步擴掃描器（此處先記下來避免隱性遺漏）。
  - 效能觀察：`DataJson`／`Text`／`QuestionAnswer` 三個 ILIKE 均無專用 trigram 索引（`Text` 有搜尋用 GIN），每日一輪、單人規模可接受（與 NoteRevision 不建索引的既有取捨一致）；若日後掃描明顯變慢，比照 `IX_Note_ContentRaw_Trgm` 補索引。

## 2026-07-28 ｜ Todo 側欄「置頂的任務」分頁：獨立旗標（不重用首頁釘選）＋僅 list 視圖過濾；順修 A 鍵同鍵覆蓋 bug

- **背景**：使用者要 Todo 頁左側欄新增與「快捷鍵介紹」平行的分頁「置頂的任務」（預設顯示），任務可設「置頂」後出現在該分頁。
- **考慮過的選項**：
  1. 重用既有 `IsPinnedToHome`（首頁釘選）當資料來源——側欄與首頁「我的任務」顯示同一組。
  2. 新增獨立欄位 `TaskCard_IsPinnedToTodo`。
- **最終決定**：選 2（獨立欄位）。使用者說「新增一個功能」且兩者語意不同（首頁儀表板 vs Todo 工作側欄）；混用會讓「想釘首頁但不想佔側欄」做不到。刻意**不加排序欄位**（YAGNI，清單依建立時間排）、**無自動排序副作用**（與 IsPinnedToHome 的 HomeSortOrder 自動指派不同），並以整合測試鎖住兩旗標互不影響。
- **查詢參數範圍裁示**：`GET /api/tasks?pinnedToTodo=true` **僅 list 視圖生效**，board/calendar 忽略（TDD 計畫審查裁示，測試 `ListTasks_BoardView_IgnoresPinnedToTodoParam` 鎖住）——避免過濾誤套到共用基礎查詢、無聲改變其他視圖行為。
- **側欄刷新機制**：沿用既有 `zonwiki:tasks-changed` 視窗事件（原只有 SubtaskViewerModal 派發），TaskEditorModal 儲存/刪除與 QuickCreateTaskModal 建立後也派發；TasksPinnedList 監聽即時重載。點側欄項目走既有 `zonwiki:open-task` 開編輯器（免逐層傳 callback）。
- **順帶修復（驗證時發現的既有 bug）**：ShortcutRuntime 的 keymap 是 `Map<鍵, 單一動作>`，而 `newTodo`（Todo 頁）與 `newNote`（筆記頁）預設鍵都是 `a` → 後註冊者覆蓋，**Todo 頁 `A` 快捷鍵自 newNote 加入後即靜默失效**（README 記載的功能）。改為 `Map<鍵, 動作[]>`＋依當前頁面 scope 解析（/tasks 挑 tasks、/notes 挑 notes、否則 global）；「同鍵不同 scope」從此為合法組合。/time 頁守門與 global 行為不變，Playwright 實測 a 鍵於 /tasks 開新增任務、n 鍵導覽照舊。

## 2026-07-31 ｜ 筆記 URL 一律逐段編碼（noteHref/EncodeSlugForUrl/encodeSlugPath 三份同契約）

- **背景**：舊檔案匯入時代的 slug 可含 `/`（層級）與 `#`（prod 實例 `programming/c#/f`）。多處裸串組 `/notes/{slug}` 連結，`#` 被瀏覽器當 fragment 切掉 → 開頁「筆記不存在」；MCP get_note 同病。
- **考慮過的選項**：①各呼叫點各自編碼；②共用 helper 逐段 `encodeURIComponent`（`/` 保留為層級分隔）；③URL 改 GUID 根絕（併入 slug 改版討論）。
- **最終決定**：②。前端 `lib/noteHref.ts`（`noteHref`＋`encodeSlugPath`）、後端 `NoteContentHelpers.EncodeSlugForUrl`、MCP `slugPath.ts` 三份同契約（無共用機制，註解互指）。後端把 `Uri.EscapeDataString` 多編的 RFC 3986 sub-delims（`! * ' ( )`）還原，**對齊 JS `encodeURIComponent` 語意**，確保同一 slug 前後端組出的 URL 逐位元組相同（返回堆疊字面比對不誤判）。孤立 surrogate 以 U+FFFD 兜底（壞 slug 不炸整份側欄渲染）。
- **機器守衛**：前端 vitest 靜態守衛掃描 `frontend/src` 的 `` /notes/${ `` 裸串樣式（排除 `/api` 前綴），殘留即 FAIL——「漏改」與「未來再寫裸串」都被測試擋下。
- **取捨備忘**：`POST /api/notes` 的 Location 標頭仍整串 escape——新建 slug 必經 GenerateSlug 過濾、不可能含特殊字元，屬安全死路徑，留待 slug 改版一併檢視。守衛不抓「字串串接」寫法（現庫無此寫法，記為已知限制）。

## 2026-07-31 ｜ 反向連結聯集三來源（wiki/mark/entity）＋排序一律 Ordinal

- **背景**：三套互不相通的連結系統（NoteLink=[[X]]、NoteMark kind=link=框選段落關聯、EntityLink=整篇關聯），反向連結分頁只查 NoteLink——使用者框選段落建的關聯完全看不見（prod 實證：上雲步驟→DB相關）。
- **最終決定**：`GetBacklinksHandler` 聯集三來源；`BacklinkDto` 加 `Kind`/`MarkId`；mark 來源前端以 `?mark=` 深連結跳回來源段落。**EntityLink 採雙向**（哪端是 Source 只是建立當下開著哪頁的巧合，單向會重演「建了看不見」）；三來源一律**排除自我參照**；**Detached 的 mark 照樣列出**（關聯沒失效，只是定位失效——降級顯示屬段落關聯包）。排序＝Kind 權重（wiki=0、mark=1、entity=2）再標題，標題比較用 **StringComparer.Ordinal**（dev zh-TW 與 prod invariant 文化不同，culture-aware 排序跨環境不一致——實測 ICU 下「乙<甲」與天干直覺相反）。
- **記錄的 TODO**：backlinks 無 Take 上限（可比照 ActivityLog Take(200)）；`?mark=` 跳轉的 300ms 寫死時序與斷錨無提示 → 段落關聯包一併處理；NoteWriteEndpoints God file 待拆。

## 2026-07-31 ｜ 筆記 URL 改版：slug 連動現行標題＋NoteSlugAlias 永久別名＋消歧異頁

- **背景**：slug 原為「建立時由標題產生、永不變」——改標題後 URL 停留舊名。使用者要求：URL 反映現在標題，且舊 URL（如存在 LINE 備忘錄的連結）永遠有效並指向原篇。三驗收情境：①手打新標題 URL 能通；②舊存 URL 永遠指原篇；③名字被新篇取用後兩邊皆可達。
- **考慮過的選項**：①slug 永凍（現狀）；②GUID 進 URL（醜但零歧義）；③slug 連動＋alias「先佔永久保留」（名字不可重用）；④slug 連動＋alias＋名字可重用＋消歧異頁。
- **最終決定**：④（③曾短暫定案，被情境③推翻——使用者要「改成舊名的新篇也能被該名字找到」，而②③無法同時滿足情境②）。規則：改名以 GenerateSlug 重產 slug（撞「活 slug」加 -2 序號；撞 alias 不加——名字可重用）；舊 slug 寫入 `NoteSlugAlias`（唯一鍵 (UserId,Slug,NoteId)，同名多任前屋主各留一筆）；改回舊名自我收斂。解析：**GUID 直達 → 活 slug → alias**，候選去重後唯一直達（alias 命中附「舊網址」橫幅、不強制轉址）、多個進**消歧異頁**（Wikipedia 模式）、零則 404。
- **關鍵防呆（計畫對抗式復審揪出）**：「自身操作不得落入消歧異」——改名/複製存檔後以回應本體渲染＋已知 id 的重抓一律走 GUID 直達，否則改名撞歷史 alias 時，使用者剛存完檔會被導進消歧異頁看不到自己的筆記。
- **業界對照**：Wikipedia（redirect＋消歧義頁）＝本方案原型；GitHub repo 改名重用即默默劫持（repojacking）＝反面教材；Stack Overflow/Notion 的 id-in-URL＝我們以「GUID 直達」吸收其零歧義優點而不犧牲純標題 URL。

## 2026-07-31 ｜ 段落級關聯＋錨點保護：瀏覽器為唯一座標系（後端不做 reAnchor/Detached 判定）

- **背景**：關聯要能指到「目標筆記的某個段落」（NoteMark 加 TargetMarkId、目標端以 kind="anchor" 純錨點錨定）；且「編輯到被引用的段落」要在存檔時提醒（使用者 1~100 例子）。原計畫由後端在存檔時以 C# 移植 reAnchor 重算 Detached——對抗式復審揪出 CRITICAL：mark 座標系是「瀏覽器對 Markdig HTML 的 textContent」，repo 無 HTML parser、編輯預覽（react-markdown）又是第三套渲染，後端重建純文字必然座標分歧，整個安全網會假陰性失效。
- **最終決定（v2）**：**瀏覽器為唯一座標系**。①新 `POST /api/notes/render` 純轉換 dry-run（掛輕量限流；僅存檔動作觸發、非逐鍵）；②存檔攔截在前端：舊文字＝手上 note.contentHtml 注入 detached DOM 讀 textContent、新文字＝dry-run 結果同法，以既有 textAnchor.reAnchor 原碼預跑——「原本」基準＝**即時重算舊內容**，絕不讀 DB 存量 Detached（滯後污染會把舊帳誤植為本次破壞）；③Detached 由前端回寫（每次真實渲染重錨定，found 與存值不一致即 PATCH，帶 contentHash 防過期覆蓋＋markId 去重防風暴）。
- **記錄的取捨**：Detached 信任模型＝前端為權威（僅影響自身資料的顯示狀態）；「最終一致」的前提是「最終有人用瀏覽器開過該筆記」——純 PAT 寫入、從未在瀏覽器開啟的筆記永不校正；編輯模式「N 處被引用」提示同受此滯後；`?mark=` 跳轉退化是即時 DOM 查找、不受滯後影響。anchor 孤兒：刪 link 連動軟刪無主 anchor（判斷 join 來源筆記 ValidFlag，殭屍 link 不撐住錨點）、複製引用以同段文字（anchorText）去重（不用位移——前文一經編輯位移即漂）。jsdom 單元測試與 E2E 共用同一份 fixtures（frontend/src/lib/__fixtures__/anchorFixtures.ts；其 HTML 為後端 RenderToHtml 的實際輸出快照，含 Markdig 自動 heading id），確保「jsdom==瀏覽器 textContent」主張真的被驗證（E2E 另對真後端 render API 斷言 fixture 相等，核對自動化——快照漂移時 E2E 會抓到）。

## 2026-08-06 ｜ 便利貼/圖片板 top bar：以「位移閾值死區」讓同一條標題列同時支援點擊收合與拖曳移動

- **背景**：便利貼標題列原本只有「按住拖曳移動」，收合/展開必須精準點右上角的 ＋/－ 小鈕（16px 級目標）。使用者要求點標題列任一處即可收合/展開，且不可影響既有的 ＋/－ 鈕與拖曳。
- **考慮過的選項**：①雙擊收合（與拖曳零衝突，但不符「點一下」的要求、且雙擊在觸控上判定慢）；②在 pointerup 比對座標是否完全相等（0 容忍，滑鼠微晃或觸控手指抖動就會判成拖曳，實務上點不到）；③位移閾值死區——未超過閾值視為點擊、超過才進入拖曳（業界慣例，dnd-kit 的 activation constraint 同一套）。
- **最終決定**：③。抽出純函式 `frontend/src/lib/overlayDragClick.ts` 的 `createDragClickTracker`，由 NoteOverlay（筆記浮層）與 CanvasAnnotationLayer（開問啦畫布）兩處 startDrag 共用。閾值 8px，沿用本專案既有拖曳把手慣例（SubtaskChecklist 的拖曳排序），桌機與觸控皆適用。
- **關鍵取捨與防呆**：
  - **tracker 必須每次 pointerdown 新建**（閉包狀態只活一個手勢）。若提升為模組層級單例，第一次拖曳後所有點擊都會被永久誤判為拖曳——單元測試與 E2E 各有一條案例把這個退化鎖住。
  - **死區只套 `mode === 'move'`（標題列）**，resize 把手不套。對抗式復審用 Playwright 逐像素插樁實測，證實一開始「不分 mode 套死區」的版本會讓縮放起手 6px 完全不跟手、第 7px 瞬間跳 8px；resize 沒有點擊語意，不需要死區。resize 改以「尺寸與起始值相同就不發 PATCH」達成「點一下把手不動作」。
  - **畫布版（有 zoom）餵 tracker 的是「除以 zoom 之前」的螢幕位移**，讓點擊容忍度不隨縮放改變（否則 zoom=0.5 時要移動 16 螢幕像素才算拖曳）。
  - **點擊路徑不持久化座標、不重建錨點**：位置沒變，發 PATCH 與重算錨點都只會製造無意義寫入與錨點飄移。
  - 收合狀態沿用既有設計「每次打開筆記全收合、不記憶展開狀態」（NoteOverlay 載入時把所有 sticky/slide 塞進 collapsedIds），新手勢走同一個 toggleCollapse，行為一致。
- **驗證**：13 個單元測試（含閾值邊界、跨實例污染、浮點次像素）；Playwright 實測筆記端 14 例、畫布端 6 例全通過，涵蓋死區、拖曳不誤判、先拖後點、＋/－ 鈕、標題編輯、📌 鈕、pinned 拖曳持久化、resize 逐像素跟手與持久化、暗色主題、375px 手機寬度，console 零錯誤。

## 2026-08-10 ｜ 浮層工具列快捷鍵：沿用單鍵系統＋數字選工具＋鍵盤路徑不展開工具箱

- **背景**：使用者要為筆記右下角浮層工具列（DrawingToolbar，筆記閱覽頁與開問啦畫布共用）設快捷鍵，要求避開瀏覽器預設行為與既有站內快捷鍵，且只在筆記閱覽頁與畫布生效（首頁／Todo／編輯頁不生效）。
- **考慮過的選項**：①帶修飾鍵組合（Ctrl+Shift+X／Alt+X）——瀏覽器地雷多（Ctrl+T/N/W 攔不到、Alt 是選單存取鍵），且要放寬既有 Runtime 的修飾鍵守門；②連續鍵 chord（g 然後 t）——複雜度不成比例；③沿用既有 shortcuts.ts 無修飾單鍵系統，新增 overlay scope——瀏覽器對主內容區的無修飾字母/數字鍵沒有預設行為，且免費繼承可改鍵、衝突偵測、跨裝置同步、設定頁 UI。
- **最終決定**：③。數字鍵照工具列「視覺順序」由上而下、由左而右排（Excalidraw 同款心智模型）；英文字首字母 c 目錄（僅筆記）、s 便利貼、i 圖片板。刻意**不配鍵**：結束繪圖（滑鼠右鍵已有）、清除全部（破壞性防誤觸）、儲存快照與歸位（低頻）。
- **v2 版面與鍵位（2026-08-10 當日修訂，使用者裁示）**：初版鍵帽提示使原三列版面跑版（「儲存」被拆字、列數爆增），改為四列——Row1 文字框T｜＋便利貼｜＋圖片板／Row2 畫筆|螢光筆|直線|矩形|橢圓／Row3 三橡皮擦|清除全部／Row4 目錄|歸位|儲存（歸位自情境列移入常駐列）。鍵位隨視覺順序重編：**1 文字框、2 畫筆、3 螢光筆、4 直線、5 矩形、6 橢圓、7/8/9 橡皮擦**；s/i/c 不變。
- **關鍵取捨與防呆**：
  - **生效範圍靠「監聽者掛載與否」而非路徑白名單**：Runtime 在 /notes 與 /canvas 派發事件；執行者（NoteOverlay／CanvasAnnotationLayer）只在閱覽預覽分頁／畫布掛載，編輯頁、編輯彈窗（此時 NoteOverlay 整個卸載）天然不生效。
  - **畫布 addTextBox 既有副作用會 setToolbarOpen(true)**（讓文字屬性面板可見）；鍵盤路徑參數化跳過展開（裁示：收合時按鍵「不展開但執行」）。代價＝鍵盤新增文字框時屬性面板不可見，屬明知的取捨。
  - **動作→指令對應表單一事實來源**（lib/overlayShortcutCommands.ts），兩端共用；完備性由單元測試鎖住（新增動作忘了接會紅）。
  - 監聽器以 ref 鏡像動作、add/remove 對稱——addSticky 等打後端 API 非幂等，重複註冊會「按一次建兩個」，E2E 以「恰好 +1」鎖住。
  - Shift 不在排除清單（既有行為）：Shift+S 仍觸發；以單元測試 B5b 留底，防止後人誤以為有排除而改壞。
  - 設定頁 scopes 陣列原寫死 ["global","tasks"]（notes 的 A 鍵一直沒列出＝既有缺口），本次一併補全四區。
- **對抗式復審修正（合併前已修）**：①HIGH——OS 按鍵自動重複（長按）會對非幂等 API 連發、狂建便利貼；Runtime 開頭加 `event.repeat` 過濾（一鍵一動作），單元 B9＋E2E repeat 連發案例鎖住。②MEDIUM——鍵帽提示使 Row1 CJK 標籤（「儲存」）被逐字拆行；改「整顆按鈕為單位換行（wrap）＋按鈕內 nowrap」。
- **驗證**：單元 30 例（鍵位規格、跨/同 scope 衝突、Runtime 派發矩陣含 repeat 過濾、對應完備性、鍵帽 hook 改鍵更新）；Playwright 對 production build 實測 20 例全過（含收合態啟用、編輯頁/編輯彈窗不觸發、畫布工具箱關閉按「1 文字框」不展開、改鍵後提示即時更新、repeat 連發不觸發、各列單行不斷行）；鍵帽提示對比實測 warmpaper 5.21:1、dark 5.62:1（≥4.5 AA）。v2 版面改版後全部重驗仍 20/20。

## 2026-08-10 ｜ VS 風格滑鼠側鍵錨點導航：側鍵在「點擊下錨」堆疊穿梭、取代瀏覽器歷史

- **背景**：使用者羨慕 Visual Studio 的滑鼠上/下一頁——按的不是瀏覽器歷史，而是「游標位置堆疊」（go-back markers）在錨點間穿梭。經查證 VS 機制確為此（View.NavigateBackward/Forward，游標大幅移動即自動留標記）；要求把同一套心智模型帶進 ZonWiki。
- **技術可行性（先實測後動工）**：文獻對「網頁能否攔下滑鼠側鍵的歷史導航」無定論，遂以 Playwright＋CDP（`Input.dispatchMouseEvent` button back/forward＝真側鍵）對 Chromium 151 做位元組級實測：**preventDefault `pointerup` 或 `mouseup` 任一即可攔下**；`mousedown`/`pointerdown`/`auxclick` 單獨攔無效；且攔 `pointerdown` 會使相容性 mouse 事件整組消失。故以 pointerup 為行動點、mouseup/auxclick 作保險絲。Firefox（Windows）在 chrome 層處理側鍵、頁面看不到——明知的邊界，使用者用 Chrome。
- **考慮過的選項**：①攔 popstate 玩瀏覽器歷史（會與 App Router 打架且污染真歷史）；②只做「筆記情境返回堆疊」的擴充（noteNav.ts 已有，但只有路由、無捲動位置、無 forward、與側鍵無關）；③獨立錨點堆疊＋全域事件執行器——選 ③，noteNav 原樣保留（返回鈕語意不同：只在筆記情境內移動）。
- **設計**：錨點＝route（pathname+search）＋捲動位置。左鍵 pointerdown 下錨、路由（含 search-only）變更下錨；同 route 且捲動差 ≤120px 原地更新（類 VS「移動 11 行才留標記」）、否則 push＋截斷 forward 分支；上限 50、存 sessionStorage（分頁隔離，比照 noteNav）。**堆疊不可移動時不攔**——側鍵交還瀏覽器原生歷史，堆疊見底仍可離站。捲動容器：筆記閱覽頁＝.note-detail-page、其餘＝.main-content；還原多次重試（0/150/400/900ms，晚於筆記頁 250ms 續讀、錨點優先）、每次重新 querySelector（內文重掛也有效）、使用者輸入即取消。跨路由先過 confirmNavigation()（筆記未存守門），拒絕零副作用。
- **測試計畫審查修正（tdd-guide sub-agent，動工前）**：①核心洞——goBack/goForward 若重用 recordAnchor 的 push 判斷，深捲 >120px 後按上一頁會被誤判成新錨點→「回同頁頂端＋砍前進歷史」；改為獨立的 syncLivePosition **永遠原地覆寫**。②不可移動時保證零副作用。③route 必須含 search（usePathname 不含 query——/tasks 換視圖、/search 換條件都是 search-only 變更），useSearchParams 需包 Suspense。④連按競態→in-flight 旗標吞連按。⑤保險絲旗標 per-press 生命週期（pointerup 先於 mouseup/auxclick 必然先覆寫）。
- **對抗式復審修正（code-reviewer sub-agent，合併前已修）**：HIGH——confirmNavigation 鏈無 .catch、安全逾時排在 push 之後：守門 reject 或 push 同步拋錯會讓 in-flight 旗標永久卡死、側鍵整個 session 靜默失效。修法：安全逾時在設旗標當下排程、push 包 try/catch 且**成功才 commit 堆疊**（失敗下次可重試）、整鏈補 .catch；R11/R12 回歸鎖。其餘 8 項疑點（StrictMode 雙掛載、監聽器洩漏、與筆記頁 capture click／便利貼死區／畫布中右鍵平移的互動、sessionStorage 分頁隔離等）復審實測全過。
- **明知的取捨**：只攔「滑鼠側鍵」一種輸入——鍵盤 Alt+←/→ 與觸控板手勢仍走瀏覽器原生歷史（不經堆疊也不經守門）；開問啦畫布位置＝viewport 平移非捲動，錨點只還原路由不還原視角（畫布自有 viewport 持久化）；觸控點擊也會下錨（無側鍵可用，僅多些去重後的 sessionStorage 寫入）。
- **驗證**：單元 36 例（純邏輯 24＋Runtime 12）全綠；Playwright 對 production 實例以 CDP 真側鍵實測：同頁錨點往返（URL 不變＝未被瀏覽器歷史劫持）、跨頁返回＋捲動還原 5000px、堆疊見底交還瀏覽器（回 about:blank）、console 零錯誤，截圖存 zonwiki-ui-tests/2026-08-10-mouse-nav/。

## 2026-08-13 ｜ 歷史時間窗合併＋筆記 UX 六包（就地改分類、拖曳三選一、下拉排序、表格加行、防停電草稿）

- **背景**：使用者發現「工作日記」這類每天編輯的筆記歷史紀錄爆量。實查根因：閱讀模式就地互動（表格勾選/直編/程式碼區塊改名）每一下都是零 debounce 的完整 PUT，而 NoteRevisionInterceptor 對任何 Title/ContentRaw 變更無條件寫全文快照、無合併無 retention。使用者同時裁示四項分類/表格 UX 與「防停電本地草稿」。
- **時間窗合併的關鍵裁量**：
  - 窗長 10 分鐘、**錨定最新版的 CreatedDateTime**（非滑動窗）：鏈最長 10 分鐘必斷，保證「每 10 分鐘至少一個救援點」。滑動窗（錨 UpdatedDateTime）被對抗復審否決——連續編輯數小時會收斂成單一版本，與版本系統「防覆寫救援」的存在理由衝突。
  - 合併條件：本次與最新版皆為 update、ValidFlag=true、同 actor、**有 HTTP 脈絡（CurrentUserId 非空）**。最後一條是復審 CRITICAL：背景服務（AI 精煉/框選提問）與使用者共用同一個 actor GUID，若允許合併，AI 覆寫會吃掉使用者手動版本的救援點——背景寫入永遠新列。
  - **已知殘餘風險**：背景寫的版本列與手動列無欄位可區分，其後 10 分鐘內的手動編輯會把「背景寫入當下」的快照併掉（前一版仍在，損失有限）。不為此加 schema 欄位（本輪無 migration）。
  - 契約演進：原「任何變更都留版本」（NoteRevisionHttpTests 檔頭）修正為「窗內連續小改動＝同一次編輯」；ConcurrentPuts 尾段斷言隨之改為合併語意。
  - 就地覆寫用「追蹤查詢＋顯式 IsModified 恰 4 欄」：攔截器位於鏈尾不可靠 DetectChanges；整列標 Modified 會把未載入欄位寫成預設值。
  - DTO 補 UpdatedDateTime、前端時間軸排序/分組改吃它（復審 H4：合併後 createdDateTime 停在鏈首、內容卻是鏈尾，沿用舊鍵會整天錯位）。
  - **本輪刻意不做**：歷史端點瘦身/分頁、retention（使用者未點名；retention 另有「孤兒附件掃描器拿 NoteRevision.ContentRaw 判引用」與「垃圾桶型別表」兩個耦合，需獨立裁示）。
- **分類下拉排序**：後端 OrderBy(SortOrder).ThenBy(Name) 在「SortOrder 每層各自 0,1,2…且大多為 0」的資料下，扁平下拉體感隨機（實查：68/82 個分類 SortOrder=0，排過序的層反被推到末端）。裁示「按字串大小由小到大」＝**codepoint 排序（非注音/筆畫）**，以「完整路徑字串」排——路徑前綴天然把子分類聚在父分類後。共用 util（lib/categoryOptions.ts，含防環）取代 4 處重複私有實作；側欄樹/搜尋頁不動（側欄是手動排序 UI）。
- **拖曳筆記到分類**：由「靜默附加」改為三選一（增加/切換/取消）。「增加」沿用冪等原子的單加端點（不改走整組取代——避免讀-改-寫競態）；「切換」drop 當下重抓筆記詳情取最新分類集合再整組取代。來源分類以**第二個 MIME** 攜帶（舊 payload 純 noteId 向後相容）；清單頁卡片拖入無來源→「切換」語意退化為「取代全部分類」（選項文案明示）。拖回原分類→toast 不彈窗。
- **閱讀模式 ✎ 就地改分類/標籤**：走既有的 PUT /categories、/tags 獨立端點（不動內容、不產生版本、無 409）；缺的只是前端 wrapper 與 UI。絕不可改走 PUT /api/notes/{id} 整包更新。
- **表格「＋ 新增一行」**：純文字層定位「真表格區塊」（必須有分隔列；blockquote 前綴重建；CRLF 照 tableSpec 慣例），插入空列走既有 applyReadingEdit 管線。排序/篩選作用中語意固定「追加到原文表尾」。觸控裝置鈕常駐顯示。
- **防停電本地草稿**（筆記編輯頁/新增筆記彈窗/任務編輯彈窗）：localStorage 同步落地、使用者輸入 debounce 800ms、beforeunload 同步 flush；**進入編輯當下先讀走既有草稿再開放寫入**（復審 H5：程式化 setEditContent——進入編輯/409 重載/AI 覆寫——絕不可覆寫草稿，否則橫幅還原到的是被蓋掉的內容）；存檔成功或明確放棄才清；7 天過期自動清理。已知限制：同筆記雙分頁互踩（後寫贏）。
- **驗證**：後端 NoteRevisionHttpTests 20/20（新增 6 案例＋既有回歸鎖）；前端 vitest 390/390（新增 categoryOptions/tableRowInsert/draftBackup/categoryDrop/historyGrouping/NoteMetaQuickEdit/ChoiceDialog 共 47 例）；tsc 零錯誤；production build 過；Playwright 實測見 PR 說明。
- **二輪對抗復審修正（合併前已修，0C/2H/3M/2L）**：
  - **H1**：條件 (e) 原判 `CurrentUserId != Guid.Empty` 實際失效——所有背景 AI 流程都會 `SetCurrentUserId` 冒用使用者以通過隔離過濾。改為同時排除覆寫脈絡（`IsUserContextOverridden`），並補「真實背景慣例（SetCurrentUserId＋改內容）」整合測試取代裸 DbContext 的假信心測試。
  - **H2**：本頁站內切換筆記不 remount、isEditing 不重設 → 草稿 writer 綁舊筆記鍵造成跨筆記污染（B 的輸入寫進 A 的草稿、還原時資料錯置）。草稿 effect 相依補 `note?.id`。
  - **M**：歷史「按天摺疊」手動狀態改為換筆記時重設（day 鍵跨筆記共用同一天）；表格加行鈕改插在 `.md-table-wrap` 橫捲容器「外面」（寬表橫捲時鈕不消失）；✎ 面板「分類成功、標籤失敗」時以 onSaved(分類=新, 標籤=原值) 回報部分成功（避免畫面與伺服器不同步），面板留著供重試。
  - **已知取捨（記錄不修）**：①合併會抹掉窗內中繼版本——若附件只在同一 10 分鐘窗內「貼上又移除」，其唯一歷史引用會消失、寬限期後被孤兒掃描器軟刪（命中條件窄、軟刪可救，接受）；②✎ 面板無點外關閉（Esc/取消/儲存可關）；③加行鈕插入會多觸發一次無害的 MutationObserver 重掃（已驗證非無限迴圈）。
