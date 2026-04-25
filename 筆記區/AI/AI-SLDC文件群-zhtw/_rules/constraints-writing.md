# Constraints 撰寫規範

Constraint（限制）是適用於整個專案、不可協商的規則。
來源是 decision、架構選擇、或外部要求。

## 檔案位置
/docs/constraints.md

## 更新觸發
- 每次新增 decision 紀錄後（檢查其 `Rules` 段）
- 外部要求變更時（法規、合規、客戶要求）
- 反覆出現的 issue 揭示出某條限制缺漏時

## 必要結構

```
# 專案限制

Last Updated: YYYY-MM-DD

## 技術限制
- 限制描述 — [來源：decision/issue 連結]

## 業務限制
- 限制描述 — [來源：誰決定的、何時]

## 慣例限制
- 命名、格式、流程規則 — [來源]
```

## 規則
- 每條 constraint **必須**有 `來源`（連結到 decision、issue、或外部要求）
- Decision 的 `Rules` 段產出的新限制，**必須**寫進此檔
- Constraint 之間**不得**互相牴觸 — 若發現衝突，建立新的 decision 紀錄來解決
- 開始任何新功能前先看此檔，避免違反現有限制
- 過期的 constraint 用刪除線標示（依 `deprecation.md`），不從檔案移除
