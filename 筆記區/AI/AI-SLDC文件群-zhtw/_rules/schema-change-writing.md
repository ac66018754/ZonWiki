# Schema 變更撰寫規範

每次 DB schema 變更都**必須**留下紀錄。此紀錄獨立於觸發它的 task — 因為 schema 變更可能跨越多個 task，需要自己的稽核軌跡。

## 檔案位置
/docs/schema-changes/YYYY-MM-DD-<short-name>.md

## 何時建立
- 新增 / 移除 / 重新命名 表或欄位
- Index 變更（新增、刪除、修改）
- Constraint 變更（FK、unique、check、default）
- 重新塑形既有資料的 migration

## 必要結構

```
# SCHEMA CHANGE：<名稱>

Last Updated: YYYY-MM-DD
Status: Planned | Applied (Dev) | Applied (Prod) | Reverted
Migration File: src/.../Migrations/<MigrationName>.cs（或同等）

## 原因
為什麼要改。連結到 task / decision。

## 受影響的表
- 表名 — 新增 | 修改 | 移除 | 改名

## 受影響的欄位
| 表 | 欄位 | 變更 | 備註 |
|----|------|------|------|
| Article | Article_PublishedDateTime | 新增 | nullable，無預設 |

## 受影響的 Index / Constraint
- IndexName / ConstraintName — 新增 | 修改 | 移除 — 用途

## 命名合規檢查
- [ ] 表名為 PascalCase，**不含**底線
- [ ] 每個新欄位遵循 `{Table}_{Field}` PascalCase
- [ ] 每個新欄位**剛好一個**底線（分隔用）
- [ ] 六個審計欄位齊備，或下方填寫豁免理由

## 審計欄位豁免（如適用）
不含六個標準審計欄位的理由。

## Migration 指令
- Up：`dotnet ef migrations add <Name>` 然後 `dotnet ef database update`
- Down（rollback）：`dotnet ef database update <PreviousMigration>`

## 資料遷移
描述任何 backfill，並說明是否冪等（idempotent）。
「無」是可接受答案。

## Rollback 計畫
production 出事時的精確還原步驟。含資料保留策略。
若無法 rollback（One-Way），明確說明並連到支撐的 decision。

## 套用紀錄
- Dev：YYYY-MM-DD HH:mm — 由誰
- Prod：YYYY-MM-DD HH:mm — 由誰 — 或 "尚未套用"

## 相關連結
- Task: [標題](../tasks/YYYY-MM-DD-xxx.md)
- Decision: [標題](../decisions/YYYY-MM-DD-xxx.md)
- Tests: [標題](../tests/YYYY-MM-DD-xxx.md) — 證明此 migration 安全的測試
- Issue: [標題](../issues/YYYY-MM-DD-xxx.md) — 若此變更是為解某 issue 觸發
```

## Status 定義

| 狀態 | 意義 |
|---|---|
| Planned | 紀錄已建立，migration 尚未產生或套用 |
| Applied (Dev) | Migration 已套用到 dev DB |
| Applied (Prod) | Migration 已套用到 production DB |
| Reverted | Migration 已被回滾；紀錄保留作歷史。後續修正用一份**新**的 schema-change 紀錄描述 |

## 規則
- 狀態進入 `Planned` 之後**必須**先通過命名合規檢查
- **不得**省略六個標準審計欄位，除非在 `審計欄位豁免` 段明確說明
- migration 檔**必須**版控、並透過 `Migration File` 連結
- Reverted 紀錄**不刪** — `Status: Reverted`，並用一份新的 schema-change 紀錄描述修正動作
- 命名規則來自全域 CLAUDE.md 的 DB schema 標準 — 該規則覆蓋任何在地慣例
