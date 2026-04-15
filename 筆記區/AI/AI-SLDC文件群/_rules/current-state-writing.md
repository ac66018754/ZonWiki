# CURRENT-STATE WRITING RULES

This is the MOST IMPORTANT handover document.
When someone (human or AI) loses context, this is the FIRST file to read.

## File Location
/docs/current-state.md

## Update Triggers
- After ANY task is completed
- After ANY blocker is discovered or resolved
- After ANY decision that changes project direction
- At the END of every work session

## Required Structure

# PROJECT CURRENT STATE

Last Updated: YYYY-MM-DD HH:mm
Updated By: <name or "AI Agent">

## Phase
Current phase: Planning | Development | Testing | Staging | Production

## In Progress
- [ ] [Task name](../tasks/YYYY-MM-DD-xxx.md) — brief status note

## Blockers
- [Issue name](../issues/YYYY-MM-DD-xxx.md) — why it blocks progress

## Recently Completed
- [Task name](../tasks/YYYY-MM-DD-xxx.md) — completed YYYY-MM-DD

## Next Steps
1. What should be done next (link to task if exists)
2. ...

## Key Decisions
- [Decision name](../decisions/YYYY-MM-DD-xxx.md) — one-line summary

## Known Risks
- Risk description — mitigation plan or link to issue

## Rules
- MUST be updated at the end of every work session
- MUST link to actual task/issue/decision files, not just describe them
- MUST remove completed items from "In Progress" and move to "Recently Completed"
- MUST keep "Recently Completed" to last 10 items only (archive older ones)
- If this file is stale (>3 days without update), treat it as a CRITICAL issue
