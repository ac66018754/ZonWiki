# 測試撰寫規範

本專案遵循全域測試規則（最低 80% coverage、適用情境採 TDD）。
此檔規範**測試工作要怎麼留下文件**、測試狀態如何追蹤。

## 何時建立測試文件

下列任一條件成立時建立：
- Task 涉及新邏輯、新 endpoint、新整合、或 schema 變更 → **實作前必須**先有測試計畫（TDD）
- bug fix 已合入但缺迴歸測試 → 修完後**回填**測試計畫鎖住行為
- flaky 測試被調查 → 即使沒改測試 code，也要記下分析

下列**不需**建立：
- 純 formatting / typo 修改
- 只動註解
- 不動 code 的純文件變更

## 檔案位置
/docs/tests/YYYY-MM-DD-<short-name>.md

## 必要結構

```
# TEST：<名稱>

Last Updated: YYYY-MM-DD
Status: Planned | RED | GREEN | Stable
Linked Task: [標題](../tasks/YYYY-MM-DD-xxx.md)

## 範圍
要測什麼。
**明確**不測什麼（範圍外）。

## 採用的測試類型
- [ ] Unit
- [ ] Integration（涉及 DB 的測試**必須**用真實 DB — 見專案規則）
- [ ] E2E

## 測試案例
| ID | 行為 | 類型 | 預期 | 狀態 |
|----|------|------|------|------|
| T1 | 分類存在時回 200 | Integration | 200 + body shape X | RED → GREEN |
| T2 | 分類不存在時回 404 | Integration | 404 + 錯誤 envelope | RED → GREEN |

## Coverage 目標
- 模組 / 檔案：目標 %（專案預設 80%）
- 關鍵路徑：適用時 100%

## 執行指令
- 跑這些測試的精確指令
- 讀 coverage 的精確指令

## Verification Done On
- YYYY-MM-DD HH:mm — 操作者 — pass / fail 數 / coverage % — 紀錄於 [session log](../session-logs/YYYY-MM-DD-HHmm.md)

## 相關連結
- Task: [標題](../tasks/YYYY-MM-DD-xxx.md)
- Issue: [標題](../issues/YYYY-MM-DD-xxx.md) — 若此測試是為防止某問題復發
- Schema Change: [標題](../schema-changes/YYYY-MM-DD-xxx.md) — 若此測試驗證某 migration
```

## Status 定義

| 狀態 | 意義 |
|---|---|
| Planned | 測試案例已列，但尚未寫 code |
| RED | 測試 code 已寫且如預期失敗（尚無實作） |
| GREEN | 實作完成、測試通過 |
| Stable | 連續通過至少 1 次後續 session 且無 flake |

## 規則
- 狀態流：`Planned → RED → GREEN → Stable`
- 會 flake 的測試一律算 `RED`，要連續通過確認後才能升 `Stable`
- 涉及 DB 的測試**必須**用真實 DB（Testcontainers 或同等）。**不准** mock DB。
- coverage 跌破專案最低（80%）**必須**寫進 `current-state.md` 的 `Blockers`
- 被刪除的測試**必須**依 `deprecation.md` 歸檔（不准悄悄移除迴歸覆蓋）
