# Decision 撰寫規範

做出**任何**架構或技術決策時，記下來。

## 檔案位置
/docs/decisions/YYYY-MM-DD-<topic>.md

## 必要結構

```
# DECISION：<標題>

Last Updated: YYYY-MM-DD
Status: Proposed | Accepted | Superseded | Deprecated
Decision Maker: <人類姓名> | <AI Agent + 人類核准者姓名>
Date Decided: YYYY-MM-DD
Reversibility: Easy | Hard | One-Way

## 情境
為什麼需要這個決策。

## 評估過的選項

### 選項 A：<名稱>
- 優點
- 缺點

### 選項 B：<名稱>
- 優點
- 缺點

## 決策
選定的選項。

## 理由
為什麼選這個、不選其他。

## 後果
- 選定選項的優點
- 接受的缺點／取捨

## Rules（重要）
把決策轉成可執行規則：

- MUST 用 ...
- MUST NOT 用 ...

**同步要求：** 寫完 Rules 後，**必須**把它們加到 `constraints.md`，並反向連結到本 decision 作為來源。

## 相關連結
- Task: [標題](../tasks/YYYY-MM-DD-xxx.md) — 觸發此決策的 task
- Issue: [標題](../issues/YYYY-MM-DD-xxx.md) — 若此決策是為解某 issue 而做
- Supersedes: [標題](../decisions/YYYY-MM-DD-xxx.md) — 若此決策取代某舊 decision
- Superseded By: [標題](../decisions/YYYY-MM-DD-xxx.md) — 當有更新的 decision 取代本決策時，回填此欄
```

## Status 定義

| 狀態 | 意義 |
|---|---|
| Proposed | 已草擬，但人類決策者尚未核准 |
| Accepted | 生效中、具拘束力 — 其 Rules 段管控行為 |
| Superseded | 被新 decision 取代；舊行為不再適用。**必須**回填 `Superseded By` |
| Deprecated | 因其他原因（例如功能被移除）不再相關。依 `deprecation.md` 歸檔 |

## Reversibility 定義

| 等級 | 意義 |
|---|---|
| Easy | 1 天內可回滾；無需資料遷移；無需多方協調 |
| Hard | 回滾需要資料遷移、改寫程式、或跨多模組協調 |
| One-Way | 無法回滾，否則會大量資料遺失、需要重建系統、商譽損失或破壞性 API 變更 |

`Reversibility` 用來判斷未來是否可被 supersede。標 `One-Way` 的 decision 在 Accepted 前要有人類明確簽名。

## 規則
- 新 decision 取代舊 decision 時：
  1. 在新 decision 的 `Supersedes` 寫舊 decision
  2. **同時必須**把舊 decision 的 `Superseded By` 寫成新 decision（雙向連結）
  3. **必須**把舊 decision 的 `Status` 改為 `Superseded`
- `Status: Deprecated` 的 decision **必須**依 `deprecation.md` 歸檔
- `Rules` 段的新規則**必須**立刻同步到 `constraints.md`
