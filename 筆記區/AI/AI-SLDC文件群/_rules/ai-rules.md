# AI GLOBAL RULES

## Documentation First (CRITICAL)
- ALL work must start from documentation
- If no document → CREATE one first
- MUST NOT write any code before a task document exists

## Issue Handling
- Any error → MUST create issue record
- Issue MUST link to related task via `## Related` section

## Decision Handling
- Any important choice → MUST create decision record
- Decision rules MUST be synced to constraints.md

## Task Handling
- Any feature → MUST generate tasks first
- Task MUST link to related issues/decisions via `## Related` section

## Update Rules
- After task complete:
  - Update current-state.md
  - Update task status
  - Check if related documents are still accurate
- After decision made:
  - Update constraints.md with new rules from decision
- At session end:
  - Update current-state.md (MANDATORY, even if incomplete)

## Last Updated Requirement
- Every document MUST include `Last Updated: YYYY-MM-DD` at the top
- If a document's Last Updated is >7 days old AND the related area has changed, flag it for review

## Cross-Reference Requirement
- Every task, issue, and decision MUST have a `## Related` section
- Use relative links: `[title](../tasks/YYYY-MM-DD-xxx.md)`
- Orphan documents (no links to/from anything) are a sign of process failure

## Forbidden
- DO NOT skip documentation
- DO NOT implement directly without a task
- DO NOT end a session without updating current-state.md
- DO NOT create a decision without syncing rules to constraints.md
