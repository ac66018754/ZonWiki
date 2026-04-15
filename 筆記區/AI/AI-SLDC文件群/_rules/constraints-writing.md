# CONSTRAINTS WRITING RULES

Constraints are non-negotiable rules that apply across the entire project.
They come from decisions, architecture choices, or external requirements.

## File Location
/docs/constraints.md

## Update Triggers
- After a decision record is created (check its "Rules" section)
- When external requirements change (legal, compliance, client requests)
- When a recurring issue reveals a missing constraint

## Required Structure

# PROJECT CONSTRAINTS

Last Updated: YYYY-MM-DD

## Technical Constraints
- Constraint — [Source: decision/issue link]

## Business Constraints
- Constraint — [Source: who decided, when]

## Convention Constraints
- Naming, formatting, or workflow rules — [Source]

## Rules
- Every constraint MUST have a source (link to decision, issue, or external requirement)
- When a decision's "Rules" section produces new constraints, they MUST be added here
- Constraints MUST NOT contradict each other — if conflict found, create a new decision record to resolve
- Review this file when starting any new feature to avoid violating existing constraints
