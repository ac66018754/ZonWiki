# AI Autonomy Authorization

> **This is the project-level authorization template.** Copy it to each project's `docs/AI-Autonomy-Authorization.md` and edit per project need.
> Full rules: `docs/_rules/autonomy-authorization.md`.

Last Updated: YYYY-MM-DD
Maintained By: <human name>

## 1. Authorization Items

Each row must hold exactly `Yes` or `No`.
`Yes` = AI may act in the human's role and proceed.
`No` = AI must stop and wait for the human.

| # | Item | Pause Point | Recommended Default | Authorized (Yes/No) |
|---|---|---|---|---|
| 1 | PRD Approval | PRD `Status: Draft → Approved` | No | <fill> |
| 2 | Task Approval | task `Status: Draft → Approved` (with Approved By/Date) | No | <fill> |
| 3 | Decision Approval — Easy | Reversibility = Easy decision `Proposed → Accepted` | Yes (recommended) | <fill> |
| 4 | Decision Approval — Hard | Reversibility = Hard decision `Proposed → Accepted` | No | <fill> |
| 5 | Decision Approval — One-Way | Reversibility = One-Way decision `Proposed → Accepted` | **No (strongly recommended)** | <fill> |
| 6 | Steps Drift (Material change) | demote-to-Draft cycle on material drift | No | <fill> |
| 7 | Schema Change → Dev | green-light before applying to dev | No | <fill> |
| 8 | Schema Change → Prod | sign-off before applying to prod | **No (strongly recommended)** | <fill> |
| 9 | Retrofit Sign-off | overall review after backfill is complete | No | <fill> |
| 10 | Ambiguity / choice required | AI reports "not sure: A or B" | No | <fill> |

## 2. Activation Rules (summary — full text in `_rules/autonomy-authorization.md`)

1. AI must **re-read** this file at every pause point (no caching)
2. Every autonomously handled pause point must leave `AI Agent (per autonomy-authorization #N)` in the corresponding field, and a note in the session log
3. Missing / malformed values = treated as `No`
4. The "Cannot Be Authorized" list (naming rules, DB mock ban, no deletes, mandatory session log, etc.) is enforced even when this file says `Yes`

## 3. Change Log (recommended)

| Date | Item changed | Old → New | Reason |
|---|---|---|---|
| YYYY-MM-DD | #N | Yes → No | <one-line reason> |
