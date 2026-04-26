# AI 自治授權設定

> **這是專案授權檔的範本。** 請複製到每個專案的 `docs/AI-自治授權.md`，再依該專案需要修改下表。
> 規範細節見 `docs/_rules/autonomy-authorization.md`。

Last Updated: YYYY-MM-DD
Maintained By: <人類姓名>

## 一、授權項目

每項只能填 `是` 或 `否`。
填 `是` = AI 可自行代行人類角色繼續流程。
填 `否` = AI 必須停下等人類處理。

| # | 項目 | 暫停點 | 建議預設 | 授權（是／否） |
|---|---|---|---|---|
| 1 | PRD Approval | PRD 寫完從 `Draft → Approved` | 否 | <填> |
| 2 | Task Approval | task 寫完從 `Draft → Approved`（含 Approved By/Date） | 否 | <填> |
| 3 | Decision Approval — Easy | Reversibility = Easy 的 decision `Proposed → Accepted` | 是（建議） | <填> |
| 4 | Decision Approval — Hard | Reversibility = Hard 的 decision `Proposed → Accepted` | 否 | <填> |
| 5 | Decision Approval — One-Way | Reversibility = One-Way 的 decision `Proposed → Accepted` | **否（強烈建議永遠）** | <填> |
| 6 | Steps Drift（Material 變更） | Material 變更時的退回 Draft 重審流程 | 否 | <填> |
| 7 | Schema Change → Dev | 套到 dev DB 之前的放行 | 否 | <填> |
| 8 | Schema Change → Prod | 套到 prod DB 之前的拍板 | **否（強烈建議永遠）** | <填> |
| 9 | Retrofit 回填驗收 | 中途導入完成所有回填 Draft 後的整體 review | 否 | <填> |
| 10 | 歧義 / 需要選擇 | AI 自己回報「我不確定 A 還是 B」時 | 否 | <填> |

## 二、生效規則（摘要 — 完整見 `_rules/autonomy-authorization.md`）

1. AI 每次到暫停點都必須**重讀本檔**（不准 cache）
2. 自治處理的暫停點必須在文件對應欄位填 `AI Agent (per autonomy-authorization #N)` 並在 session log 註記
3. 缺漏／格式錯誤 = 視同「否」
4. 「不可授權項目」清單（命名規則、DB mock、刪文件、跳過 session log 等）即使填「是」仍要遵守

## 三、修改紀錄（建議）

| 日期 | 改了哪一項 | 改成什麼 | 原因 |
|---|---|---|---|
| YYYY-MM-DD | #N | 是 → 否 | <一句話說明> |
