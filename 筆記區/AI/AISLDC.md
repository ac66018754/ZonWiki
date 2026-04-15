為了最大化減少人力成本，
讓 AI 能順利自己開發完專案，
又能讓人類在必要時刻進場介入時，
可以快速掌握專案全貌與遇到的問題，
必須要讓 AI 在開發前、開發中、開發後、維運期間皆產出足夠且品質好的文件。


方法:
1. 複製整包到專案根目錄，結構如下。
   注意: CLAUDE.md 必須放在專案根目錄（不是 docs 裡面），這是 Claude Code 唯一會自動讀取的檔案，
   它負責引導 AI 去讀 docs/_rules/ 下的所有規則。
/docs
    /_rules (AI 行為與寫文件規則)
        ai-rules.md
        claude.md
        prd-writing.md
        task-writing.md
        issue-writing.md
        decision-writing.md
        onboarding-writing.md
        current-state-writing.md
        constraints-writing.md
        retrofit-guide.md

    /tasks (AI 產生任務)
        2026-04-15-checkout.md

    /issues (問題紀錄（每一筆一檔）)
        2026-04-15-login-bug.md

    /decisions (決策紀錄)
        2026-04-15-db-choice.md

    /onboarding (啟動文件)
        quick-start.md

    prd.md              ← 需求文件（所有 task 的源頭）
    current-state.md    ← 交接核心（初始模板已預置）
    constraints.md      ← 專案約束（初始模板已預置）

CLAUDE.md               ← 放在專案根目錄！Claude Code 自動讀取的入口


# 1. CLAUDE.md 內容:
"""
# AI-SLDC System Instructions

## CRITICAL: Documentation-First Development

You MUST read and follow ALL rules under `docs/_rules/` before doing any work.

### Startup Sequence (MANDATORY)

Every time you start a session, execute this in order:

1. Read `docs/_rules/ai-rules.md` — understand global rules
2. Read `docs/_rules/claude.md` — understand execution flow and session recovery
3. Read `docs/current-state.md` — understand where the project is right now
4. Read `docs/constraints.md` — understand non-negotiable rules

If `current-state.md` is the initial template BUT source code already exists → read `docs/_rules/retrofit-guide.md` and follow its process.

### Rule Files Reference

| File | When to read |
|------|-------------|
| `docs/_rules/ai-rules.md` | Always (startup) |
| `docs/_rules/claude.md` | Always (startup) |
| `docs/_rules/prd-writing.md` | When creating or updating PRD |
| `docs/_rules/task-writing.md` | When creating or updating tasks |
| `docs/_rules/issue-writing.md` | When an error or problem occurs |
| `docs/_rules/decision-writing.md` | When making technical or architectural choices |
| `docs/_rules/onboarding-writing.md` | When writing setup guides |
| `docs/_rules/current-state-writing.md` | When updating current-state.md |
| `docs/_rules/constraints-writing.md` | When updating constraints.md |
| `docs/_rules/retrofit-guide.md` | Only when adopting AI-SLDC into an existing project |

### Enforcement

- DO NOT write code without an Approved task document
- DO NOT end a session without updating `docs/current-state.md`
- DO NOT make architectural choices without a decision record
- DO NOT skip documentation for any reason

"""

# 2. AI-SLDC 全新專案合作流程 速覽

> 本文件描述：當專案從 Day 0 開始，人類與 AI 如何在 AI-SLDC 文件架構下合作。
> 若專案已經在開發中才導入，請參考 `AI-SLDC文件群/_rules/retrofit-guide.md`。

---

## Phase 0: 初始化

| 誰做 | 做什麼 |
|------|--------|
| **人類** | 複製整包 `docs/` 到專案根目錄 |
| **人類** | 在 CLAUDE.md（或專案的 prompt）告訴 AI：「遵守 `docs/_rules/` 下所有規則」 |

此時資料夾長這樣：
```
/docs
    /_rules/          ← 10 份撰寫規範（含 retrofit-guide.md）
    /tasks/           ← 空
    /issues/          ← 空
    /decisions/       ← 空
    /onboarding/      ← 空
    current-state.md  ← 初始模板（Phase: Planning）
    constraints.md    ← 初始模板（空）
```

---

## Phase 1: 需求定義

