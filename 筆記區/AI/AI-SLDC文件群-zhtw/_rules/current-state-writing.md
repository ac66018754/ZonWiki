# Current-State 撰寫規範

這是**最重要**的交接文件。
任何人（人類或 AI）失去 context 時，**第一份**要讀的就是它。

## 檔案位置
/docs/current-state.md

## 更新觸發
- 每次有 task 完成
- 每次發現或解除 blocker
- 每次有 decision 改變專案方向
- **每次 work session 結束**

## 必要結構

```
# 專案目前狀態

Last Updated: YYYY-MM-DD HH:mm
Updated By: <姓名 或 "AI Agent">

## Phase
目前階段：Planning | Development | Testing | Staging | Production

## In Progress（進行中）
- [ ] [Task 名](../tasks/YYYY-MM-DD-xxx.md) — 簡短狀態說明

## Blockers（卡點）
- [Issue 名](../issues/YYYY-MM-DD-xxx.md) — 為何卡住

## Recently Completed（最近完成）
- [Task 名](../tasks/YYYY-MM-DD-xxx.md) — 完成於 YYYY-MM-DD

## Next Steps（下一步）
1. 接下來要做什麼（若有 task 則連結）
2. ...

## Key Decisions（關鍵決策）
- [Decision 名](../decisions/YYYY-MM-DD-xxx.md) — 一句話摘要

## Known Risks（已知風險）
- 風險描述 — 緩解計畫或對應 issue 連結
```

## 規則
- **每次** work session 結束都要更新
- **必須**連結到實際 task / issue / decision 檔，而非只描述
- 完成的項目**必須**從 `In Progress` 移到 `Recently Completed`
- `Recently Completed` 只保留最近 10 筆（更舊的歸檔）
- 此檔若 >3 天未更新，視為 CRITICAL 問題
