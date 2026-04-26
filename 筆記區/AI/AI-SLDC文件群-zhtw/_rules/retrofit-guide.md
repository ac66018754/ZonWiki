# RETROFIT GUIDE — 中途導入 AI-SLDC

> 當專案已經在開發中，才把 AI-SLDC 文件包複製進來時，必須先執行本指引。
> 全新專案不需要讀這份文件。

## 何時觸發

AI 在 Session Recovery Flow 讀 `current-state.md` 時，如果發現：
- `current-state.md` 仍是初始模板（Phase: Planning，所有欄位都是 "none yet"）
- **但專案目錄下已經存在程式碼、設定檔、或 git 歷史**

則代表這是一個「中途導入」的情境。AI **必須**執行以下回填流程，而非從頭走全新專案流程。

---

## 回填流程

### Step 1：盤點現狀

掃描 codebase，整理出：
- 使用的語言、框架、資料庫
- 主要模組 / 資料夾結構
- 已存在的功能（能跑的）
- 半成品或 TODO 標記
- 環境設定（.env 結構、docker-compose 等）
- git log 最近 20 筆 commit 摘要

產出一份摘要，交給人類確認。

### Step 2：回填 PRD

依照 `prd-writing.md` 產出 `docs/prd.md`：
- 基於現有程式碼反推需求
- 已完成的功能列為 Functional Requirements，標記 Priority: Must
- 人類確認後，Status 直接設為 `Approved`（因為已經在跑了）

**注意：AI 反推的 PRD 一定不完整。** 必須明確標記哪些需求是「從程式碼推測」、哪些是「人類確認」，避免混淆。

### Step 3：回填 decisions

對已經做過的技術選擇產出 decision 紀錄：
- 為什麼用這個 DB？這個框架？這個部署方式？
- 如果 git history 或 README 有說明 → 引用
- 如果不知道原因 → 在 Reason 欄位寫「歷史決策，原因不詳」，標記讓人類補充
- `Status` 一律先標 `Accepted`（因為實際在用）；`Decision Maker` 標「歷史決策」並待人類補上實際決策者
- `Reversibility` 依當下評估填寫

### Step 4：回填 constraints

從 codebase 推導出的既有約束寫入 `constraints.md`：
- 命名慣例（從現有程式碼推斷）
- 資料庫 schema 規則
- API 格式慣例
- 已存在的第三方服務依賴

每條 constraint 標記來源為 `[來源：從現有 codebase 推斷]` 或連結到對應 decision。

### Step 5：回填 schema-changes（若有 DB）

對既有 DB 產出**最新 schema 的綜合紀錄**：
- 命名合規檢查跑過
- 不要對既有每一次 migration 都回填，只回填「目前狀態」一份綜合紀錄
- 依 `schema-change-writing.md`，`Status: Applied (Prod)` 或 `Applied (Dev)`

### Step 6：回填 tasks

- **已完成的功能** → 產出 task，`Status` 直接設 `Done`，Definition of Done 標記「已在 codebase 中驗證」
- **半成品 / TODO** → 產出 task，`Status` 設 `Draft`，等人類 approve
- **尚未開始的功能**（如果 PRD 中有提到）→ 產出 task，`Status` 設 `Draft`

### Step 7：回填 tests（若有測試）

依 `test-writing.md` 對既有測試套件產出**一份**綜合測試紀錄，標 `Status: Stable`、註明「歷史回填，未逐案 RED→GREEN 重現」。

### Step 8：更新 current-state.md

- Phase 設為實際狀態（通常是 `Development`）
- In Progress 列出正在開發的功能
- Recently Completed 列出已完成的 task
- Blockers 列出已知問題
- Last Updated 設為當下時間

### Step 9：建立第一筆 session-log

依 `session-log-writing.md` 在 `/docs/session-logs/` 建立一筆，記錄回填本身：
- `Worked On`：列出回填產生的所有文件
- `Handoff Notes`：說明回填的不確定處、需要人類補上的欄位

### Step 10：回填 onboarding（若系統可跑）

依 `onboarding-writing.md` 產出 `onboarding/quick-start.md`，確保新人或新 AI session 能把服務啟動。

### Step 11：Review（人類或 AI 自治）

**以上所有回填內容預設都是 Draft 狀態，必須經 review 才接回正常流程。**

AI 完成回填後，**必須**依 `autonomy-authorization.md` 重讀 `docs/AI-自治授權.md` 看項目 #9（Retrofit 回填驗收）：

- **#9 = 否（預設）：** AI 告知人類：
  - 「回填完成，請 review 以下文件：prd.md、X 份 decisions、constraints.md、X 份 tasks、schema-changes、第一筆 session log」
  - 「以下欄位標記為『原因不詳』，需要你補充：...」
  - 人類確認後，流程正式接回正常的開發 phase。

- **#9 = 是：** AI 自行把所有回填 Draft 提升到對應 Active 狀態（PRD → Approved、decisions → Accepted、in-progress tasks → Approved、Done tasks 維持 Done），並：
  - 在每份文件填 `<Approver/Decision Maker>: AI Agent (per autonomy-authorization #9)` 與當下日期
  - 在第一筆 session log 詳列「自治驗收清單 + 每份文件中無法確認的『原因不詳』欄位」
  - 後續若人類發現某份回填錯誤，仍可走 deprecation / 修改流程修正

**注意：** retrofit-guide 第 2 步「PRD 反推一定不完整」這個風險不會因為授權「是」就消失 — 只是把人類驗收的責任先壓在 AI 上、由 session log 留底。建議只在你信得過 AI 對該專案理解的情況下才把 #9 設為「是」。

---

## 回填完成後的資料夾結構

```
/docs
    /_rules/                          ← 不動（從母本複製）
    /tasks/
        2026-04-26-existing-auth.md       ← Done（回填）
        2026-04-26-existing-crud.md       ← Done（回填）
        2026-04-26-todo-search.md         ← Draft（待 approve）
    /issues/                          ← 可能仍空（回填不追溯歷史 bug）
    /decisions/
        2026-04-26-db-postgresql.md       ← 回填
        2026-04-26-framework-nextjs.md    ← 回填
    /schema-changes/
        2026-04-26-current-schema.md      ← 綜合回填
    /tests/
        2026-04-26-existing-suite.md      ← 綜合回填
    /session-logs/
        2026-04-26-HHmm.md                ← 第一筆，紀錄回填本身
    /onboarding/
        quick-start.md                    ← 回填（若系統可跑）
    prd.md                            ← 回填，待人類確認
    current-state.md                  ← 已更新為真實狀態
    constraints.md                    ← 已填入從 codebase 推斷的約束
    glossary.md                       ← 從預設模板開始，按出現補充
```

---

## 規則
- codebase 已存在時，**不得**跳過 retrofit 直接走全新流程
- 繼續開發前，**必須**取得人類對所有回填文件的確認
- **必須**清楚標示哪些資訊是「從 code 推斷」、哪些是「人類確認」
- Retrofit 是一次性流程 — 完成後即接回正常流程
