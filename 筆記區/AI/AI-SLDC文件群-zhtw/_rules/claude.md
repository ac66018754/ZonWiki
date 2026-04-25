# CLAUDE 系統指令

你必須遵守 `/docs/_rules` 底下的所有規範。
違反任何文件規範視為 CRITICAL 等級錯誤。

---

## 規範索引（**入口** — 先讀這裡，才知道每種文件該怎麼寫）

所有規範都放在 `/docs/_rules/`。讀完這份檔案後，你就知道遇到什麼狀況該翻哪份規範。

| 規範檔案 | 何時讀 |
|---|---|
| `ai-rules.md` | 每次開工（startup）— 全域行為規則 |
| `claude.md` | 每次開工（startup）— 本檔，執行流程與規範索引 |
| `prd-writing.md` | 建立或更新專案 PRD 時 |
| `task-writing.md` | 建立、更新、核准或執行 task 時 |
| `issue-writing.md` | 記錄達門檻的錯誤時 |
| `decision-writing.md` | 記錄技術／架構決策時 |
| `current-state-writing.md` | 更新 `current-state.md` 時 |
| `constraints-writing.md` | 更新 `constraints.md` 時 |
| `onboarding-writing.md` | 撰寫或更新環境啟動指引時 |
| `session-log-writing.md` | 每次 session 結束 — append-only 歷史紀錄 |
| `test-writing.md` | 撰寫測試計畫／測試紀錄時 |
| `schema-change-writing.md` | 變更 DB schema 時 |
| `deprecation.md` | 歸檔過期 task / decision / constraint 時 |
| `glossary.md` | 使用專案專有術語前 — 先到此確認意義 |
| `retrofit-guide.md` | **僅限**將 AI-SLDC 中途導入既有專案時 |

如果上表中的規範檔案在這個專案的 `/docs/_rules/` 缺漏，視為 CRITICAL 缺口 — 立刻停下並回報給人類。

---

## Session Recovery Flow（CRITICAL）

開新 session 時，或遺失 context 時，**動工前必須**依下列順序讀完：

1. 讀 `claude.md`（本檔）— 了解規範索引與執行流程
2. 讀 `ai-rules.md` — 全域行為規則
3. 讀 `current-state.md` — 了解專案現在進度與進行中項目
4. 讀 `constraints.md` — 了解不可協商的規則
5. 讀 `/session-logs/` 中最新一份（依日期遞減）— 知道上一個 session 留下什麼
6. 讀 `/tasks/` 最近的 task（依日期遞減）
7. 讀 `/issues/` 中 Open 狀態的 issue（檢查未解 blocker）
8. 讀 `/decisions/` 最近的 decision（了解現況的成因）
9. **以上完成才開始做事**

如果 `current-state.md` 不存在，或明顯過期（>3 天未更新），視為 CRITICAL 問題 — 先更新它再繼續。

**Retrofit 偵測：** 如果 `current-state.md` 仍是初始模板（Phase: Planning、所有欄位都 "none yet"）**但專案目錄已經有原始碼、設定檔或 git 歷史** — 這是中途導入情境。**必須**先讀並依照 `retrofit-guide.md` 執行回填，**不得**直接走全新專案 Phase 1 流程。

---

## 執行流程

1. 讀 `ai-rules.md`

2. 若收到功能需求：
   → 檢查 PRD 是否存在；若無，依 `prd-writing.md` 建立
   → PRD **必須**先 Approved 才能產 task
   → 依 `task-writing.md` 產 task（task 初始為 Draft）
   → Task **必須**經人類核准（填好 Approved By + Approved Date）才能開始開發
   → **不得**對 `Status: Draft` 或未 Approved 的 task 寫任何 code

3. 若發生錯誤（且達到 `issue-writing.md` 的開單門檻）：
   → 依 `issue-writing.md` 開 issue
   → 將 issue 連結到相關 task

4. 若做出決策：
   → 依 `decision-writing.md` 記錄
   → 將 decision 的 Rules 同步到 `constraints.md`
   → 若此 decision 取代舊 decision，**雙向**更新（Supersedes + Superseded By）

5. 若變更 DB schema：
   → 在執行 migration **之前**，先依 `schema-change-writing.md` 寫紀錄

6. 若撰寫測試：
   → 依 `test-writing.md`（TDD：RED → GREEN → Stable）

7. 執行 task

8. 每完成一個 task：
   → 更新 `current-state.md`
   → 把 task 從 `In Progress` 移到 `Recently Completed`
   → 檢查相關文件是否需更新

9. Session 結束時：
   → 更新 `current-state.md`（**即使這次什麼都沒完成**也要更新）
   → 依 `session-log-writing.md` 新增一筆 session log（**強制**，即使 session 很短）
   → 確認新增的 issue / decision / schema change 都有正確連結

---

## 強制（Enforcement）

- CRITICAL：沒有 Approved task 不得寫 code
- CRITICAL：Session 結束不得不更新 `current-state.md` 與 session log
- CRITICAL：架構選擇不得沒有 decision 紀錄
- CRITICAL：達門檻的錯誤不得忽略 — 一律建立 issue
- CRITICAL：歷史文件不得刪除 — 依 `deprecation.md` 歸檔
- CRITICAL：不得悄悄偏離 task 的 Approved Steps — 依 `task-writing.md` 的 Steps Drift Policy 處理
