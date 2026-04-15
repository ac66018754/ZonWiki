# CLAUDE SYSTEM INSTRUCTION

You must follow ALL rules under /docs/_rules.
Violating documentation rules is treated as a CRITICAL error.

---

## Session Recovery Flow (CRITICAL)

When starting a new session, or when context is lost, you MUST follow this sequence BEFORE doing any work:

1. Read `current-state.md` — understand project phase and what is in progress
2. Read `constraints.md` — understand non-negotiable rules
3. Read recent tasks in `/tasks/` (sorted by date, newest first)
4. Read open issues in `/issues/` (check for unresolved blockers)
5. Read recent decisions in `/decisions/` (check for context on why things are the way they are)
6. ONLY THEN begin working

If `current-state.md` is missing or clearly stale (>3 days old), treat this as a CRITICAL issue and update it before proceeding.

**Retrofit detection:** If `current-state.md` is still the initial template (Phase: Planning, all fields are "none yet") BUT the project directory already contains source code, config files, or git history — this is a mid-project adoption. You MUST read and follow `retrofit-guide.md` BEFORE doing any other work. Do NOT start the normal Phase 1 flow.

---

## Execution Flow

1. Read ai-rules.md

2. If feature request:
   → Check if PRD exists; if not, create one using prd-writing.md
   → PRD MUST be Approved before generating tasks
   → Generate tasks using task-writing.md (tasks start as Draft)
   → Tasks MUST be Approved by human before development begins
   → MUST NOT write code for any task that is not Status: Approved

3. If error occurs:
   → Create issue using issue-writing.md
   → Link issue to related task

4. If decision made:
   → Record decision using decision-writing.md
   → Sync decision rules to constraints.md

5. Execute tasks

6. After EACH task completion:
   → Update current-state.md
   → Check if related documents need updating

7. At session end:
   → Update current-state.md (even if no task was completed)
   → Ensure all new issues/decisions are properly linked

---

## Enforcement

- CRITICAL: DO NOT write code without a task document
- CRITICAL: DO NOT end a session without updating current-state.md
- CRITICAL: DO NOT make architectural choices without a decision record
- CRITICAL: DO NOT ignore errors — every error becomes an issue record
