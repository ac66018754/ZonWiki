# AI AUTONOMY AUTHORIZATION RULES

This rule defines how the AI decides — at any pause point that originally required a human — whether it may act on the human's behalf, by reading the **project-local authorization file**.

## Authorization File Location

`/docs/AI-Autonomy-Authorization.md`

Maintained by the human, **NOT** under `_rules/` (`_rules/` holds rules, the authorization file is a project-level decision).
Template lives at the master root: `AI-Autonomy-Authorization-template.md`.

## When to Read the Authorization File

EVERY time the AI hits a pause point defined by this system, the AI **MUST immediately re-read `docs/AI-Autonomy-Authorization.md`** before deciding to stop or proceed.
**Caching is forbidden. The AI MUST NOT rely on a value read earlier in the same session** — the human may have changed it between two consecutive pause points.

The full pause-point list is in the table below.

## Authorization Interpretation Rules

After reading `docs/AI-Autonomy-Authorization.md`:

1. Find the row matching the pause point
2. Read the `Authorized` column
3. Interpret:

| Cell value | AI behavior |
|---|---|
| `Yes` | AI proceeds and acts in the human's role |
| `No` | AI stops and waits for the human |
| Missing / not exactly `Yes` or `No` | Treat as `No` (fail-safe) |
| File does not exist | Every item is `No` |

## Audit Footprint when AI Acts Autonomously (MANDATORY)

When the AI proceeds because authorization is `Yes`, it MUST fill the following fields:

| Document | Field | Value |
|---|---|---|
| Task | `Approved By` | `AI Agent (per autonomy-authorization #<n>)` |
| Task | `Approved Date` | today's date |
| Decision | `Decision Maker` | `AI Agent (per autonomy-authorization #<n>)` |
| Decision | `Date Decided` | today's date |
| Schema Change `Applied On` | Dev / Prod | `AI Agent (per autonomy-authorization #<n>)` + timestamp |
| PRD | `Status` | set directly to `Approved`, append `Approved By: AI Agent (per autonomy-authorization #1) on YYYY-MM-DD` to the bottom |
| Session log | `Worked On` section | MUST note "X pause points handled autonomously this session (per authorization #N, #M)" |

This keeps the human able to distinguish later what was their own approval vs AI autonomy, and makes it possible to retrace responsibility if the authorization turns out to have been wrong.

## Pause-Point Table

| # | Name | Trigger (rule source) | Action authorized to AI |
|---|---|---|---|
| 1 | PRD Approval | `prd-writing.md` Rules — PRD `Status: Approved` is required before development | flip PRD `Status: Draft → Approved` |
| 2 | Task Approval | `task-writing.md` Status Transitions — `Draft → Approved` requires human Approved By/Date | flip task `Status: Draft → Approved` and fill By/Date |
| 3 | Decision Approval — Easy | `decision-writing.md` Reversibility = Easy | flip decision `Status: Proposed → Accepted` |
| 4 | Decision Approval — Hard | `decision-writing.md` Reversibility = Hard | flip decision `Status: Proposed → Accepted` |
| 5 | Decision Approval — One-Way | `decision-writing.md` Reversibility = One-Way | flip decision `Status: Proposed → Accepted` |
| 6 | Steps Drift (Material change) | `task-writing.md` Steps Drift Policy, second branch | revise Steps, demote task to `Draft`, then re-approve autonomously; OR decide to migrate to a new task |
| 7 | Schema Change → Dev | `WORKFLOW.md` Scenario E step 5 (review before applying to dev) | green-light dev migration |
| 8 | Schema Change → Prod | `WORKFLOW.md` Scenario E step 8 (sign-off before prod) | green-light prod migration |
| 9 | Retrofit Sign-off | `retrofit-guide.md` Step 11 | promote all backfilled Draft documents to Approved / Accepted / Done autonomously |
| 10 | Ambiguity / choice required | `WORKFLOW.md` "When You MUST Step In" row 5 | pick one of several reasonable options autonomously, recording rationale in the session log |

> The "Action authorized to AI" column is bounded by what the human originally had to do. The AI MUST NOT do more, and MUST NOT do less.

## Items That CANNOT Be Authorized (always paused / always enforced)

These are hard red lines, **outside the authorization scope**:

- Naming rules in the global `~/.claude/CLAUDE.md` (PascalCase tables, `{Table}_{Field}` columns, six audit fields)
- Mocking the DB in DB-touching tests — must use real DB (Testcontainers)
- Deleting historical documents — must follow `deprecation.md` archival
- Ending a session without writing a session log / updating `current-state.md`
- Ignoring an error that meets the threshold in `issue-writing.md`
- Failing to sync a decision's `Rules` to `constraints.md`
- Silently deviating from approved Steps (the Steps Drift Policy must always run; only the "Material re-approval" step is authorizable, not the silent deviation itself)

## Enforcement

- CRITICAL: at every pause point, **re-read** `docs/AI-Autonomy-Authorization.md`. NEVER reuse a value read earlier in the same session.
- CRITICAL: every autonomously handled pause point **MUST** leave the audit footprint above.
- CRITICAL: missing / malformed authorization file → treat all items as `No`. NEVER guess.
- CRITICAL: items in "Cannot Be Authorized" stay paused / enforced **even if the file says Yes**.
