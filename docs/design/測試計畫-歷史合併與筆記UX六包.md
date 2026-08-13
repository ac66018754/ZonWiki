# 測試計畫：歷史時間窗合併＋筆記 UX 六包

> 分支：`feat/history-coalesce-and-note-ux`（worktree `D:\Repos\zw-ux`，基於 main 1366fd9）
> 使用者裁示（2026-08-13）：①時間窗合併＋歷史 UI 按天分組；②瀏覽頁就地改分類/標籤；
> ③拖曳筆記到分類跳「切換/增加」提示；④分類下拉按字串由小到大排；⑤表格「新增一行」鈕；
> ⑥編輯頁/新筆記/任務的本地草稿備份（防停電）。歷史端點瘦身**本輪不做**（使用者未點名）。

---

## 包1：NoteRevision 時間窗合併（後端）＋歷史 UI 按天分組（前端）

### A. 設計
- **合併規則**（NoteRevisionInterceptor）：本次變更為 `update`，且該筆記「現存最新一版」滿足
  （a) ChangeKind == "update"；(b) ValidFlag == true；(c) UpdatedUser == 本次 actor；
  (d) now − UpdatedDateTime < **10 分鐘**（滑動窗）→ **就地覆寫最新版**
  （Title/ContentRaw/UpdatedDateTime/UpdatedUser），不新增列。其餘情況照舊新增。
- create / delete **永不合併**（保留「建立當下」與「刪除當下」快照）；update 也不併進 create
  （首版是誤刪救援的底）。
- 實作：`CaptureRevisionsAsync/Sync` 的批次查詢從 `Max(RevisionNo)` 擴充為「每筆記最新一版的
  {Id, RevisionNo, ChangeKind, UpdatedDateTime, UpdatedUser, ValidFlag}」；合併路徑用
  `db.Attach(stub)` + 逐屬性賦值（只 UPDATE 有變欄位，與本次 SaveChanges 同交易）。
  嚴禁 ExecuteUpdate（不同交易、繞攔截器鐵則）。
- 視窗常數 `CoalesceWindow = TimeSpan.FromMinutes(10)`，`internal const` 供測試引用。
- 時間控制：不注入時鐘；測試以「直接改既有版本列的 UpdatedDateTime 為 11 分鐘前」製造窗外。
- **UI 按天分組**（NoteEditHistory）：合併時間軸依「裝置時區的日期」分組，組頭顯示
  `YYYY-MM-DD（N 筆）`，可點擊摺疊/展開；預設**最新一天展開、其餘摺疊**。

### B. 後端測試（NoteRevisionHttpTests 增補；沿用既有整合測試基礎）
| # | 情境 | 預期 |
|---|---|---|
| R1 | 同 actor 連續兩次 PUT 內容（間隔 < 窗） | 只有 1 筆 update；ContentRaw=第二次內容；UpdatedDateTime 前進；RevisionNo 不變 |
| R2 | 兩次 PUT，中間把該版 UpdatedDateTime 改成 11 分鐘前 | 2 筆 update（窗外不合併） |
| R3 | 不同 actor（另一 PAT/使用者）接續 PUT | 不合併，新列 |
| R4 | create 後立即 PUT | create 保留原始內容 + 新增 1 筆 update（不併進 create） |
| R5 | update 後軟刪除 | delete 獨立成列（不併）；還原後再 PUT → 又是新列（最新版是 delete，不滿足 (a)） |
| R6 | 最新版 ValidFlag=false（被軟刪的版本列）時 PUT | 不合併，新增列且序號 = 全表 Max+1（既有取號規則不變） |
| R7 | 合併後再等窗外 PUT | 新列 RevisionNo = 舊 Max+1（無跳號/撞號） |
| R8 | 只改 Title（窗內） | 併入最新版（Title 更新） |
| R9 | 既有測試全綠 | SameValueUpdate/CategoryOnly/ConcurrentPuts/SoftDeletedRevisionRow 等回歸鎖不破 |
| R10 | 併發兩 PUT 同 baseVersion（既有 ConcurrentPuts 測試語意） | 勝者行為與現行斷言相容（必要時更新斷言並註記理由） |

### C. 前端測試（vitest：NoteEditHistory 分組）
| # | 情境 | 預期 |
|---|---|---|
| G1 | 三天各 2 筆的合併時間軸 | 3 個組頭、各標 (2)；最新天展開、其餘摺疊 |
| G2 | 點組頭 | 摺疊/展開切換 |
| G3 | UTC 時間跨日（裝置時區 +08:00） | 以本地日期分組（23:00Z 於 +8 屬翌日） |
| G4 | 空清單 | 維持既有空狀態文案 |

