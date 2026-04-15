# RETROFIT GUIDE — 中途導入 AI-SLDC

> 當專案已經在開發中，才把 AI-SLDC 文件包複製進來時，必須先執行本指引。
> 全新專案不需要讀這份文件。

## 何時觸發

AI 在 Session Recovery Flow 讀 `current-state.md` 時，如果發現：
- `current-state.md` 仍是初始模板（Phase: Planning，所有欄位都是 "none yet"）
- **但專案目錄下已經存在程式碼、設定檔、或 git 歷史**

則代表這是一個「中途導入」的情境。AI MUST 執行以下回填流程，而非從頭走全新專案流程。

---

## 回填流程

### Step 1: 盤點現狀

掃描 codebase，整理出：
- 使用的語言、框架、資料庫
- 主要模組 / 資料夾結構
- 已存在的功能（能跑的）
- 半成品或 TODO 標記
- 環境設定（.env 結構、docker-compose 等）
- git log 最近 20 筆 commit 摘要

產出一份摘要，交給人類確認。

### Step 2: 回填 PRD

依照 `prd-writing.md` 產出 `docs/prd.md`：
- 基於現有程式碼反推需求
- 已完成的功能列為 Functional Requirements，標記 Priority: Must
- 人類確認後，Status 直接設為 `Approved`（因為已經在跑了）

**注意：AI 反推的 PRD 一定不完整。** 必須明確標記哪些需求是「從程式碼推測」、哪些是「人類確認」，避免混淆。

### Step 3: 回填 decisions

對已經做過的技術選擇產出 decision 紀錄：
- 為什麼用這個 DB？這個框架？這個部署方式？
- 如果 git history 或 README 有說明 → 引用
- 如果不知道原因 → 在 Reason 欄位寫「歷史決策，原因不詳」，標記讓人類補充

### Step 4: 回填 constraints

從 codebase 推導出的既有約束寫入 `constraints.md`：
- 命名慣例（從現有程式碼推斷）
- 資料庫 schema 規則
- API 格式慣例
- 已存在的第三方服務依賴

每條 constraint 標記來源為 `[Source: 從現有 codebase 推斷]` 或連結到對應 decision。

### Step 5: 回填 tasks

- **已完成的功能** → 產出 task，Status 直接設 `Done`，Definition of Done 標記為「已在 codebase 中驗證」
- **半成品 / TODO** → 產出 task，Status 設 `Draft`，等人類 approve
- **尚未開始的功能**（如果 PRD 中有提到）→ 產出 task，Status 設 `Draft`

### Step 6: 更新 current-state.md

- Phase 設為實際狀態（通常是 `Development`）
- In Progress 列出正在開發的功能
- Recently Completed 列出已完成的 task
- Blockers 列出已知問題
- Last Updated 設為當下時間

### Step 7: 回填 onboarding（如果系統已經可以跑）

依照 `onboarding-writing.md` 產出 `onboarding/quick-start.md`，確保新人或新 AI session 能把服務啟動起來。

### Step 8: 人類 Review

**以上所有回填內容都是 Draft 狀態，必須經過人類確認。**

AI 完成回填後，應告知人類：
- 「回填完成，請 review 以下文件：prd.md、X 份 decisions、constraints.md、X 份 tasks」
- 「以下欄位標記為『原因不詳』，需要你補充：...」

人類確認後，流程正式接回正常的 Phase 3（開發）。

---

## 回填完成後的資料夾結構

```
/docs
    /_rules/          ← 不動
    /tasks/
        2026-04-16-existing-auth.md       ← Done（回填）
        2026-04-16-existing-crud.md       ← Done（回填）
        2026-04-16-todo-search.md         ← Draft（待 approve）
    /issues/          ← 可能還是空（回填不追溯歷史 bug）
    /decisions/
        2026-04-16-db-postgresql.md       ← 回填
        2026-04-16-framework-nextjs.md    ← 回填
    /onboarding/
        quick-start.md                    ← 回填（如果系統可跑）
    prd.md            ← 回填，待人類確認
    current-state.md  ← 已更新為真實狀態
    constraints.md    ← 已填入從 codebase 推斷的約束
```

---

## Rules
- MUST NOT skip retrofit and directly start normal flow when codebase already exists
- MUST get human confirmation on all retrofit documents before continuing development
- MUST clearly mark which information is "inferred from code" vs "confirmed by human"
- Retrofit is a one-time process — once complete, follow normal flow from that point on
