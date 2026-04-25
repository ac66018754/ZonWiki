# GLOSSARY WRITING RULES

This file defines how to maintain `glossary.md` — a per-project file of terms with project-specific meaning.
AI MUST consult the project's `glossary.md` before using ambiguous terms.

## File Location
/docs/glossary.md

## Required Structure (template for the project's glossary.md)

```
# PROJECT GLOSSARY

Last Updated: YYYY-MM-DD

## Core AI-SLDC Terms

### Phase
Project lifecycle phase. One of: Planning | Development | Testing | Staging | Production.
Source: current-state-writing.md

### Approved
A document state. For tasks: a human reviewer wrote their name in `Approved By` and the date in `Approved Date`. AI MUST NOT execute work for any task that is not `Status: Approved`.
Source: task-writing.md, claude.md

### Done
A task whose Definition of Done is fully met AND whose Verification command(s) were actually executed AND whose result was recorded in a session log.
Source: task-writing.md

### In Progress
A task currently being executed by a single operator. If interrupted, MUST be reflected in `current-state.md` `In Progress` and the most recent session log.
Source: task-writing.md

### Blocker
An unresolved issue (`Status: Open` or `Investigating`) that prevents an `In Progress` task from advancing. MUST appear in `current-state.md` `Blockers` while live.
Source: current-state-writing.md, task-writing.md

### Operator
The single entity responsible for advancing work in a session — either a named human or a named AI Agent. The operator is the writer of the session log.
Source: session-log-writing.md

### Reversibility (of a decision)
How hard it would be to undo a decision: Easy / Hard / One-Way.
Source: decision-writing.md

## Project-Specific Terms

(Add domain terms here as they appear in the project. Examples below are illustrative.)

### <Term>
1–3 sentence definition.
Source: <link to where this term is canonically defined or used>
```

## Rules
- Add a term the FIRST time AI encounters ambiguity using it
- Each term entry: 1–3 sentence definition + a `Source:` link to where it is canonically used
- If two regions of the codebase use the same word for different things, document BOTH meanings with disambiguation
- A term whose meaning changed: do NOT silently overwrite. Keep the old meaning labelled `Deprecated YYYY-MM-DD` and add the new meaning below it
- A term that no longer applies: keep it in the glossary marked `Deprecated YYYY-MM-DD` (do not remove — historical docs may still reference it)
- Glossary updates do NOT require a decision record, but if the term shift was caused by a decision, link that decision in `Source:`
