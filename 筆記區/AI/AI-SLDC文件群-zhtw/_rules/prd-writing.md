# PRD 撰寫規範

任何 task 建立**之前**，專案必須先有 PRD（Product Requirements Document，產品需求文件）。
PRD 是「我們在做什麼、為什麼做」的單一真相來源。

## 檔案位置
/docs/prd.md

## 何時建立
- 專案啟動，產 task **之前**
- 範圍重大變更時（建立新版本，舊版保留供參考）

## 必要結構

```
# PRD：<專案名>

Last Updated: YYYY-MM-DD
Version: 1.0
Status: Draft | In Review | Approved

## 背景
為什麼有這個專案？要解決什麼問題？

## 目標
- 目標 1（可量測）
- 目標 2（可量測）

## 非目標
- 此專案明確**不做**什麼

## 目標使用者
誰會使用？他們的需求是什麼？

## 需求

### 功能需求
| ID | 需求 | 優先序（Must / Should / Nice） |
|----|------|------|
| F1 | ... | Must |
| F2 | ... | Should |

### 非功能需求
| ID | 需求 | 目標值 |
|----|------|------|
| NF1 | 效能 | 回應 < 200ms |
| NF2 | 可用性 | 99.9% uptime |

## 技術選型
- 語言／框架／資料庫選擇（若有 decision 紀錄則連結之）

## 驗收條件
**整個專案層級**的驗收清單（不是單個 task）：
- [ ] 條件 1
- [ ] 條件 2

人類最終手動驗收時依此清單檢查。

## 範圍外
此版本明確排除的項目。

## 相關連結
- Decisions: [標題](decisions/YYYY-MM-DD-xxx.md)
- 外部參考：Figma、Slack 討論串、客戶 email 等
```

## 規則
- 產 task 之前 **必須**先有 PRD
- PRD **必須** `Status: Approved` 才能開始開發
- Task **必須**回溯到此 PRD 中的某個需求 ID
- 需求變更時，**先**更新 PRD，**再**更新受影響的 task

## 暫停點對照（自治授權 #1）

`Status: Draft → Approved` 是「等人類」的暫停點。
AI 在此暫停前**必須**依 `autonomy-authorization.md` 重讀 `docs/AI-自治授權.md`。
若項目 #1 為「是」，AI 自行把 PRD `Status` 改為 `Approved`、在文件底部加 `Approved By: AI Agent (per autonomy-authorization #1) on YYYY-MM-DD`，並在 session log 註記。
