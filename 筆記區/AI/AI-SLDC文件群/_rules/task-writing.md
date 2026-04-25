# TASK WRITING RULES

When given a feature request, you MUST generate tasks.

## File Location
/docs/tasks/YYYY-MM-DD-<short-name>.md

## Rules
- Break feature into smallest executable tasks
- Each task must be completable within 1 hour
- Each task must have clear input/output
- Each task must include `Last Updated` date

## Required Structure

```
# TASK: <name>

Last Updated: YYYY-MM-DD
Status: Draft | Approved | In Progress | Done | Blocked
Approved By: <human name> | <pending>
Approved Date: YYYY-MM-DD | <pending>

## Objective
What to achieve.

## Target Files
Exact file paths to be touched.

## Input
Request format / preconditions.

## Output
Response format / postconditions.

## Steps
Step-by-step concrete actions. NO abstraction.

  ✅ Good (concrete, executable):
    - "Run `dotnet ef migrations add AddCommentTable` in src/ZonWiki.Infrastructure"
    - "Edit src/ZonWiki.Api/Program.cs around line 42, add `services.AddScoped<ICommentService, CommentService>()`"
    - "In frontend/app/articles/[slug]/page.tsx, replace the placeholder div with `<CommentList articleId={article.id} />`"

  ❌ Bad (abstract, ambiguous):
    - "Add migration for comment table"
    - "Register CommentService in DI"
    - "Wire up the comment UI"

## Definition of Done
Measurable conditions ONLY. No "looks good" / "should work".

  Examples:
    - "All tests in tests/ZonWiki.Api.Tests pass (`dotnet test`)"
    - "GET /api/comments returns 200 with body matching CommentDto[] shape"
    - "Lint passes with 0 warnings (`pnpm lint`)"

## Verification
How to PROVE Definition of Done is met:

- Exact command(s) to execute
- Exact URL(s) to inspect
- Who verifies: AI self-check / human manual / both
- Where the verification result is recorded (usually the session log)

## Constraints
- Must follow global constraints
- Must follow rules in `constraints.md`

## Related
- Requirement: F1 / NF2 in [PRD](../prd.md) — which PRD requirement(s) this task fulfills (REQUIRED if PRD exists)
- Decision: [title](../decisions/YYYY-MM-DD-xxx.md) — if this task was shaped by a decision
- Issue: [title](../issues/YYYY-MM-DD-xxx.md) — if this task was created to fix an issue
- Tests: [title](../tests/YYYY-MM-DD-xxx.md) — test plan / record for this task
- Schema Change: [title](../schema-changes/YYYY-MM-DD-xxx.md) — if this task changes DB schema
- Depends on: [title](../tasks/YYYY-MM-DD-xxx.md) — if this task depends on another task
- Blocks: [title](../tasks/YYYY-MM-DD-xxx.md) — if another task is waiting on this one
```

## Status Transitions

| From → To | Required Conditions |
|---|---|
| Draft → Approved | Human reviewed and filled `Approved By` + `Approved Date` |
| Approved → In Progress | Operator (human or AI) started executing the first Step; current-state.md `In Progress` updated |
| In Progress → Done | All Definition of Done items pass; Verification commands actually executed; result recorded in session log |
| In Progress → Blocked | A blocker exists; an issue record MUST be created and linked in `## Related`; current-state.md `Blockers` updated |
| Blocked → In Progress | Linked blocking issue is `Status: Resolved` |
| Any → (deleted) | FORBIDDEN — use `deprecation.md` to archive instead |

**MUST NOT skip Approved.** AI MUST NOT execute a task with `Status: Draft`.

## Steps Drift Policy

If during execution you find the original Steps are wrong, incomplete, or based on outdated assumptions:

- **Minor adjustment** (e.g., file path off by one folder, missed import, obvious typo in a Step):
  - Update the Steps in-place
  - Bump `Last Updated`
  - Note the drift in the session log

- **Material change** (different approach, different file set, requires a new decision, expands scope):
  - STOP. Do not implement.
  - Either:
    1. Revise the task → set `Status` back to `Draft` → request human re-approval, OR
    2. Close this task as `Blocked` (or archive it via `deprecation.md` if abandoned), then create a new task with the correct approach.

NEVER silently deviate from approved Steps without recording the drift.
