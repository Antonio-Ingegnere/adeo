---
name: qa-fix
description: Turn up to three explicit human manual-QA findings into a bounded repair; new bugs use Haiku, first reopens use Sonnet medium, then deterministic quality and targeted Haiku re-check.
argument-hint: <bugs.yaml|bugs.yml|bugs.json|1-3 concrete defects>
model: haiku
effort: low
disable-model-invocation: true
---

Use while delivery is `READY_FOR_MANUAL_QA`. If no active delivery exists (for example after a `.claude` replacement, later QA session, or lost runtime state), the `qa-fix` runtime deterministically bootstraps a **QA-only repair delivery** from the current working tree. Do not start a full `/deliver` first.

## File input — preferred

If `$ARGUMENTS` is exactly one readable `.yaml`, `.yml`, or `.json` path, do not
summarize, reinterpret, or convert the file with the LLM. Pass it directly:

```text
python3 .claude/scripts/delivery.py qa-fix --file "$ARGUMENTS"
```

Supported YAML shape:

```yaml
bugs:
  - id: 1
    status: Open
    description: >
      Human-observed problem.
    steps:
      - Reproduction step 1
      - Reproduction step 2
```

Rules are enforced by `delivery.py`: if no active delivery exists, the current working tree becomes the QA baseline and the delivery starts directly in narrow `REPAIRING` mode; no full reconnaissance or full verifier is opened. Only `status: Open` entries are imported,
closed/non-open entries are ignored, and at most three Open bugs are allowed per
batch. Human-triggered QA batches themselves are not capped: every `/qa-fix` is
already an explicit human authorization. `id` is preserved as `manual_bug_id`;
legacy/inline findings without an id receive a deterministic `AUTO-...` identity
so an identical later report can be recognized as a reopen. Optional `category`, `expected`,
`suspected_area`, `evidence`, and `invariant_violated` are accepted. The older
canonical JSON `{"defects": [...]}` form remains supported.

## Inline input

If `$ARGUMENTS` is not a file path, convert only the explicit user text into
`/private/tmp/manual-qa.json` with at most three defects. Each defect has
`expected`, `actual`, optional `reproduction`, `category`, `suspected_area`, and
`evidence`. Do not invent extra defects. Then record it with:

```text
python3 .claude/scripts/delivery.py qa-fix --file /private/tmp/manual-qa.json
```

## Repair flow

After `qa-fix --file`, read compact `delivery.py status --json` and obey its
`qa_repair_route` exactly:

- `qa-repairer` → before **every fresh or resumed Haiku repair invocation**, run
  `python3 .claude/scripts/delivery.py qa-attempt`. The runtime permits at most two
  Haiku attempts for the batch and increments `haiku_qa_attempts` deterministically.
  Then invoke/resume exactly one Haiku `qa-repairer`.
- `qa-repairer-sonnet` → invoke exactly one Sonnet/medium `qa-repairer-sonnet`;
  this means the human reopened a bug with the same `manual_bug_id` after a prior
  repair. Do not run Haiku first on a reopen.

If the Haiku worker on a **new** bug returns `ESCALATE_TO_SONNET`, or two bounded
Haiku attempts fail to converge, **stop**. Do not invoke Sonnet automatically and
do not edit `current.json`. Tell the user to run:

```text
/qa-escalate <short reason>
```

`/qa-escalate` is the explicit human gate that changes the machine route to
`qa-repairer-sonnet`; it does not change the bug's reopen count. A third Haiku
`qa-attempt` is runtime-blocked and moves the delivery to `NEEDS_HUMAN_REVIEW`.

A second human reopen of the same `manual_bug_id` is runtime-blocked and moves
the delivery to `NEEDS_HUMAN_REVIEW`; do not start another autonomous repair.

Then:

1. Run `delivery.py quality`.
2. Invoke `verifier-targeted` only (Haiku). No full verifier is permitted after manual QA.
3. Run `delivery.py report` and stop for the next human QA pass.

## Human-driven batch semantics

Do not refuse a fresh human QA batch because three earlier batches already ran.
The autonomy governors are per batch: max three defects, max two Haiku repair
attempts, and one autonomous reopen of the same stable bug identity. The number
of explicit human `/qa-fix` invocations is a metric, not a hard budget.

If the human says a previously repaired bug is still broken but legacy history
prevents `/qa-fix` from matching it cleanly, use `/qa-escalate this bug`; that
skill resolves compact `qa-history` and can select the legacy `D-...` record
directly from `READY_FOR_MANUAL_QA`. Never recommend editing `current.json`.
