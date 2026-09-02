---
name: qa-escalate
description: Human-authorized escalation of a manual-QA bug to a narrow Sonnet/medium repair, including non-converging Haiku batches and legacy/standalone bugs already back at manual QA.
argument-hint: [bug=D-003|id=<manual-id>] [attempts=N] <reason for escalation>
model: haiku
effort: low
disable-model-invocation: true
---

Use only when the user explicitly invokes `/qa-escalate`. This is a human gate;
never synthesize or invoke it autonomously.

There are two supported cases.

## A. Active Haiku repair did not converge

If compact status shows `qa_repair_route=qa-repairer`, run the existing escalation
without a bug selector. If `$ARGUMENTS` begins with explicit `attempts=N`, use it
only as a human-provided backfill for attempts that happened before accounting;
never invent a number.

```text
python3 .claude/scripts/delivery.py qa-escalate --reason "<reason>"
```

or with explicit backfill:

```text
python3 .claude/scripts/delivery.py qa-escalate \
  --observed-haiku-attempts N \
  --reason "<reason>"
```

## B. Human says a previously repaired bug is still broken

This is valid directly from `READY_FOR_MANUAL_QA`; an active Haiku route is not
required. Do **not** start a fresh `/deliver` merely because the QA batch ended.

1. Run the compact, deterministic history projection:

```text
python3 .claude/scripts/delivery.py qa-history --json
```

2. Resolve the bug the human is referring to from the conversation and that
   compact history. Prefer the internal `D-...` defect id when the prior context
   already names it. A stable YAML/manual id may be used instead. Do not read or
   hand-edit `current.json`.
3. Escalate exactly that bug:

```text
python3 .claude/scripts/delivery.py qa-escalate \
  --defect-id D-003 \
  --reason "<reason>"
```

or:

```text
python3 .claude/scripts/delivery.py qa-escalate \
  --manual-bug-id "<id>" \
  --reason "<reason>"
```

If the history is genuinely ambiguous, stop and show the user the small set of
candidate ids instead of guessing.

## After the state transition

Read compact `delivery.py status --json`. Require:

```text
state=REPAIRING
qa_repair_route=qa-repairer-sonnet
```

Invoke exactly one `qa-repairer-sonnet` (Sonnet/medium) on the selected/open
manual-QA defect(s) and existing findings. Do not repeat broad reconnaissance.
The Sonnet repairer may make a structural correction inside the defect's product
surface (for example extracting a clipped menu into a fixed/portal popover) when
that is the root-cause fix; human escalation is the authorization for that
bounded structural repair. It is still not permission for unrelated redesign.

If the worker reports `NEEDS_HUMAN_DECISION`, stop. Otherwise run
`delivery.py quality`, invoke only `verifier-targeted` (Haiku), run
`delivery.py report`, and return to human manual QA.

Never edit `.claude/delivery/current.json` directly. Never open a full verifier.
