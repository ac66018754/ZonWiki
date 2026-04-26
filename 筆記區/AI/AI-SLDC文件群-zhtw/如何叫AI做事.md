# 如何叫 AI 做事 — 給未來的我

> 這份是給很久以後的我看的「快、安、穩」操作手冊。
> 假設未來的我已經忘光 AI-SLDC 是什麼，只想趕快讓 AI 幫我把事做掉。
> **看這份就夠。**

最後更新：2026-04-26

---

## 一、先決條件（每個專案開頭做一次）

每個專案都要有 `docs/_rules/`，內容**從這個母本資料夾複製**：

```
複製來源：筆記區/AI/AI-SLDC文件群-zhtw/_rules/
複製目的：<目標專案>/docs/_rules/
```

複製完後，依專案需要微調（測試覆蓋率門檻、命名豁免等）。
**不要讓母本和專案版分支太遠** — 母本永遠是最新版，專案版是當下凍結版。

**還要做一件事**：把母本根目錄的 `AI-自治授權-範本.md` 複製到 `<專案>/docs/AI-自治授權.md`，依該專案信任 AI 的程度填入「是／否」。AI 每次遇到「停下等人類」的暫停點都會重讀這個檔案決定要停下還是自走。沒這檔案 → 所有項目視同「否」，AI 永遠停下等你。

每個專案根目錄不需要再寫 CLAUDE.md，全域 `~/.claude/CLAUDE.md` 已經有 startup sequence。
專案專有規則寫進 `docs/constraints.md` — AI 啟動時必讀。

---

## 二、跟 AI 開工的第一句話（指令入口）

不論做任何事，第一句話都這樣下：

> 「按 AI-SLDC 流程開工。先讀 `docs/_rules/claude.md`、`docs/_rules/ai-rules.md`、`docs/current-state.md`、`docs/constraints.md`、最新一筆 `docs/session-logs/`。再開始做：**<我要的事>**」

如果該專案是中途導入 AI-SLDC（已經有程式碼但 docs 是空的）：

> 「按 AI-SLDC 流程開工，先讀 `docs/_rules/retrofit-guide.md`，依步驟回填 PRD / decisions / constraints / tasks / current-state / onboarding，產生 Draft 等我 review。」

讀完入口後，AI 就知道後續每種情境（新功能、修 bug、改 schema、寫測試、結束 session、歸檔等）該翻哪份規範 —— `claude.md` 的「規範索引」會帶它到正確的檔案。**不必每次背一串指令。**

---

## 三、AI 出錯時最常見的修法

| 症狀 | 你該說 |
|---|---|
| AI 沒讀 rules 直接開工 | 「先停。重來：讀 `docs/_rules/claude.md`，按 Session Recovery Flow 走完再說。」 |
| AI 跳過 task 直接寫 code | 「停。沒有 `Status: Approved` 的 task 不准寫 code。先依 `task-writing.md` 開 task。」 |
| AI 沒記 decision | 「停。剛才那個選擇是架構決策，依 `decision-writing.md` 補一份紀錄，並同步 Rules 到 `constraints.md`。」 |
| AI 改了 Steps 沒講 | 「停。依 `task-writing.md` 的 Steps Drift Policy 處理：minor 就 in-place 更新；material 就把 task 重設 Draft 等我 approve。」 |
| AI 寫文件但沒交叉連結 | 「補 `## 相關連結` 段，依 `ai-rules.md` 的交叉引用要求。」 |
| AI 結束 session 沒寫 log | 「依 `session-log-writing.md` 補今天的 log，再收工。」 |
| AI 想刪除舊文件 | 「停。依 `deprecation.md` 歸檔，不准刪。」 |
| AI 寫 DB 測試用 mock | 「停。DB 測試一律用真實 DB（Testcontainers），重寫。」 |

---

## 四、安全紅線（直接複製貼給 AI）

> 不准在沒有 `Status: Approved` task 的情況下寫任何 code。
> 不准刪文件，過期就走 `deprecation.md` 歸檔。
> 不准只把 decision 寫進 decision 檔，必須同步到 `constraints.md`。
> 不准用 mock DB 寫 DB-touching 測試。
> 不准違反全域 CLAUDE.md 命名規則寫 schema。
> 不准結束 session 沒更新 `current-state.md` + 寫 session log。
> 不准悄悄改變 task 的 Steps — 依 Steps Drift Policy 處理。
> 每次到「等人類」暫停點，必須重讀 `docs/AI-自治授權.md`（依 `_rules/autonomy-authorization.md`），自治處理過的暫停點要留下 `AI Agent (per autonomy-authorization #N)` footprint。

