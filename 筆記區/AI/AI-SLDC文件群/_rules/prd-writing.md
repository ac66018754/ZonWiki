# PRD WRITING RULES

Before ANY task can be created, the project MUST have a PRD (Product Requirements Document).
The PRD is the single source of truth for "what are we building and why".

## File Location
/docs/prd.md

## When to Create
- At project start, BEFORE generating any tasks
- When a major scope change occurs (create a new version, keep the old one for reference)

## Required Structure

# PRD: <Project Name>

Last Updated: YYYY-MM-DD
Version: 1.0
Status: Draft | In Review | Approved

## Background
Why does this project exist? What problem are we solving?

## Goals
- Goal 1 (measurable)
- Goal 2 (measurable)

## Non-Goals
- What this project explicitly does NOT do

## Target Users
Who will use this? What are their needs?

## Requirements

### Functional Requirements
| ID | Requirement | Priority (Must/Should/Nice) |
|----|-------------|----------------------------|
| F1 | ... | Must |
| F2 | ... | Should |

### Non-Functional Requirements
| ID | Requirement | Target |
|----|-------------|--------|
| NF1 | Performance | Response < 200ms |
| NF2 | Availability | 99.9% uptime |

## Tech Stack
- Language / framework / database choices (link to decision records if they exist)

## Acceptance Criteria
High-level checklist for the ENTIRE project (not individual tasks):
- [ ] Criterion 1
- [ ] Criterion 2

This is what the human reviewer uses during final manual verification.

## Out of Scope
Anything explicitly excluded from this version

## Related
- Decisions: [title](decisions/YYYY-MM-DD-xxx.md)
- External references: links to Figma, Slack threads, client emails, etc.

## Rules
- PRD MUST be created before any task is generated
- PRD MUST have Status: Approved before development begins
- Tasks MUST trace back to a requirement ID in this PRD
- If a requirement changes, update the PRD first, then update affected tasks

## Pause-Point Reference (Autonomy Authorization #1)

`Status: Draft → Approved` is a "wait for human" pause.
At this pause, the AI MUST re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md`.
If item #1 is `Yes`, the AI flips `Status` to `Approved`, appends `Approved By: AI Agent (per autonomy-authorization #1) on YYYY-MM-DD` to the bottom of the file, and records this in the session log.
