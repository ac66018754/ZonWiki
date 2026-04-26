# SCHEMA CHANGE WRITING RULES

Every DB schema change MUST produce a record. This is independent of the task that triggered it.
Schema changes can outlive a single task and need their own audit trail.

## File Location
/docs/schema-changes/YYYY-MM-DD-<short-name>.md

## When to Create
- Adding / removing / renaming a table or column
- Index changes (add, drop, alter)
- Constraint changes (FK, unique, check, default)
- Migration that reshapes existing data

## Required Structure

```
# SCHEMA CHANGE: <name>

Last Updated: YYYY-MM-DD
Status: Planned | Applied (Dev) | Applied (Prod) | Reverted
Migration File: src/.../Migrations/<MigrationName>.cs (or equivalent)

## Reason
Why this change is needed. Link to task / decision.

## Tables Affected
- TableName — added | modified | removed | renamed

## Columns Affected
| Table | Column | Change | Notes |
|-------|--------|--------|-------|
| Article | Article_PublishedDateTime | added | nullable, no default |

## Indexes / Constraints Affected
- IndexName / ConstraintName — added | modified | dropped — purpose

## Naming Compliance Check
- [ ] Table name is PascalCase, contains NO underscores
- [ ] Each new column follows `{Table}_{Field}` PascalCase
- [ ] Each new column has exactly ONE underscore (the separator)
- [ ] All six audit fields present, OR exemption justified below

## Audit Field Exemption (only if applicable)
Reason for not including the six standard audit fields.

## Migration Commands
- Up: `dotnet ef migrations add <Name>` then `dotnet ef database update`
- Down (rollback): `dotnet ef database update <PreviousMigration>`

## Data Migration
Describe any data backfill, and whether it is idempotent.
"None" is an acceptable answer.

## Rollback Plan
Exact steps to revert if this breaks production. Include data preservation strategy.
If rollback is impossible (One-Way), state so explicitly and link the supporting decision.

## Applied On
- Dev: YYYY-MM-DD HH:mm — by whom
- Prod: YYYY-MM-DD HH:mm — by whom — or "not yet applied"

## Related
- Task: [title](../tasks/YYYY-MM-DD-xxx.md)
- Decision: [title](../decisions/YYYY-MM-DD-xxx.md)
- Tests: [title](../tests/YYYY-MM-DD-xxx.md) — tests proving the migration is safe
- Issue: [title](../issues/YYYY-MM-DD-xxx.md) — if schema change was triggered by an issue
```

## Status Definitions

| Status | Meaning |
|---|---|
| Planned | Record exists, migration not yet generated or applied |
| Applied (Dev) | Migration applied to development DB |
| Applied (Prod) | Migration applied to production DB |
| Reverted | Migration was rolled back; record stays for history. A new schema-change record describes the corrective change |

## Rules
- MUST verify naming compliance before status moves past `Planned`
- MUST NOT skip the six standard audit fields without explicit justification in `Audit Field Exemption`
- MUST keep migration files in source control alongside this record (link via `Migration File`)
- Reverted records are NOT deleted — set `Status: Reverted` and create a new schema-change record for the corrective change
- Naming rules come from the global CLAUDE.md DB schema standard — that document overrides any local convention

## Pause-Point Reference (Autonomy Authorization #7 / #8)

This flow has two "wait for human" pauses, each with its own authorization item:

| Pause | Trigger | Maps to |
|---|---|---|
| Before applying to dev | After `Status: Planned` passes naming compliance, before generating the migration | #7 |
| Before applying to prod | Between `Status: Applied (Dev)` and `Applied (Prod)` | #8 (**strongly recommended to stay `No`**) |

At each pause, the AI MUST re-read `docs/AI-Autonomy-Authorization.md` per `autonomy-authorization.md`.
If the matching item is `Yes`, the AI proceeds and fills the corresponding `Applied On` row with `AI Agent (per autonomy-authorization #7)` or `#8` plus a timestamp, and records this in the session log.
**Naming compliance failures CANNOT be bypassed** — that's an "uncannot-be-authorized" item, regardless of whether #7 / #8 is `Yes`.
