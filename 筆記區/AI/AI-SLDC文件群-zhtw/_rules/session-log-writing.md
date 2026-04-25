# Session Log 撰寫規範

`current-state.md` 是「**現在**」的快照。
**Session log 是歷史**。沒有它，「過去三天發生什麼事」就無法還原。

每個 work session（人或 AI），結束時**必須**寫一筆 session log。

## 檔案位置
/docs/session-logs/YYYY-MM-DD-HHmm.md

每個 session 一份檔案。資料夾是 append-only — **不准覆寫**已存在的 log。

## 何時建立
- 每次 work session 結束、簽退之前
- Session 被中斷（timeout、crash、強制停止）時，**仍要**寫到目前進度為止 — 「歷史不完整」遠優於「歷史消失」
- 即使是「沒做什麼有用的事」的 session 也要寫（`Worked On` 一行也行）

## 必要結構

```
# SESSION LOG — YYYY-MM-DD HHmm

Last Updated: YYYY-MM-DD HH:mm
Operator: <人類姓名> | <AI Agent（model 名）>
Session Started: YYYY-MM-DD HH:mm
Session Ended: YYYY-MM-DD HH:mm
Branch: <git branch 名>
Starting Commit: <短 hash>
Ending Commit: <短 hash> | <無新 commit>

## Worked On（本次處理）
- [Task 名](../tasks/YYYY-MM-DD-xxx.md) — 推進了什麼（哪些 Steps 完成、簡短摘要）
- 動到的檔案：清單（用 repo 相對路徑）

## Decisions Made（本次決策）
- [Decision 名](../decisions/YYYY-MM-DD-xxx.md) — 一句話摘要，或 "none"

## Issues Encountered（本次遭遇問題）
- [Issue 名](../issues/YYYY-MM-DD-xxx.md) — Severity — 目前 Status，或 "none"

## Schema Changes（本次 schema 變更）
- [Schema change 名](../schema-changes/YYYY-MM-DD-xxx.md) — Status，或 "none"

## Verification Run（本次驗證執行）
- 實際執行的指令（例如 `dotnet test`、`pnpm lint`、`pnpm build`）
- 結果（pass / fail / 數量 / coverage）
- 「skipped — 原因」可接受但不建議

## Uncommitted Work（未提交工作）
- 未 commit 的 dirty 檔案清單（或 "clean"）
- 沒 commit 的原因（例如「WIP — 還編不過」、「等 review」）

## Next Session Should（下一個 session 該做的事）
1. 具體的下一步動作 — 可附精確指令（例如 `dotnet ef migrations add AddCommentTable`）
2. ...

## Handoff Notes（交接備註）
給下個接手者的自由文字：
- 遇到的意外
- 暫時不做的決策
- 差點壞掉的事
- 不適合放進其他段的 context
```

## 規則
- 每個 session 一份 log — **不准**覆寫
- 檔名用 session **開始**時間
- 中途切換 branch，要在 `Handoff Notes` 註記切換經過與最終 branch
- Session log 是 append-only 歷史 — **不准**回去改舊 log；要修正就在下一份 log 寫
- 寫完 log 後，**也要**更新 `current-state.md`（log 是逐 session、current-state 是累積）
- `Next Session Should` 沒填的 log 視為不完整
