# Exceptional high-risk implementation plans

This revisioned lifecycle is only for durable high-risk work identified by
`/deliver` and routed through `/feature mode=full`. Ordinary delivery must not
create plan history here. Do not manually replace `current.md` with a new plan.

## Commands

```text
/implementation-plan start spec=spec/ui/<spec>.md [plan=<id>]
/implementation-plan update plan=<id> request="<change>"
/implementation-plan status [plan=<id>]
/implementation-plan approve plan=<id>
/implementation-plan archive plan=<id> outcome=implemented|cancelled|superseded
/implementation-plan list
```

## Storage

- `current.md` is a pointer to the selected plan after the first lifecycle
  mutation. A legacy full plan in this file is migrated before replacement.
- `active/<plan-id>.md` is the living plan.
- `archive/<plan-id>-rNNN-<event>.md` is a complete immutable snapshot.

Every active plan has an append-only Decision Log and Revision Log. Updating an
approved plan returns it to draft and requires a new explicit approval. The
`/deliver` orchestrator records the immutable approved snapshot through
`delivery.py authorize-high`; the implementer proceeds only while that reference
is present in machine delivery state.

Create the durable specification and architecture/plan before requesting the
one human approval. Do not add separate approval gates for research,
specification, and planning.
