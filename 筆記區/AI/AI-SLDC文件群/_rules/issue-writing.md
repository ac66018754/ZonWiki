# ISSUE WRITING RULES

When encountering an error that meets the threshold below, you MUST create an issue record.

## Threshold (when to create an issue)

Create an issue if ANY of the following is true:

- Production / shipped behavior is wrong
- A user (human, not the AI itself) is affected
- A task is blocked and cannot proceed
- The error reveals a missing constraint or pattern that future work must avoid
- The fix took >15 minutes of investigation
- The error recurs across sessions (even if individually small)

DO NOT create an issue for:

- Typos in your own draft / not-yet-saved content
- Transient AI tool errors that succeeded on retry within the same step
- Lint warnings that you auto-fix in the same edit
- Compile errors fixed within ~1 minute by the same operator without context lookup

When in doubt, lean toward creating one. A trivial issue record is cheaper than a missed pattern.

## File Location
/docs/issues/YYYY-MM-DD-<short-name>.md

## Required Structure

```
# ISSUE: <title>

Last Updated: YYYY-MM-DD
Status: Open | Investigating | Resolved | Won't Fix
Severity: CRITICAL | HIGH | MEDIUM | LOW
Reporter: <human name> | <AI Agent>
Assignee: <human name> | <AI Agent> | <unassigned>
Reproducibility: Always | Sometimes | Once | Cannot Reproduce

## Problem
What happened.

## Context
System state, input, environment.

## Root Cause
Actual cause (NOT symptom).

## Investigation Process
Step-by-step debugging — include what was tried and what didn't work.

## Solution
How it was fixed (include code snippets or config changes if applicable).

## Impact
- Affected components
- User impact

## Time Cost
Time spent on investigation + resolution.

## Prevention
How to avoid in future. If this produces a new rule, add it to `constraints.md`.

## Related
- Task: [title](../tasks/YYYY-MM-DD-xxx.md) — which task was being worked on when this occurred
- Decision: [title](../decisions/YYYY-MM-DD-xxx.md) — if a decision was made to resolve this
- Other Issues: [title](../issues/YYYY-MM-DD-xxx.md) — if related to another issue

## Related Files
List of files involved.
```

## Severity Definitions

| Severity | Meaning |
|---|---|
| CRITICAL | Data loss, security breach, production down, or a task is fully blocked with no workaround |
| HIGH | Major feature broken, partial blocker with painful workaround, security weakness |
| MEDIUM | Minor feature broken, performance regression, code-quality regression |
| LOW | Cosmetic issue, minor inconvenience, low-priority suggestion |

## Status Definitions

| Status | Meaning |
|---|---|
| Open | Reported, not yet being worked on |
| Investigating | Actively being investigated |
| Resolved | Root cause known and fix applied / verified |
| Won't Fix | Acknowledged but not going to fix (with reason); after 30 days, archive per `deprecation.md` |

## Rules
- Severity MUST be filled (no defaults)
- Reporter MUST be filled (the operator that found / surfaced the issue)
- Assignee MAY be `<unassigned>` initially, but MUST be set before status moves to `Investigating`
- Resolved issues stay in `/issues/`; do NOT delete
- `Won't Fix` issues older than 30 days move to `/_archive/issues/` per `deprecation.md`
