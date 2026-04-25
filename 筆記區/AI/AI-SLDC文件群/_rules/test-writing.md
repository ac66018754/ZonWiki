# TEST WRITING RULES

This project follows the global testing rule (80%+ coverage minimum, TDD where applicable).
This file specifies how test work is documented and how test status is tracked.

## When to Create a Test Document

Create a test document if ANY of:
- The task involves new logic, new endpoint, new integration, or schema change → test plan REQUIRED before implementation (TDD)
- A bug fix landed without a regression test → backfill a test plan after the fix to lock the behavior
- A flaky test was investigated → record the analysis even if no test code changed

DO NOT create a test document for:
- Pure formatting / typo fixes
- Comment-only changes
- Documentation changes that don't touch code

## File Location
/docs/tests/YYYY-MM-DD-<short-name>.md

## Required Structure

```
# TEST: <name>

Last Updated: YYYY-MM-DD
Status: Planned | RED | GREEN | Stable
Linked Task: [title](../tasks/YYYY-MM-DD-xxx.md)

## Scope
What is being tested.
What is explicitly NOT being tested (out of scope).

## Test Types Used
- [ ] Unit
- [ ] Integration (DB-touching tests MUST hit a real DB — see project rule)
- [ ] E2E

## Test Cases
| ID | Behavior | Type | Expected | Status |
|----|----------|------|----------|--------|
| T1 | Returns 200 when category exists | Integration | 200 + body shape X | RED → GREEN |
| T2 | Returns 404 when category missing | Integration | 404 + envelope error | RED → GREEN |

## Coverage Target
- Module / file: target % (project default: 80%)
- Critical paths: 100% if applicable

## Run Commands
- Exact command(s) to execute these tests
- Exact command to read coverage

## Verification Done On
- YYYY-MM-DD HH:mm — operator — pass count / fail count / coverage % — recorded in [session log](../session-logs/YYYY-MM-DD-HHmm.md)

## Related
- Task: [title](../tasks/YYYY-MM-DD-xxx.md)
- Issue: [title](../issues/YYYY-MM-DD-xxx.md) — if test was added to prevent recurrence
- Schema Change: [title](../schema-changes/YYYY-MM-DD-xxx.md) — if test verifies a migration
```

## Status Definitions

| Status | Meaning |
|---|---|
| Planned | Test cases listed but no code written |
| RED | Test code written and failing as expected (no implementation yet) |
| GREEN | Implementation done, tests passing |
| Stable | Tests passed in ≥1 subsequent session log without flake |

## Rules
- Status flow: `Planned → RED → GREEN → Stable`
- A test that flakes counts as `RED` until consecutive passes are confirmed — do NOT mark `Stable` prematurely
- DB-touching tests MUST use a real DB (Testcontainers or equivalent). MUST NOT mock the DB.
- Coverage drop below project minimum (80%) MUST be flagged in `current-state.md` `Blockers`
- A test that was deleted MUST be archived per `deprecation.md` (do not silently remove regression coverage)
