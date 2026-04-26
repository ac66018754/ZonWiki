# AI 自治授權規範

此規範定義 AI 在原本必須「停下等人類」的暫停點，要怎麼透過讀取**專案本地的授權檔**決定能不能自行代行人類角色。

## 授權檔位置

`/docs/AI-自治授權.md`

由人類維護，**不在** `_rules/` 底下（`_rules/` 是規範，授權檔是專案決策）。
範本見母本根目錄 `AI-自治授權-範本.md`。

## 何時讀授權檔

**每一次**遇到本系統定義的暫停點時，AI **必須立即重讀 `docs/AI-自治授權.md`**，再決定要停下還是自走。
**不准 cache、不准沿用本 session 早先讀到的內容** — 人類可能在這次暫停與上次暫停之間調整授權。

完整暫停點清單見下方「暫停點對照表」。

## 授權判讀規則

讀完 `docs/AI-自治授權.md` 後：

1. 找到對應暫停點的列
2. 看該列「授權」欄
3. 解讀：

| 授權欄值 | AI 行為 |
|---|---|
| `是` | AI 自行代行人類角色，繼續流程 |
| `否` | AI 停下，等人類處理 |
| 缺漏 / 不是 `是` 或 `否` | 視同 `否`（fail-safe） |
| 整份檔案不存在 | 所有項目視同 `否` |

## AI 自治時的稽核 footprint（強制）

當 AI 因授權「是」而自行代行人類角色，**必須**在對應文件填：

| 文件 | 欄位 | 應填入容 |
|---|---|---|
| Task | `Approved By` | `AI Agent (per autonomy-authorization #<項次>)` |
| Task | `Approved Date` | 當下日期 |
| Decision | `Decision Maker` | `AI Agent (per autonomy-authorization #<項次>)` |
| Decision | `Date Decided` | 當下日期 |
| Schema Change `Applied On` | Dev / Prod | `AI Agent (per autonomy-authorization #<項次>)` + 時間 |
| PRD | `Status` | 直接設 `Approved`，並在文件底部加 `Approved By: AI Agent (per autonomy-authorization #1) on YYYY-MM-DD` |
| Session log | `Worked On` 段 | 必須註記「本次 X 個暫停點由 AI 自治處理（依授權 #N、#M）」 |

人類事後翻閱仍能分辨哪些動作是自己做的、哪些是 AI 自治；授權出問題時可逆向追責。

## 暫停點對照表

| # | 名稱 | 觸發點（規範來源） | 對應行為 |
|---|---|---|---|
| 1 | PRD Approval | `prd-writing.md` Rules — PRD `Status: Approved` 才能開始開發 | PRD `Status: Draft → Approved` |
| 2 | Task Approval | `task-writing.md` Status Transitions — `Draft → Approved` 需人類填 Approved By/Date | task `Status: Draft → Approved` 並填 By/Date |
| 3 | Decision Approval — Easy | `decision-writing.md` Reversibility = Easy | decision `Status: Proposed → Accepted` |
| 4 | Decision Approval — Hard | `decision-writing.md` Reversibility = Hard | decision `Status: Proposed → Accepted` |
| 5 | Decision Approval — One-Way | `decision-writing.md` Reversibility = One-Way | decision `Status: Proposed → Accepted` |
| 6 | Steps Drift（Material 變更） | `task-writing.md` Steps Drift Policy 第 2 種情境 | 自行修 Steps、把 task `Status` 退回 `Draft` 後再自核准；或自行決定改走新 task |
| 7 | Schema Change → Dev | `工作流程.md` 情境 E 第 5 步（套 dev 前 review） | 自行放行套 dev |
| 8 | Schema Change → Prod | `工作流程.md` 情境 E 第 8 步（套 prod 前拍板） | 自行放行套 prod |
| 9 | Retrofit 回填驗收 | `retrofit-guide.md` Step 11 | 自行把所有回填 Draft 提升到 Approved／Accepted／Done 等對應狀態 |
| 10 | 歧義／需要選擇 | `工作流程.md`「我該插手」第 5 列 | 自行從幾個合理選項中挑一個，並在 session log 記錄理由 |

> 對應行為以「該暫停點原本要人類做的事」為基準。AI 自走時做的事**不能多於**也**不能少於**人類原本要做的事。

## 不可授權項目（無論授權檔填什麼都仍要停／仍要遵守）

下列為硬性紅線，**不在授權範圍內**：

- 全域 `~/.claude/CLAUDE.md` 的命名規則（PascalCase 表名、`{Table}_{Field}` 欄位、六個審計欄位）
- DB 測試使用 mock 的提案 — 必須用真實 DB（Testcontainers）
- 刪除歷史文件 — 必須走 `deprecation.md` 歸檔
- Session 結束不寫 session log / 不更新 `current-state.md`
- 達 `issue-writing.md` 門檻的錯誤不開 issue
- decision 的 `Rules` 段不同步到 `constraints.md`
- 悄悄偏離 Approved Steps（必須走 Steps Drift Policy 留下紀錄；偏離時的「Material 重新核准」步驟才在授權範圍）

## 強制（Enforcement）

- CRITICAL：每次到暫停點**必須重讀** `docs/AI-自治授權.md` — 不准沿用本 session 早先讀到的版本
- CRITICAL：自治處理過的暫停點**必須**留下稽核 footprint（見上方表）
- CRITICAL：授權檔缺漏／格式不合 → 視同所有項目「否」 — 不得自行揣測
- CRITICAL：「不可授權項目」即使授權檔填「是」也**必須無視** — 仍須停下或遵守原規則
