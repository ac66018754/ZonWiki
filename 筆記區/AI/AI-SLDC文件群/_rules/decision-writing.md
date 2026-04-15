# DECISION WRITING RULES

When making ANY architectural or technical decision, record it.

## File Location
/docs/decisions/YYYY-MM-DD-<topic>.md

## Required Structure

# DECISION: <title>

Last Updated: YYYY-MM-DD

## Context
Why decision is needed

## Options Considered
### Option A: <name>
- Pros
- Cons

### Option B: <name>
- Pros
- Cons

## Decision
Chosen option

## Reason
Why this option was chosen over alternatives

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