---

## 包2：瀏覽頁就地改分類/標籤（前端；後端零改動）

### A. 設計
- 新 API wrapper（`lib/api/`）：`setNoteCategories(noteId, ids)` → `PUT /api/notes/{id}/categories`
  （body=GUID 陣列本身）；`setNoteTags(noteId, ids)` → `PUT /api/notes/{id}/tags`。
- 閱讀模式分類/標籤列尾加 ✎ 鈕 → 就地 popover：兩個 `SearchableMultiSelect`
  （分類選項走包3共用排序；支援既有的就地新增）＋「儲存/取消」。儲存打上述端點
  （不動 contentRaw、不產生 NoteRevision、無 409），成功後更新本地 note 狀態＋SWR 失效。
- 亮暗雙主題、WCAG AA、手機寬度不爆版（uiux 硬規則）。

### B. 測試
| # | 情境 | 預期 |
|---|---|---|
| C1 | vitest：popover 開啟→改選→儲存 | 只呼叫 categories/tags 端點；**絕不**呼叫 `PUT /api/notes/{id}` |
| C2 | vitest：儲存失敗（500） | toast 錯誤、選取還原、popover 不關 |
| C3 | vitest：取消 | 不打 API、還原選取 |
| C4 | E2E：閱讀模式加一個分類＋一個標籤 | chip 立即更新；重新整理仍在；歷史分頁**無新版本** |

---

## 包3：分類下拉排序＋共用 categoryPath（前端）

### A. 設計
- 新共用 util `lib/categoryOptions.ts`：`buildCategoryOptions(categories)` →
  `{id, name(完整路徑「父 / 子」)}[]`，**防環**（visited set，環成員退化為自身名），
  依 name **字串由小到大**（codepoint 比較，使用者明示）排序。
- 取代 4 處重複實作：notes 編輯頁、edit-popout、NoteCreateModal、NotesBatchToolbar
  （包2 的新 popover 也用它）。側欄樹/搜尋頁**不動**（使用者未點名，行為不同屬）。

### B. 測試（vitest：categoryOptions.test.ts）
| # | 情境 | 預期 |
|---|---|---|
| S1 | 亂序輸入（中文/英文/數字前綴混合） | 輸出按路徑字串 codepoint 升冪 |
| S2 | 子分類 | name 為「父 / 子」，且因前綴排序自然聚在父後 |
| S3 | 三層鏈 | 路徑完整「祖 / 父 / 子」 |
| S4 | parentId 指向不存在 | 視為根（不 throw） |
| S5 | 環（A→B→A） | 不無限迴圈；環成員以自身名輸出 |
| S6 | 四個使用點皆改用共用函式 | 各檔 grep 無殘留私有 categoryPath/catName/catLabel（重構驗證） |

---

## 包4：拖曳筆記到分類的「切換/增加」提示（前端）

### A. 設計
- Confirm 系統新增 `ChoiceDialog`＋`useChoice`（N 鈕、Promise<string|null>，Esc/背景=null），
  沿用 modal 樣式與焦點陷阱；不動既有 `useConfirm` API。
- 拖曳 payload 擴充：側欄 NoteRow 帶 `sourceCategoryId`（所在 CategoryNode 的 id）；
  筆記清單頁卡片無來源（維持只帶 noteId；舊格式 payload 相容）。
- drop 處理：
  - target == source → toast「已在此分類」，不彈窗。
  - 有來源：選項＝「增加分類（保留原分類）」「切換分類（移出「{來源名}」）」「取消」。
    切換＝讀該筆記現有分類集合 − source ＋ target → `setNoteCategories`（包2 wrapper）。
  - 無來源（清單頁卡片）：選項＝「增加分類」「切換分類（取代全部分類）」「取消」。
- 純函式 `computeDropCategoryIds(current, source, target, mode)` 抽出可測。

### B. 測試
| # | 情境 | 預期 |
|---|---|---|
| D1 | vitest：computeDropCategoryIds add/switch（有/無 source、target 已存在、source==target） | 集合正確、冪等、不重複 |
| D2 | vitest：ChoiceDialog | 三鈕渲染、點選 resolve 對應 key、Esc resolve null |
| D3 | E2E：側欄拖筆記到另一分類→選「切換」 | 原分類消失該筆記、新分類出現；歷史無新版本 |
| D4 | E2E：選「增加」 | 兩個分類都有 |
| D5 | E2E：拖到自己所在分類 | toast、無變更 |

---

## 包5：表格「新增一行」按鈕（前端）

