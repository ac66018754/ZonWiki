# CLAUDE SYSTEM INSTRUCTION

You must follow ALL rules under `/docs/_rules`.
Violating documentation rules is treated as a CRITICAL error.

---

## Rules Index (THE ENTRY POINT — read this first to know HOW to write each document)

All rules live in `/docs/_rules/`. After reading this file, you know which rule file to consult for each situation.

| Rule File | When to read |
|---|---|
| `ai-rules.md` | Always (startup) — global behavior rules |
| `claude.md` | Always (startup) — this file, execution flow & rules index |
| `prd-writing.md` | When creating or updating the project PRD |
| `task-writing.md` | When creating, updating, approving, or executing a task |
| `issue-writing.md` | When recording an error that meets the threshold |
| `decision-writing.md` | When recording a technical / architectural choice |
| `current-state-writing.md` | When updating `current-state.md` |
| `constraints-writing.md` | When updating `constraints.md` |
| `onboarding-writing.md` | When writing or updating setup guides |
| `session-log-writing.md` | At the END of every work session — append-only history |
| `test-writing.md` | When writing test plans / test records |
| `schema-change-writing.md` | When changing DB schema |
| `deprecation.md` | When archiving expired tasks, decisions, or constraints |
| `glossary.md` | When using a project-specific term — verify meaning here first |
| `retrofit-guide.md` | ONLY when adopting AI-SLDC into an existing project (mid-project) |
| `autonomy-authorization.md` | EVERY time you hit a "wait for human" pause point — defines how to read `docs/AI-Autonomy-Authorization.md` |

If a rule file referenced above is missing from this project's `/docs/_rules/`, treat it as a CRITICAL gap — stop and surface to the human before continuing.

---

## Session Recovery Flow (CRITICAL)

When starting a new session, or when context is lost, you MUST follow this sequence BEFORE doing any work:

1. Read `claude.md` (this file) — know the rules index and execution flow
2. Read `ai-rules.md` — global behavior rules
3. Read `current-state.md` — understand project phase and what is in progress
4. Read `constraints.md` — understand non-negotiable rules
5. Read the most recent file in `/session-logs/` (newest first) — know what the previous session left behind
6. Read recent tasks in `/tasks/` (sorted by date, newest first)
7. Read open issues in `/issues/` (check for unresolved blockers)
8. Read recent decisions in `/decisions/` (check for context on why things are the way they are)
9. ONLY THEN begin working

If `current-state.md` is missing or clearly stale (>3 days old), treat this as a CRITICAL issue and update it before proceeding.

**Retrofit detection:** If `current-state.md` is still the initial template (Phase: Planning, all fields are "none yet") BUT the project directory already contains source code, config files, or git history — this is a mid-project adoption. You MUST read and follow `retrofit-guide.md` BEFORE doing any other work. Do NOT start the normal Phase 1 flow.

**Autonomy authorization check (applies throughout the entire flow):** ANY time this system tells you to "wait for human" (PRD/Task/Decision Approval, Steps Drift material re-approval, Schema → Dev/Prod sign-off, Retrofit overall review, ambiguity-driven choice, etc.), you MUST first re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md`, then decide whether to stop or proceed. Re-read every time. NEVER reuse a value read earlier in the same session.

---

## Execution Flow

1. Read `ai-rules.md`

2. If feature request:
   → Check if PRD exists; if not, create one using `prd-writing.md`
   → PRD MUST be Approved before generating tasks
   → Generate tasks using `task-writing.md` (tasks start as Draft)
   → Tasks MUST be Approved by human (Approved By + Approved Date filled) before development begins
   → MUST NOT write code for any task that is not `Status: Approved`

3. If error occurs (and meets the threshold in `issue-writing.md`):
   → Create issue using `issue-writing.md`
   → Link issue to related task

4. If decision made:
   → Record decision using `decision-writing.md`
   → Sync decision rules to `constraints.md`
   → If this decision overrides an older one, update both files (Supersedes + Superseded By back-link)

5. If DB schema changes:
   → Record change using `schema-change-writing.md` BEFORE running the migration

6. If writing tests:
   → Follow `test-writing.md` (TDD: RED → GREEN → Stable)

7. Execute tasks

8. After EACH task completion:
   → Update `current-state.md`
   → Move task in current-state.md from `In Progress` to `Recently Completed`
   → Check if related documents need updating

9. At session end:
   → Update `current-state.md` (even if no task was completed)
   → Append a session-log entry per `session-log-writing.md` (MANDATORY, even if session was short)
   → Ensure all new issues / decisions / schema changes are properly linked

---

## Enforcement

- CRITICAL: DO NOT write code without an Approved task document
- CRITICAL: DO NOT end a session without updating `current-state.md` AND writing a session log
- CRITICAL: DO NOT make architectural choices without a decision record
- CRITICAL: DO NOT ignore errors that meet the threshold — every qualifying error becomes an issue record
- CRITICAL: DO NOT delete historical docs — archive per `deprecation.md`
- CRITICAL: DO NOT silently deviate from a task's approved Steps — follow the Steps Drift Policy in `task-writing.md`
- CRITICAL: At every "wait for human" pause point, you MUST re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md`. NEVER cache. NEVER guess at missing values. Every autonomously handled pause point MUST leave an `AI Agent (per autonomy-authorization #N)` audit footprint.
