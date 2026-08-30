---
name: feature
description: Classify and run feature work through Adeo's minimum viable FAST, STANDARD, or FULL SDD workflow.
argument-hint: <start|status|review|approve|escalate|complete> [request="..."] [mode=fast|standard|full] [to=standard|full] [reason="..."]
---

Manage one current feature in `.claude/workflow/current.md` using `$ARGUMENTS`.
Do this work in the current agent. Do not delegate classification or brief
writing to a subagent.

## Actions

- `start` requires a concrete request. Inspect only enough repository evidence
  to identify risk and likely impacted areas. Honor an explicit `mode=`; never
  silently downgrade it. Otherwise classify with the rules below. Refuse to
  overwrite an unfinished current feature without explicit user direction.
- `status` reads and concisely reports the current feature, mode, status,
  blockers, and next action.
- `review` checks whether implementation can safely begin and writes/reports
  the review contract below. Do not optimize prose or request revisions for
  NON-BLOCKING comments.
- `approve` is an explicit human approval event for STANDARD. It may change
  `AWAITING_APPROVAL` to `APPROVED` only when `BLOCKING` is `None.` and readiness
  is `YES`. Invoke this action only from the user's explicit `/feature approve`
  request; never infer or automatically invoke approval. Do not use this action
  for FAST or FULL.
- `escalate` requires `to=` above the current level and a concrete `reason=`.
  Preserve the useful artifact content, add only the newly necessary detail,
  record `Escalated From` and the reason, and set STANDARD to
  `AWAITING_APPROVAL` or FULL to `PLANNING`. Never downgrade.
- `complete` requires implementation, relevant tests, and final review to be
  finished. Set status to `COMPLETED` and keep a concise verification summary.

## Classification

Choose FAST only when all are true: requirements and acceptance are clear; the
change is localized and expected to affect about 1–3 files; existing
architecture is sufficient; regression risk is low; and there is no schema,
migration, external contract, security, architectural, or difficult
compatibility concern.

Choose FULL when any of these materially applies: architectural or
cross-cutting change; migration or major data-model change; external API
contract; security-sensitive behavior; difficult backwards compatibility;
large epic; or significant uncertainty.

Choose STANDARD otherwise. It is the default. Do not invent a numeric score.

## Artifact

Write one file with this shape, omitting optional sections that add no value:

```markdown
# Feature: <short title>

Mode: FAST | STANDARD | FULL
Status: READY | AWAITING_APPROVAL | APPROVED | PLANNING | COMPLETED
Escalated From: None | FAST | STANDARD
Full Plan: None | .claude/plans/active/<id>.md
Approved Snapshot: None | .claude/plans/archive/<approved-revision>.md

## Goal
<required outcome>

## Acceptance Criteria
- ...

## Constraints
- ...

## Likely Impacted Areas
- `path` — reason

## Open Decisions
None.

## Readiness Review
BLOCKING:
None.

NON-BLOCKING:
None.

READY FOR IMPLEMENTATION: YES
```

FAST starts as `READY`. STANDARD starts as `AWAITING_APPROVAL`. FULL starts as
`PLANNING` with both FULL pointers set to `None`; use `/implementation-plan` for
its detailed plan and approval. The Architect synchronizes those two pointer
fields and changes the feature to `APPROVED` in the same action that approves
the FULL plan, so this remains one human gate. An unresolved open decision or
blocking review makes readiness `NO`.

Keep FAST at roughly 40 lines and STANDARD at roughly 100 lines. Link existing
tickets, tests, specs, and decisions rather than duplicating them. Permit at
most one review-driven revision; if a blocker remains, ask the user directly or
escalate. Do not create speculative documents, revision archives, or separate
implementation plans for FAST/STANDARD.

Review output is exactly:

```text
BLOCKING:
1. ... (or None.)

NON-BLOCKING:
1. ... (or None.)

READY FOR IMPLEMENTATION: YES | NO
```

After FAST is `READY`, STANDARD is `APPROVED`, or FULL has an approved immutable
plan, proceed with implementation, tests/fixes, and review without more approval
unless a material ambiguity, destructive action, security decision,
requirements contradiction, out-of-scope architecture decision, or significant
scope expansion is discovered.