### A. 設計
- 純函式 `appendEmptyTableRow(content, anchorMdLine)`（新檔 `lib/tableRowInsert.ts`）：
  以 anchorMdLine（該表任一資料列的 data-md-line）定位所屬**連續表格區塊**（沿用
  `splitTableRowLine` 判準＋圍欄狀態機），取欄數（以分隔列 cells 數為準），在區塊最後一列後
  插入 `|  |  | …` 空列；找不到合法區塊回 null（呼叫端 toast）。
- `ReadingTableInteractions` 加 `insertRow(anchorMdLine): Promise<boolean>`；
  enhanceReadingTables 在互動表格（有寫回介面且任一列有 data-md-line）掛「＋ 新增一行」鈕
  （表格下方、hover 才現形、雙主題可讀）；排序/篩選作用中照常可按（語意＝追加到原文表尾）。
- page.tsx 以 `applyReadingEdit((base) => appendEmptyTableRow(base, anchorMdLine))` 接線。
- 與隔壁棚衝突面控制：readingTableInteractive.ts 只做**新增式**修改（新掛鈕），不動 openCellEditor。

### B. 測試（vitest：tableRowInsert.test.ts＋整合）
| # | 情境 | 預期 |
|---|---|---|
| T1 | 標準 3 欄表、anchor=中間列 | 在最後一列後插入 3 欄空列 |
| T2 | 表格後緊接段落 | 插入位置在表格最後列與段落之間 |
| T3 | 圍欄內的偽表格行 | 回 null |
| T4 | anchor 行非表格列 | 回 null |
| T5 | 含跳脫管線 `\|` 的列 | 欄數以分隔列為準、插入正確 |
| T6 | 檔尾無換行的表格 | 插入後結尾正確（無黏行） |
| T7 | CRLF 行尾 | 保守：該表回 null（與 br 視圖層同款保守策略）或正確處理（擇一，實作時定案並鎖測試） |
| T8 | E2E：讀模式按鈕→新空列出現 | 可立即雙右鍵直編；DB 原文多一行空列；歷史+1 筆（屬正常 update） |

---

## 包6：本地草稿備份（防停電；前端）

### A. 設計
- 新 lib `lib/draftBackup.ts`（localStorage）：
  - key：`zw:draft:note:{id}`／`zw:draft:note:new`／`zw:draft:task:{id}`／`zw:draft:task:new`。
  - 值：`{ title, content, savedAt(ISO), baseUpdatedAt? }`；`saveDraft` 由呼叫端 debounce
    （800ms）；`setItem` 包 try/catch（QuotaExceeded 靜默跳過＋單次 console.warn）。
  - `loadDraft` 順手清理 7 天以上的過期草稿（掃 `zw:draft:` 前綴）。
- 接線：
  - 筆記編輯模式（page.tsx）：編輯中每次 title/content 變更 debounce 寫入；**儲存成功**與
    **明確放棄**（confirm 後離開）→ `clearDraft`。進入編輯模式時：存在草稿且
    `draft.content !== 現行內容` → 編輯器上方顯示還原橫幅「⚡ 偵測到 N 分鐘前的未儲存草稿」
    ［還原］［捨棄］（非 modal、不擋輸入）。
  - NoteCreateModal：`note:new` 同款；建立成功/明確關閉並確認放棄 → 清。
  - TaskEditorModal：`task:{id}`／`task:new` 同款（標題+內容欄）。
- 多分頁同筆記互踩＝已知限制（後寫贏），文件化。

### B. 測試
| # | 情境 | 預期 |
|---|---|---|
| B1 | vitest：save/load/clear round-trip | 型別完整、savedAt 正確 |
| B2 | vitest：過期清理 | 8 天前的草稿被清、新的保留 |
| B3 | vitest：QuotaExceeded（mock setItem throw） | 不炸、靜默 |
| B4 | vitest：還原橫幅邏輯 | 草稿==現行內容→不顯示；不同→顯示；按還原→內容進編輯器；按捨棄→清草稿 |
| B5 | E2E：編輯打字→**直接關頁重開**→再進編輯 | 橫幅出現、還原後文字完整（核心防停電場景） |
| B6 | E2E：正常儲存後再進編輯 | 無橫幅（草稿已清） |
| B7 | E2E：新增筆記彈窗打字→關閉重開 | 草稿還原 |

---

## v2 修訂（2026-08-13 對抗式復審結論，全數採納）

- **C1（測試回溯手法）**：R2 等「把版本列時間改到窗外」一律用 raw SQL
  `ExecuteSqlInterpolatedAsync`（欄名 `NoteRevision_UpdatedDateTime`/`_CreatedDateTime`）——
  稽核攔截器會把 EF 路徑的 Modified 蓋回 now（AuditingSaveChangesInterceptor.cs:64-67）。