## 四之二、AI 自治授權怎麼控制

`docs/AI-自治授權.md` 是「我這個專案讓 AI 自己決定到哪裡為止」的開關。10 個項目（PRD / Task / Decision Easy/Hard/One-Way / Steps Drift / Schema dev/prod / Retrofit / 歧義）每項填「是」或「否」。

- 改了就生效，下個暫停點立刻採用 — 不用 commit、不用通知 AI。
- 想全部交給 AI 走完？把 1～4、6、7、9、10 都填「是」（5、8 仍建議「否」，避開 One-Way decision 與 prod migration）。
- 想全程嚴格人工？全部填「否」，等同退回原本最謹慎的流程。
- 想 review 中間 AI 自治處理過什麼？看 session log 的 `Worked On` 段，AI 必填「本次 X 個暫停點由 AI 自治處理（依授權 #N、#M）」。

**永遠不可授權的紅線**：命名規則、DB mock、刪歷史、跳過 session log、達門檻錯誤不開 issue、decision 不同步 constraints、悄悄偏離 Steps — 即使授權檔填「是」，AI 仍要遵守。

---

## 五、為什麼這套有效（只記三點）

1. **入口固定**：每次都從 `docs/_rules/claude.md` 開始 → AI 不會自己發明流程；裡面的「規範索引」列出全部 14 份規範該何時讀。
2. **產出可稽核**：task 有 `Approved By/Date`、decision 有 `Decision Maker/Date Decided/Reversibility`、issue 有 `Severity/Reporter`、schema change 有 `命名合規檢查`、session log 留下每次 session 的軌跡 → 後人能還原為什麼當時做這個決定。
3. **歷史不消失**：session-log 補 history、deprecation 規定舊文不刪只歸檔、decision 的 Supersedes/Superseded By 雙向連結 → 接手者能還原脈絡。

---

## 六、母本目錄結構速查

```
筆記區/AI/AI-SLDC文件群-zhtw/
├── _rules/
│   ├── claude.md                  ← 入口、Session Recovery Flow、規範索引
│   ├── ai-rules.md                ← 全域行為規則
│   ├── prd-writing.md
│   ├── task-writing.md            ← 含 Approved By/Date、Verification、狀態轉移、Steps Drift Policy
│   ├── issue-writing.md           ← 含 開單門檻、Severity、Reporter、Reproducibility
│   ├── decision-writing.md        ← 含 Status、Decision Maker、Reversibility、Superseded By 雙向
│   ├── current-state-writing.md
│   ├── constraints-writing.md
│   ├── onboarding-writing.md
│   ├── session-log-writing.md     ← 每個 session 結束必填
│   ├── test-writing.md            ← TDD 流程、RED→GREEN→Stable
│   ├── schema-change-writing.md   ← DB 變更紀錄、命名合規檢查
│   ├── deprecation.md             ← 歸檔規則（不刪只歸）
│   ├── glossary.md                ← 專案術語定義
│   ├── retrofit-guide.md          ← 中途導入才用
│   └── autonomy-authorization.md  ← 規範如何讀 docs/AI-自治授權.md
├── AI-自治授權-範本.md             ← 給每個專案複製到 docs/AI-自治授權.md
└── 如何叫AI做事.md                 ← 本文件（給未來的我的入口）
```

每個實際專案下會有 `docs/_rules/` 是這份母本的副本（可微調，但別跟母本分支太遠）。

---

## 七、最低限度的「我做了什麼／下一步」回報

下指令時加這句，AI 永遠會老實講：

> 「每次回報請以這三段收尾：**(1) 本次 session 做完什麼**（含 commit hash 或 task 連結）；**(2) 還沒做完什麼**（含原因）；**(3) 下一步具體要做什麼**（含可執行命令）。」

這句搭配 session-log-writing.md，可以保證即使我幾個月後回來，也能 30 秒內接手。
