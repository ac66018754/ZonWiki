# SESSION LOG WRITING RULES

`current-state.md` is a snapshot of the present.
**Session logs are the history.** Without them, "what happened over the last three days" is unrecoverable.

Every work session (human or AI) MUST end with a session log entry.

## File Location
/docs/session-logs/YYYY-MM-DD-HHmm.md

One file per session. Append-only as a folder — never overwrite an existing log.

## When to Create
- At the END of every work session, before signing off
- If a session is interrupted (timeout, crash, hard stop), still create the entry as far as you got — losing history is worse than incomplete history
- Even a "did nothing useful" session gets a log (one line in `Worked On` is fine)

## Required Structure

```
# SESSION LOG — YYYY-MM-DD HHmm

Last Updated: YYYY-MM-DD HH:mm
Operator: <human name> | <AI Agent (model)>
Session Started: YYYY-MM-DD HH:mm
Session Ended: YYYY-MM-DD HH:mm
Branch: <git branch name>
Starting Commit: <short hash>
Ending Commit: <short hash> | <no new commit>

## Worked On
- [Task name](../tasks/YYYY-MM-DD-xxx.md) — what was advanced (which Steps completed, brief summary)
- Files touched: list (use repo-relative paths)

## Decisions Made
- [Decision name](../decisions/YYYY-MM-DD-xxx.md) — one-line summary, or "none"

## Issues Encountered
- [Issue name](../issues/YYYY-MM-DD-xxx.md) — Severity — current Status, or "none"

## Schema Changes
- [Schema change name](../schema-changes/YYYY-MM-DD-xxx.md) — Status, or "none"

## Verification Run
- Commands actually executed (e.g., `dotnet test`, `pnpm lint`, `pnpm build`)
- Result (pass / fail / counts / coverage)
- "skipped — reason" is acceptable but discouraged

## Uncommitted Work
- List dirty files NOT yet committed (or "clean")
- Reason for not committing (e.g., "WIP — not compilable yet", "waiting on review")

## Next Session Should
1. Concrete next action — include the exact command if possible (e.g., `dotnet ef migrations add AddCommentTable`)
2. ...

## Handoff Notes
Free-text notes for whoever picks up next:
- Surprises encountered
- Decisions deferred
- Things that almost broke
- Context that does not fit elsewhere
```

## Rules
- One log file per session — do NOT overwrite existing logs
- File naming uses session START time
- If branch was switched mid-session, note the switch and final branch in `Handoff Notes`
- Session logs are append-only history — never edit a past log to "fix" it; record corrections in the next session's log
- After writing the log, `current-state.md` MUST also be updated to reflect new state (the log is per-session; current-state is cumulative)
- A session log without `Next Session Should` filled is an incomplete log
