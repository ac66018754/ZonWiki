# DEPRECATION & ARCHIVAL RULES

Expired tasks, decisions, constraints, issues, and other docs MUST be archived — never deleted.
History is the most important asset of this system.

## When to Deprecate

| Trigger | Action |
|---|---|
| A decision is overridden by a newer one | Old decision `Status: Superseded`, fill `Superseded By` (see `decision-writing.md`). After it is fully out of effect, archive |
| A decision is no longer relevant for any other reason (feature removed, scope dropped) | `Status: Deprecated`, archive |
| A task is no longer needed (PRD changed, approach abandoned) | Set `Status` to indicate abandonment in a Deprecation Note, then archive |
| A constraint no longer applies | Mark deprecated in `constraints.md` with strikethrough and link to the superseding decision |
| An issue marked `Won't Fix` is older than 30 days | Archive |
| A test was deleted (regression coverage removed) | Archive the test record with reason |

## Folder Layout

- Active docs: stay in their original folder (e.g., `/docs/decisions/`, `/docs/tasks/`)
- Archived docs: move to `/docs/_archive/<original-folder-name>/<original-filename>.md`
  - Original filename preserved
  - At top of file, add a `Deprecation Note` block (defined below) above the original content

## Required Top-of-File Block on Archived Docs

Prepend this block to the file BEFORE the original content:

```
> # DEPRECATED — <original title>
>
> Status: Deprecated | Superseded | Archived
> Deprecated On: YYYY-MM-DD
> Deprecated By: <human name>
> Reason: <one paragraph — what changed in the world that made this no longer apply>
> Superseded By: [title](../../decisions/YYYY-MM-DD-xxx.md) — if applicable, otherwise omit
>
> --- (original content unchanged below) ---
```

The original content of the file MUST be left unchanged below the block.

## Constraints File Special Case

`constraints.md` is a single living file, not a folder of records. Deprecated constraints stay in place using strikethrough format:

```
- ~~Old constraint text~~ — Deprecated YYYY-MM-DD, see [decision](decisions/YYYY-MM-DD-xxx.md)
```

This preserves visibility of past rules without polluting the active list.

## Updating Cross-References

When archiving a doc:
- Update incoming links from active docs to point at the new `/_archive/` path
- Update `current-state.md` if the deprecated doc was referenced there
- A doc may have BOTH `Superseded By` link and an archive entry — both are required when applicable

## Rules
- MUST NOT delete any historical doc — including failed experiments, abandoned tasks, withdrawn decisions
- MUST preserve original filename when archiving (so existing references still resolve after path adjustment)
- MUST update incoming links when archiving
- MUST update `current-state.md` if it referenced the deprecated doc
- Deprecation does NOT itself trigger an issue record; only create an issue if the deprecation revealed a bug or pattern worth preventing
- Archived docs are read-only history — do not edit them after archival except to fix broken outgoing links
