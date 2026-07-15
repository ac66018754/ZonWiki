# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。

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