- **C2（背景寫入不合併）**：合併條件加 (e) `db.CurrentUserId != Guid.Empty`——背景服務
  （AI 精煉/框選提問）寫入永遠新列，不吃掉使用者手動版本。殘餘風險（背景寫的列被其後
  10 分鐘內的手動編輯併掉）記入 DECISIONS.md，不加 schema 欄位（本輪不做 migration）。
  新增測試 R11：背景寫入（無 HTTP 脈絡）接在手動 update 後 → 不合併。
- **H1**：R3 改「另一『使用者』」；新增 R12「同使用者另一 PAT → 仍合併（actor=使用者 GUID）」鎖語意。
- **H2（窗錨點）**：窗錨定「最新版 **CreatedDateTime**」（合併只前進 UpdatedDateTime）→
  鏈最長 10 分鐘必斷、保證每 10 分鐘至少一個救援點。滑動窗（永不斷鏈）棄用。
- **H3**：ConcurrentPuts 尾段（retry）斷言改為合併語意：仍 2 筆、RevisionNo=2、內容=重試成功。
  R9 的「不破」清單移除 ConcurrentPuts（其餘 12 個既有測試逐一推演維持綠燈）。
- **H4（時間軸錯位）**：包1 範圍納入「NoteRevisionDto 加 `updatedDateTime`＋NoteEditHistory
  的 revision 條目 at/排序/分組全改用 updatedDateTime」。R 系列加斷言 updatedDateTime 前進；
  G 系列加「created 昨天、updated 今天 → 歸今天」。
- **H5（草稿自毀）**：進入編輯模式**當下先把既有草稿快照進 ref**再掛橫幅；debounce 寫入
  只在「首次真實使用者輸入」後啟動（程式化 setEditContent——進入編輯、409 重載、AI 覆寫——
  不得覆寫草稿）。另在 beforeunload 同步 flush 草稿（補 debounce 空窗；M7）。
- **M1**：合併寫回用「先查 `db.NoteRevision.Local` → 無則 Attach stub」，賦值後**顯式**
  `IsModified = true` 恰好 4 欄（Title/ContentRaw/UpdatedDateTime/UpdatedUser）；
  批次查詢維持 `IgnoreQueryFilters()`。
- **M2**：拖曳「增加」**沿用** `addNoteToCategory`（冪等原子）；「切換」才走整組取代，
  且 drop 當下先 `getNoteById` 重抓最新分類集合（不用 SWR 快取）。
- **M3**：標籤沿用既有 `updateNoteTags`（不新造 wrapper）；共用 util 另出
  `categoryPathOf(id, cats)` 供單點顯示（page.tsx:1701 那類）。
- **M4**：按天分組與顯示同用 `userTimeZone`；G 系列以注入 timeZone 測，不依賴系統時區。
- **M5**：包5 補三條——T9 無分隔列的偽表格 → null；T10 blockquote 前綴表格 → 新列重建
  prefix；T7 定案為「照 tableSpec 既有 CRLF 慣例正確處理」（剝 `\r` 處理、寫回還原）。
- **M6**：加列鈕在 `@media (hover: none)` 常駐顯示；手機寬截圖列入驗證。
- **M7**：B5 用 `context.close()`（不跑 beforeunload）模擬斷電。
- **L1**：所有 E2E 每 run 建新筆記；T8 明定「create 後第一次 update」順序。
- **L3**：拖曳來源用**第二個 MIME**（`application/x-zonwiki-note-src-cat`）帶 sourceCategoryId，
  `NOTE_DND_MIME` 維持純 noteId 字串（向後相容）。
- **L4**：範圍鎖定筆記域 4 處下拉；「codepoint 字串排序（非注音/筆畫）＝使用者明示」寫入 DECISIONS.md。

## 交付與驗證（鐵則 #25）
1. 後端 `dotnet test` 全綠；前端 `vitest` 全綠＋`tsc`＋`lint`。
2. worktree 內起本地實例（撞埠 +100：後端 5109、前端 3100），Playwright 實測
   C4/D3-D5/T8/B5-B7 並截圖（亮暗雙主題），收整 `tmp/playwright-verify/`。
3. DECISIONS.md 增錄：合併窗 10 分鐘與不併 create/delete 的理由、拖曳切換語意、
   草稿備份鍵空間與多分頁限制、（本輪不做歷史端點瘦身與 retention 的範圍決策）。
4. 對抗式復審（獨立 sub-agent）→ 修 CRITICAL/HIGH → push 前合 origin/main。
