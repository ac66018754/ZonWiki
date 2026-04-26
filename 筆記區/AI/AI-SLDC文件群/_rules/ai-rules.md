# AI GLOBAL RULES

## Documentation First (CRITICAL)
- ALL work must start from documentation
- If no document → CREATE one first
- MUST NOT write any code before an Approved task document exists

## Rules Discovery
- The full list of writing rules lives in `claude.md` under "Rules Index"
- When unsure how to write a document, consult the matching rule file in `/docs/_rules/`
- Never invent your own document format

## Issue Handling
- Errors that meet the threshold in `issue-writing.md` → MUST create issue record
- Issue MUST link to related task via `## Related` section
- Issue MUST have a `Severity` value

## Decision Handling
- Any important architectural / technical choice → MUST create decision record
- Decision rules MUST be synced to `constraints.md`
- Decisions overriding old ones MUST update BOTH files (Supersedes + Superseded By back-link)

## Task Handling
- Any feature → MUST generate tasks first
- Task MUST link to a PRD requirement ID and to related issues / decisions via `## Related` section
- Tasks MUST be `Status: Approved` before any code is written. The Approved source can be (a) a human filling `Approved By` + `Approved Date`, OR (b) the AI itself filling them per `autonomy-authorization.md` when item #2 in `docs/AI-Autonomy-Authorization.md` is `Yes` (AI must re-read that file at this exact moment)

## Pause Points & Autonomy Authorization
- At every "wait for human" pause point → MUST re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md`, then decide stop vs. proceed
- NEVER cache; NEVER reuse a value read earlier in this session
- Every autonomously handled pause point MUST fill `AI Agent (per autonomy-authorization #N)` in the corresponding document field, and note it in the session log
- Authorization file missing / malformed / not exactly `Yes` or `No` → treat the matching item as `No`

## Schema Change Handling
- Any DB schema change → MUST create record per `schema-change-writing.md` BEFORE running the migration
- Naming compliance check MUST pass

## Test Handling
- TDD where applicable: write tests first per `test-writing.md`
- DB-touching tests MUST use real DB (no mocks)

## Deprecation
- Expired docs MUST be archived per `deprecation.md` — never deleted
- Superseded decisions MUST update both old and new doc with back-links

## Update Rules
- After task complete:
  - Update `current-state.md`
  - Update task `Status`
  - Check if related documents are still accurate
- After decision made:
  - Update `constraints.md` with new rules from decision
- At session end:
  - Update `current-state.md` (MANDATORY, even if incomplete)
  - Append a session log entry per `session-log-writing.md` (MANDATORY)

## Last Updated Requirement
- Every document MUST include `Last Updated: YYYY-MM-DD` at the top
- If a document's Last Updated is >7 days old AND the related area has changed, flag it for review

## Cross-Reference Requirement
- Every task, issue, and decision MUST have a `## Related` section
- Use relative links: `[title](../tasks/YYYY-MM-DD-xxx.md)`
- Orphan documents (no links to/from anything) are a sign of process failure

## Glossary Requirement
- Before using a term whose meaning could be ambiguous in this project, consult `glossary.md`
- If the term is missing, add it before continuing

## Forbidden
- DO NOT skip documentation
- DO NOT implement directly without an Approved task
- DO NOT end a session without updating `current-state.md` AND writing a session log
- DO NOT create a decision without syncing rules to `constraints.md`
- DO NOT delete historical docs — archive per `deprecation.md`
- DO NOT silently deviate from a task's approved Steps — follow the Steps Drift Policy
- DO NOT decide on stop-vs-proceed at a pause point without re-reading `docs/AI-Autonomy-Authorization.md` — follow `autonomy-authorization.md`
