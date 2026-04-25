# AI 全域規則

## 文件先行（CRITICAL）
- 所有工作必須從文件開始
- 沒有對應文件 → 先建文件
- 在 `Status: Approved` 的 task 文件出現之前，**不得**寫任何 code

## 規範查找
- 完整規範清單在 `claude.md` 的「規範索引」段
- 不確定某種文件怎麼寫時，到 `/docs/_rules/` 查對應規範
- **不得**自行發明文件格式

## Issue 處理
- 達 `issue-writing.md` 門檻的錯誤 → **必須**開 issue
- Issue **必須**透過 `## 相關連結` 段連到對應 task
- Issue **必須**填 `Severity` 嚴重度

## Decision 處理
- 任何重大架構／技術決策 → **必須**寫 decision 紀錄
- Decision 的 Rules **必須**同步到 `constraints.md`
- 取代舊 decision 時，**必須**雙向更新（Supersedes + Superseded By）

## Task 處理
- 任何功能 → **必須**先產 task
- Task **必須**透過 `## 相關連結` 段連到 PRD 需求 ID 與相關 issue / decision
- Task **必須**為 `Status: Approved`（含人類填寫的 Approved By + Approved Date）才能開始寫 code

## Schema 變更處理
- 任何 DB schema 變更 → 在執行 migration **之前**，必須依 `schema-change-writing.md` 建立紀錄
- 命名合規檢查必須通過

## 測試處理
- 適用情境採 TDD：依 `test-writing.md` 先寫測試
- 涉及 DB 的測試**必須**用真實 DB（不准 mock）

## 歸檔
- 過期文件**必須**依 `deprecation.md` 歸檔 — **不准**刪除
- 被取代的 decision 必須在新舊兩份檔都更新（雙向連結）

## 更新規則
- 每完成一個 task：
  - 更新 `current-state.md`
  - 更新 task `Status`
  - 檢查相關文件是否仍正確
- 每做一個 decision：
  - 將 decision 的新 Rules 寫入 `constraints.md`
- Session 結束：
  - 更新 `current-state.md`（**強制**，即使工作未完成）
  - 依 `session-log-writing.md` 新增一筆 session log（**強制**）

## Last Updated 要求
- 每份文件頂部**必須**有 `Last Updated: YYYY-MM-DD`
- 若某份文件 Last Updated 已 >7 天且該領域有變更，標記為待 review

## 交叉引用要求
- 每份 task / issue / decision **必須**有 `## 相關連結` 段
- 使用相對路徑連結：`[標題](../tasks/YYYY-MM-DD-xxx.md)`
- 沒有任何進出連結的孤兒文件 = 流程失敗的徵兆

## 詞彙表要求
- 使用可能在本專案有特殊意義的術語前，先到 `glossary.md` 確認
- 若該術語在 glossary 缺漏，先補上再繼續

## 禁止事項
- 不得跳過文件
- 不得在沒有 Approved task 的情況下直接實作
- Session 結束不得不更新 `current-state.md` 與寫 session log
- Decision 不得不同步 Rules 到 `constraints.md`
- 不得刪除歷史文件 — 依 `deprecation.md` 歸檔
- 不得悄悄偏離 task 的 Approved Steps — 依 Steps Drift Policy 處理
