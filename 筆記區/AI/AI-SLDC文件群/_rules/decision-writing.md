# DECISION WRITING RULES

When making ANY architectural or technical decision, record it.

## File Location
/docs/decisions/YYYY-MM-DD-<topic>.md

## Required Structure

```
# DECISION: <title>

Last Updated: YYYY-MM-DD
Status: Proposed | Accepted | Superseded | Deprecated
Decision Maker: <human name> | <AI Agent + human approver name>
Date Decided: YYYY-MM-DD
Reversibility: Easy | Hard | One-Way

## Context
Why this decision is needed.

## Options Considered

### Option A: <name>
- Pros
- Cons

### Option B: <name>
- Pros
- Cons

## Decision
Chosen option.

## Reason
Why this option was chosen over alternatives.

## Consequences
- Pros of chosen option
- Cons / trade-offs accepted

## Rules (IMPORTANT)
Convert decision into actionable rules:

- MUST use ...
- MUST NOT use ...

**Sync requirement:** After writing these rules, you MUST add them to `constraints.md` with a link back to this decision as the source.

## Related
- Task: [title](../tasks/YYYY-MM-DD-xxx.md) — which task triggered this decision
- Issue: [title](../issues/YYYY-MM-DD-xxx.md) — if this decision resolves an issue
- Supersedes: [title](../decisions/YYYY-MM-DD-xxx.md) — if this overrides a previous decision
- Superseded By: [title](../decisions/YYYY-MM-DD-xxx.md) — fill in when a later decision overrides this one (back-reference)
```

## Status Definitions

| Status | Meaning |
|---|---|
| Proposed | Drafted but not yet approved by the human decision maker |
| Accepted | Active and binding — its Rules section governs behavior |
| Superseded | Overridden by a newer decision; old behavior no longer applies. `Superseded By` MUST be filled |
| Deprecated | No longer relevant for any reason other than being superseded (e.g., feature removed). Follow `deprecation.md` for archival |

## Reversibility Definitions

| Level | Meaning |
|---|---|
| Easy | Can be reverted within 1 day; no data migration; no coordination needed |
| Hard | Reverting requires migration, code rewrite, or coordination across multiple modules |
| One-Way | Cannot be reverted without significant data loss, system rebuild, public reputation cost, or breaking API change |

Use `Reversibility` to judge whether a future Supersede is feasible. Decisions marked `One-Way` should require an explicit human sign-off before acceptance.

> **Pause-point reference (autonomy authorization #3 / #4 / #5):** `Proposed → Accepted` is a "wait for human sign-off" pause, split into three independent authorizations by Reversibility:
> - Easy → check item #3 in `docs/AI-Autonomy-Authorization.md`
> - Hard → check item #4
> - One-Way → check item #5 (**strongly recommended to keep at `No` permanently**)
>
> The AI MUST re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md` at this pause. If the matching item is `Yes`, the AI fills `Decision Maker: AI Agent (per autonomy-authorization #N)`, sets `Date Decided` to today, flips Status to `Accepted`, and records this in the session log.

## Rules
- When creating a new decision that supersedes an old one:
  1. Set the new decision's `Supersedes` to the old decision
  2. MUST also update the old decision's `Superseded By` to point to the new decision (back-link)
  3. MUST set the old decision's `Status` to `Superseded`
- A decision with `Status: Deprecated` MUST follow `deprecation.md` for archival
- New rules in the `Rules` section MUST be synced to `constraints.md` immediately
