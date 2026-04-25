# Task 撰寫規範

收到功能需求時，**必須**產 task。

## 檔案位置
/docs/tasks/YYYY-MM-DD-<short-name>.md

## 規則
- 把功能拆成「可獨立執行」的最小 task
- 每個 task 必須能在 1 小時內完成
- 每個 task 必須有清楚的 input／output
- 每個 task 必須含 `Last Updated` 日期

## 必要結構

```
# TASK：<名稱>

Last Updated: YYYY-MM-DD
Status: Draft | Approved | In Progress | Done | Blocked
Approved By: <人類姓名> | <pending>
Approved Date: YYYY-MM-DD | <pending>

## 目的
要達成什麼。

## 目標檔案
要動到的精確檔案路徑。

## Input
請求格式／前置條件。

## Output
回應格式／後置條件。

## 步驟（Steps）
逐步具體動作。**禁止抽象描述**。

  ✅ 好（具體、可執行）：
    - 「在 src/ZonWiki.Infrastructure 執行 `dotnet ef migrations add AddCommentTable`」
    - 「編輯 src/ZonWiki.Api/Program.cs 第 42 行附近，加上 `services.AddScoped<ICommentService, CommentService>()`」
    - 「在 frontend/app/articles/[slug]/page.tsx 把佔位 div 換成 `<CommentList articleId={article.id} />`」

  ❌ 壞（抽象、模糊）：
    - 「加 comment 表的 migration」
    - 「把 CommentService 註冊到 DI」
    - 「把留言 UI 串起來」

## 完成定義（Definition of Done）
**只允許可量測條件**。不准寫「看起來 OK」「應該可以動」。

  範例：
    - 「tests/ZonWiki.Api.Tests 全數通過（`dotnet test`）」
    - 「GET /api/comments 回 200 且 body 符合 CommentDto[] 結構」
    - 「Lint 0 警告（`pnpm lint`）」

## 驗證（Verification）
如何**證明**完成定義已達成：

- 要實際執行的精確指令
- 要實際檢視的精確 URL
- 由誰驗證：AI 自查 / 人類手動 / 兩者皆要
- 驗證結果記錄在哪（通常是 session log）

## 限制
- 必須遵守全域限制
- 必須遵守 `constraints.md` 的規則

## 相關連結
- Requirement: [PRD](../prd.md) 中的 F1 / NF2 — 此 task 對應的 PRD 需求 ID（**若 PRD 存在則必填**）
- Decision: [標題](../decisions/YYYY-MM-DD-xxx.md) — 若 task 受某 decision 形塑
- Issue: [標題](../issues/YYYY-MM-DD-xxx.md) — 若 task 是為了修某 issue 而生
- Tests: [標題](../tests/YYYY-MM-DD-xxx.md) — 對應的測試計畫／紀錄
- Schema Change: [標題](../schema-changes/YYYY-MM-DD-xxx.md) — 若此 task 變更 DB schema
- Depends on: [標題](../tasks/YYYY-MM-DD-xxx.md) — 若依賴另一個 task
- Blocks: [標題](../tasks/YYYY-MM-DD-xxx.md) — 若另一個 task 在等這個
```

## 狀態轉移（Status Transitions）

| 從 → 到 | 必要條件 |
|---|---|
| Draft → Approved | 人類已 review，並填了 `Approved By` + `Approved Date` |
| Approved → In Progress | 操作者（人或 AI）開始執行第一步；`current-state.md` 的 In Progress 已更新 |
| In Progress → Done | 完成定義全部達成；驗證指令確實執行過；結果寫入 session log |
| In Progress → Blocked | 出現 blocker；**必須**建立 issue 並在 `## 相關連結` 連上；`current-state.md` 的 Blockers 已更新 |
| Blocked → In Progress | 對應的 blocker issue 已 `Status: Resolved` |
| 任何 → （刪除） | **禁止** — 用 `deprecation.md` 歸檔 |

**Approved 不得跳過。** AI **不得**對 `Status: Draft` 的 task 寫 code。

## 步驟偏離政策（Steps Drift Policy）

執行中發現原本的 Steps 錯了、不完整、或基於過期假設時：

- **小幅調整**（檔案路徑差一層、漏了 import、Step 中明顯的 typo）：
  - 直接更新 Steps
  - 更新 `Last Updated`
  - 在 session log 註記偏離

- **重大變更**（不同做法、不同檔案範圍、需要新 decision、範圍擴大）：
  - 停。**不要**動手。
  - 二擇一：
    1. 修改 task → 把 `Status` 退回 `Draft` → 請人類重新核准；或
    2. 把這個 task 標 `Blocked`（或依 `deprecation.md` 歸檔放棄），另開一個正確做法的新 task。

**絕不**悄悄偏離 Approved Steps，必須留下偏離紀錄。
