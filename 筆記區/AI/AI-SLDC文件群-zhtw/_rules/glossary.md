# 詞彙表撰寫規範

此檔規範**如何維護專案的 `glossary.md`** — 一份包含本專案專有術語的清單。
AI 在使用可能模糊的術語前，**必須**先查專案的 `glossary.md`。

## 檔案位置
/docs/glossary.md

## 必要結構（專案的 glossary.md 模板）

```
# 專案詞彙表

Last Updated: YYYY-MM-DD

## AI-SLDC 核心術語

### Phase（階段）
專案生命週期階段：Planning | Development | Testing | Staging | Production。
來源：current-state-writing.md

### Approved（已核准）
文件狀態之一。對 task：人類審核者已在 `Approved By` 寫下姓名、`Approved Date` 寫下日期。AI **不得**對非 `Status: Approved` 的 task 執行任何工作。
來源：task-writing.md, claude.md

### Done（完成）
完成定義已全部達成、驗證指令已實際執行、結果已寫入 session log 的 task。
來源：task-writing.md

### In Progress（進行中）
單一操作者正在執行的 task。被中斷時，**必須**反映在 `current-state.md` 的 `In Progress` 與最新 session log。
來源：task-writing.md

### Blocker（卡點）
未解的 issue（`Status: Open` 或 `Investigating`），擋住一個 In Progress 的 task。存活期間**必須**出現在 `current-state.md` 的 `Blockers`。
來源：current-state-writing.md, task-writing.md

### Operator（操作者）
一個 session 中負責推進工作的單一實體 — 具名人類或具名 AI Agent。Operator 也是該 session log 的撰寫者。
來源：session-log-writing.md

### Reversibility（決策可逆度）
描述要回滾一個 decision 有多難：Easy / Hard / One-Way。
來源：decision-writing.md

## 專案專有術語

（隨術語在專案中出現逐步補充。下面是示意，請依專案實況調整。）

### <術語>
1–3 句話定義。
來源：<連結到此術語首次正式出現或定義的位置>
```

## 規則
- AI 第一次遇到術語有歧義時就補上條目
- 每條目：1–3 句定義 + `來源：` 連結到正式出處
- codebase 兩處用同一個字代表不同事，**兩種**意義都要寫並消歧義
- 術語意義改變時，**不得**靜默覆寫。舊意義加註 `Deprecated YYYY-MM-DD`，新意義寫在它之下
- 術語不再適用：保留並標 `Deprecated YYYY-MM-DD`（不要刪 — 歷史文件可能仍引用）
- 詞彙表更新**不需要** decision 紀錄；但若這個改變源自某 decision，在 `來源：` 連到該 decision
