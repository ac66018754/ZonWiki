# Onboarding 撰寫規範

撰寫一份「**零 context** 的新工程師（或新 AI Agent）也能跑起來」的指引。

## 檔案位置
/docs/onboarding/quick-start.md

## 目標
30 分鐘內把系統跑起來。

## 必要結構

```
# 快速啟動

Last Updated: YYYY-MM-DD

## 需求
- 列出所有相依（含確切版本）
- 列出需要的帳號或存取權限

## 設定步驟
1. Clone repo
2. 安裝相依（精確指令）
3. 設定環境變數（列出每個必要變數，附範例值）

## 啟動步驟
精確指令 — 可直接複製貼上、無歧義。

## 預期結果
- 後端 URL 與應該看到什麼
- 前端 URL 與應該看到什麼
- 「成功」狀態的截圖或描述

## 驗證
完成上述步驟後確認：
- [ ] 後端在 http://localhost:xxxx 有回應（描述預期回應）
- [ ] 前端在 http://localhost:xxxx 載入（描述頁面樣貌）
- [ ] 能完成基本操作：<描述一個簡單的端到端動作>

任何驗證失敗，請看下方 Troubleshooting。

## Troubleshooting
| 症狀 | 原因 | 解法 |
|------|------|------|
| ... | ... | ... |

## 接下來去哪
- 讀 `current-state.md` 了解目前在做什麼
- 讀 `constraints.md` 了解專案規則
- 看 `/tasks/` 找可做的 task
```
