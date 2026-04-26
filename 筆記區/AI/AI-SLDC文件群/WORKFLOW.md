# WORKFLOW — How You and the AI Work Together

> Time-ordered. For each scenario, this tells you **what you do first, then what the AI does next**.
> The rule files (`_rules/*`) tell the AI **how to write** each doc. This file tells you and the AI **how to hand off**.

Last Updated: 2026-04-26

---

## Scenario A: New Project — From Zero

### A1. One-time setup (do this once per project)

| Step | Who | Action |
|---|---|---|
| 1 | **You** | Copy the entire `筆記區/AI/AI-SLDC文件群/_rules/` folder into `<project>/docs/_rules/` |
| 2 | **You** | In `docs/`, create empty `current-state.md` (use the `current-state-writing.md` template, Phase = Planning, all fields "none yet") and an empty `constraints.md` |
| 3 | **You** | Copy the master-root `AI-Autonomy-Authorization-template.md` to `<project>/docs/AI-Autonomy-Authorization.md`. Fill `Yes`/`No` for each item based on how much you trust the AI on this project (every item must have a value) |

### A2. First conversation with the AI — produce the PRD

| Step | Who | Action |
|---|---|---|
| 3 | **You** | First sentence: "Start AI-SLDC flow. Read `docs/_rules/claude.md`, `ai-rules.md`, `current-state.md`, `constraints.md` first. Then begin: **<what the product should be>**" |
| 4 | **AI** | Runs Session Recovery Flow → detects no PRD exists → writes `docs/prd.md` per `prd-writing.md` (Status: Draft) |
| 5 | **You** | Review the PRD: are fields complete, are Goals measurable, is Out of Scope correct? If OK, set `Status: Approved` and add the date |

### A3. Generate tasks

| Step | Who | Action |
|---|---|---|
| 6 | **You** | "PRD is approved. Generate tasks per `task-writing.md`, each linked to a Requirement ID." |
| 7 | **AI** | Produces multiple task files in `docs/tasks/` (Status: Draft, concrete Steps, DoD, Verification, Related linking back to PRD F1/F2) |
| 8 | **You** | Review each task: are Steps concrete enough, is DoD measurable? If OK, set `Status: Approved`, fill `Approved By` and `Approved Date` |

### A4. Execute tasks (one cycle per task)

| Step | Who | Action |
|---|---|---|
| 9 | **You** | "Execute task `2026-04-26-xxx.md`" |
| 10 | **AI** | Sets task `Status: In Progress`, updates `current-state.md` `In Progress` |
| 11 | **AI** | Implements per Steps |
| 12 | **AI** | Runs Verification commands (dotnet test / pnpm lint / etc.) |
| 13 | **AI** | Records results in the task's Verification section, sets `Status: Done`, moves the entry from `In Progress` to `Recently Completed` in `current-state.md` |
| 14 | **AI** | Reports back: "Done what / commit hash / next step" |
| ↻ | | Repeat 9–14 until all tasks Done |

### A5. End of session (**every time**)

| Step | Who | Action |
|---|---|---|
| 15 | **You** | "Wrapping up." |
| 16 | **AI** | Writes a log at `docs/session-logs/YYYY-MM-DD-HHmm.md` (Worked On / Verification Run / Uncommitted Work / **Next Session Should**) |
| 17 | **AI** | Updates `current-state.md` again (even if nothing was completed this session) |
| 18 | **AI** | Lists uncommitted files and the concrete next command |

### A6. Next session

| Step | Who | Action |
|---|---|---|
| 19 | **You** | Repeat the §A2 step-3 sentence; the AI will pick up the most recent session log automatically and resume |

---

## Scenario B: Mid-Project Adoption (codebase already exists)

| Step | Who | Action |
|---|---|---|
| 1 | **You** | Copy `_rules/` into `<project>/docs/_rules/`, create empty `current-state.md` (leave it as the initial template) |
| 2 | **You** | "Start AI-SLDC flow, follow `docs/_rules/retrofit-guide.md` to backfill" |
| 3 | **AI** | Detects "current-state is initial template but codebase exists" → enters retrofit mode automatically |
| 4 | **AI** | Surveys codebase → backfills `prd.md`, `decisions/*`, `constraints.md`, `schema-changes/*`, `tasks/*` (completed = Done, in-progress = Draft), `onboarding/quick-start.md`, the first `session-logs/*` |
| 5 | **AI** | Marks every "reason unknown" field clearly for you to fill in |
| 6 | **You** | Review all backfilled docs, fill the unknown fields, set PRD to `Approved`, confirm Done tasks, set in-progress tasks to `Approved` |
| 7 | **Resume §A4** | From step 9, normal development cycle |

---

## Scenario C: Bug Fix

| Step | Who | Action |
|---|---|---|
| 1 | **You** | "**<bug symptom>**. Process per the flow." |
| 2 | **AI** | Compares against `issue-writing.md` threshold: if it qualifies → opens an issue (Status: Open, Severity, Reporter, Reproducibility); if not → tells you "this is just X, no issue needed" |
| 3 | **AI** | Investigates → finds root cause → writes `Root Cause` and `Investigation Process` in the issue |
| 4 | **AI** | Creates a **fix task** per `task-writing.md` (Status: Draft, Related linked to the issue) |
| 5 | **You** | Approve the fix task (set Status, fill Approved By/Date) |
| 6 | **AI** | Executes the fix → runs Verification → task `Status: Done` → issue `Status: Resolved` |
| 7 | **AI** | If the bug reveals a new rule → adds it to `constraints.md` (linked to the issue as source) |
| 8 | **AI** | Updates `current-state.md` |

---

## Scenario D: Architectural Decision (you're choosing A vs B)