| 步驟 | 誰做 | 做什麼 |
|------|------|--------|
| 1 | **人類** | 用自然語言告訴 AI 想做什麼（例如「我要做一個線上書店」） |
| 2 | **AI** | 讀 `claude.md` → 發現沒有 PRD → 依照 `prd-writing.md` 產出 `docs/prd.md`（Status: Draft） |
| 3 | **人類** | Review PRD，提出修改意見（「不需要金流」「要支援多語系」） |
| 4 | **AI** | 修改 PRD |
| 5 | **人類** | 確認 OK → 告訴 AI「PRD approved」 |
| 6 | **AI** | 將 PRD Status 改為 `Approved`，更新 `current-state.md` |

---

## Phase 2: 規劃

| 步驟 | 誰做 | 做什麼 |
|------|------|--------|
| 7 | **AI** | 依照 PRD 的 Functional Requirements，逐條產出 task 檔案（Status: Draft），每個 task 對應到 PRD 的需求 ID |
| 8 | **AI** | 遇到技術選型（DB? 框架?）→ 依照 `decision-writing.md` 產出 decision 紀錄 → 同步規則到 `constraints.md` |
| 9 | **人類** | Review 所有 tasks 和 decisions，提出修改意見 |
| 10 | **人類** | 確認 OK → 告訴 AI「tasks approved」 |
| 11 | **AI** | 將 task Status 改為 `Approved`，更新 `current-state.md`（Phase 改為 Development） |

此時資料夾：
```
/docs
    /tasks/
        2026-04-16-setup-project.md      ← Approved
        2026-04-16-user-auth.md          ← Approved
        2026-04-16-book-listing.md       ← Approved
        ...
    /decisions/
        2026-04-16-db-choice.md
        2026-04-16-framework-choice.md
    prd.md            ← Approved
    current-state.md  ← Phase: Development, In Progress 列出第一個 task
    constraints.md    ← 已有技術約束
```

---

## Phase 3: 開發

| 步驟 | 誰做 | 做什麼 |
|------|------|--------|
| 12 | **AI** | 依照 task 順序（尊重 depends on 關係）逐一開發 |
| 13 | **AI** | 每完成一個 task → task Status 改 `Done` → 更新 `current-state.md` |
| 14 | **AI** | 遇到 bug 或問題 → 依照 `issue-writing.md` 產出 issue → 連結到對應 task |
| 15 | **AI** | 遇到需要技術決策 → 產出 decision → 同步 constraints |
| 16 | **AI** | 開發過程中若發現 PRD 有遺漏或矛盾 → **停下來通知人類**，不自行決定 |
| 17 | **人類** | （可隨時插入）檢查 `current-state.md` 掌握進度，review issue 和 decision |

### Session 中斷恢復

如果中途 session 斷了（電腦關機、context 遺失）：

| 誰做 | 做什麼 |
|------|--------|
| **AI（新 session）** | 執行 Session Recovery Flow：讀 `current-state.md` → `constraints.md` → 最近的 tasks → open issues → 繼續工作 |

---

## Phase 4: AI 自行驗證

| 步驟 | 誰做 | 做什麼 |
|------|------|--------|
| 18 | **AI** | 所有 task 都 Done 後，逐一比對每個 task 的 Definition of Done |
| 19 | **AI** | 比對 PRD 的 Acceptance Criteria（整體驗收標準） |
| 20 | **AI** | 若有未通過的項目 → 產出 issue 或修復後更新 task |
| 21 | **AI** | 全部通過 → 更新 `current-state.md`（Phase 改為 Testing） |
| 22 | **AI** | 依照 `onboarding-writing.md` 產出 `onboarding/quick-start.md`（讓人類知道怎麼跑起來） |

---

## Phase 5: 人類手動驗證

| 步驟 | 誰做 | 做什麼 |
|------|------|--------|
| 23 | **人類** | 讀 `onboarding/quick-start.md` → 把系統跑起來 |
| 24 | **人類** | 對照 PRD 的 Acceptance Criteria 逐項驗收 |
| 25 | **人類** | 發現問題 → 告訴 AI → AI 產出 issue → 修復 → 回到 Step 18 |
| 26 | **人類** | 全部通過 → 更新 `current-state.md`（Phase 改為 Production） |

---

## 一句話總結

```
人類出需求 → AI 寫 PRD → 人類 approve → AI 拆 task → 人類 approve
→ AI 開發（自動記錄 issue/decision）→ AI 自驗 → 人類驗收
```

**人類的角色只有三個：提需求、approve、驗收。**
中間過程全部有文件可追溯，任何時刻斷線都能從 `current-state.md` 接回來。
