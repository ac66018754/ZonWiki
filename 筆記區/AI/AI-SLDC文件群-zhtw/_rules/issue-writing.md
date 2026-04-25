# Issue 撰寫規範

遇到達門檻的錯誤時，**必須**建立 issue 紀錄。

## 開單門檻（什麼才算要開 issue）

只要符合以下任一條件，就要開 issue：

- 已上線／已交付的行為錯了
- 影響到某位使用者（人類，不是 AI 自己）
- 有 task 卡住，無法繼續
- 此錯誤揭示出一條未來工作必須避免的缺漏限制或模式
- 修復過程**花了 >15 分鐘**調查
- 同樣的錯誤跨 session 重複出現（即使每次看起來都很小）

**不要**為下列情況開 issue：

- 自己草稿中、還沒存檔的 typo
- AI 工具暫時錯誤、同一步驟內重試就成功
- 同次編輯內被自動修掉的 lint 警告
- 同操作者沒查資料、約 1 分鐘內就修掉的編譯錯誤

不確定就開。一份瑣碎的 issue 比錯失一個模式便宜。

## 檔案位置
/docs/issues/YYYY-MM-DD-<short-name>.md

## 必要結構

```
# ISSUE：<標題>

Last Updated: YYYY-MM-DD
Status: Open | Investigating | Resolved | Won't Fix
Severity: CRITICAL | HIGH | MEDIUM | LOW
Reporter: <人類姓名> | <AI Agent>
Assignee: <人類姓名> | <AI Agent> | <unassigned>
Reproducibility: Always | Sometimes | Once | Cannot Reproduce

## 問題
發生了什麼。

## 情境
系統狀態、輸入、環境。

## 根因
真正的原因（**不是症狀**）。

## 調查過程
逐步除錯紀錄 — 包含試過什麼、什麼沒用。

## 解法
怎麼修的（適用時附 code 片段或設定變更）。

## 影響
- 受影響的元件
- 對使用者的影響

## 時間成本
調查 + 修復共花多久。

## 預防
未來如何避免。如果此次產出新規則，要寫進 `constraints.md`。

## 相關連結
- Task: [標題](../tasks/YYYY-MM-DD-xxx.md) — 此問題發生時正在做的 task
- Decision: [標題](../decisions/YYYY-MM-DD-xxx.md) — 為解此問題而做的 decision
- 其他 Issues: [標題](../issues/YYYY-MM-DD-xxx.md) — 相關 issue

## 相關檔案
本次涉及的檔案清單。
```

## Severity 定義

| 嚴重度 | 意義 |
|---|---|
| CRITICAL | 資料遺失、安全外洩、production 倒站、或 task 完全卡住且無 workaround |
| HIGH | 重要功能壞掉、雖有但很痛苦的 workaround、安全弱點 |
| MEDIUM | 次要功能壞掉、效能退化、code 品質退化 |
| LOW | 外觀問題、輕微不便、低優先建議 |

## Status 定義

| 狀態 | 意義 |
|---|---|
| Open | 已回報，尚未處理 |
| Investigating | 正在調查 |
| Resolved | 根因已找到、修復已套用／驗證 |
| Won't Fix | 已知但決定不修（附理由）；30 天後依 `deprecation.md` 歸檔 |

## 規則
- `Severity` **必填**（沒有預設值）
- `Reporter` **必填**（發現／揭露此問題的操作者）
- `Assignee` 一開始可為 `<unassigned>`，但狀態進入 `Investigating` 前**必須**指派
- Resolved 的 issue **留在** `/issues/`，**不准刪**
- `Won't Fix` 超過 30 天的 issue 依 `deprecation.md` 歸檔到 `/_archive/issues/`