| Step | Who | Action |
|---|---|---|
| 1 | **You** | "I'm considering **<Option A / Option B>**. Process per the flow." |
| 2 | **AI** | Writes a decision per `decision-writing.md` (Status: Proposed, Options, Pros/Cons, draft Reason, assesses Reversibility) |
| 3 | **You** | Make the call → set `Status: Accepted`, fill `Decision Maker`, `Date Decided`, confirm `Reversibility` |
| 4 | **AI** | Syncs the decision's `Rules` into `constraints.md` (each rule linked back to this decision as source) |
| 5 | **AI** | If this decision overrides an old one: set the old decision to `Status: Superseded`, fill its `Superseded By` (back-link) |
| 6 | **AI** | If the decision affects in-progress tasks → adds a link in their `Related`, possibly demotes them back to Draft |

---

## Scenario E: DB Schema Change

| Step | Who | Action |
|---|---|---|
| 1 | **You** | "Need to add **<table/column>**. Process per the flow." |
| 2 | **AI** | Writes a record per `schema-change-writing.md` (Status: Planned) |
| 3 | **AI** | Runs naming compliance check (PascalCase tables, `{Table}_{Field}` columns, six audit fields) — stops and tells you if anything fails |
| 4 | **AI** | Writes Rollback Plan, assesses Reversibility |
| 5 | **You** | Review the schema-change record. Only proceed if you OK it |
| 6 | **AI** | Generates migration → applies to dev → Status: Applied (Dev) |
| 7 | **AI** | Runs migration tests |
| 8 | **You** | Confirm dev is fine → green-light prod |
| 9 | **AI** | Applies to prod → Status: Applied (Prod), fills `Applied On.Prod` |

---

## Scenario F: Writing Tests (new feature / bug regression)

| Step | Who | Action |
|---|---|---|
| 1 | **AI** | Opens a test doc per `test-writing.md` (Status: Planned, lists Test Cases) |
| 2 | **AI** | Writes test code, runs once → Status: RED (fails as expected) |
| 3 | **AI** | Writes implementation → runs tests → Status: GREEN |
| 4 | **AI** | Records verification results in the corresponding task's Verification section and in the session log |
| 5 | **AI** | If passes again next session without flake → Status: Stable |

> Note: DB tests must use a real DB (Testcontainers). If the AI proposes mocking the DB, stop it immediately.

---

## Scenario G: Doc Becomes Obsolete / Direction Changes

| Step | Who | Action |
|---|---|---|
| 1 | **You** | "**<some decision/task/test>** no longer applies" |
| 2 | **AI** | Per `deprecation.md`: prepends a Deprecation Note block (Reason, Deprecated On/By, Superseded By if applicable) to the file |
| 3 | **AI** | Moves it to `/docs/_archive/<original-folder>/<original-filename>.md` |
| 4 | **AI** | Updates all incoming links pointing at it, updates `current-state.md` |
| 5 | **AI** | Constraint special case: in `constraints.md`, mark with strikethrough — do NOT move out |

---

## When You MUST Step In (governed by the authorization file)

Every time the AI hits a "wait for human" pause point, it **first re-reads `docs/AI-Autonomy-Authorization.md`** (per `_rules/autonomy-authorization.md`) before deciding to stop or proceed. So **this table is "what you must do when the matching authorization item is `No`"**:

| Trigger | Authorization item | What you must do when item = `No` |
|---|---|---|
| AI finishes PRD Draft | #1 | Set Status to `Approved` |
| AI finishes task Draft (incl. bug-fix tasks) | #2 | Set Status to `Approved`, fill Approved By/Date |
| AI finishes decision Proposed (Easy) | #3 | Set Status to `Accepted`, fill Decision Maker / Date Decided |
| AI finishes decision Proposed (Hard) | #4 | Same as above |
| AI finishes decision Proposed (One-Way) | #5 | Same as above (**strongly recommended to keep at `No` permanently**) |
| AI detects material Steps Drift | #6 | Re-approve the task that was demoted to Draft |
| AI finishes schema-change Planned, wants dev | #7 | Green-light dev |
| AI finishes schema-change Applied (Dev), wants prod | #8 | Sign off prod (**strongly recommended to keep at `No` permanently**) |
| Retrofit backfill is complete (all Drafts) | #9 | Review backfill, fill unknowns, promote Drafts to Approved |
| AI reports ambiguity / asks you to choose | #10 | Make the call or supply more info |

**Items where authorization is `Yes`**, the AI proceeds, fills `AI Agent (per autonomy-authorization #N)` in the corresponding field, and notes it in the session log. Changes to the authorization file take effect immediately at the very next pause point — no ceremony required.

**Items that CANNOT be authorized** (still enforced even if the file says `Yes`): naming-rule violations, DB mocks, deleting historical docs, skipping the session log, ignoring threshold-meeting errors, failing to sync decision rules to constraints, silently deviating from approved Steps.

---

## One-Page Cheat Sheet (for forgetful future-me)

```
You         AI
│
├─ "Start AI-SLDC flow, do X"
│           ├─ Read claude.md / ai-rules.md / current-state / constraints / latest session log
│           ├─ Produce PRD/task/decision/issue/schema-change Draft
│           ↓
├─ Review, Approve (set Status, fill name & date)
│           ↓
│           ├─ Execute → Verification → update current-state.md
│           ↓
├─ (give feedback or let it continue)
│           ↓
├─ "Wrapping up"
│           ├─ Write session log (with Next Session Should)
│           ├─ Update current-state.md
│           └─ Report: done / not done / next step
↓
(Next session, start from step 1; the AI auto-resumes from the last Next Session Should)
```
