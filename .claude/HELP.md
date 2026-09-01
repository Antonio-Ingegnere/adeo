# Adeo delivery runtime

Goal: maximize accepted production change per token. LLM work is externally bounded.

## Default pipeline

```text
/deliver (Haiku controller)
  → Sonnet implementer: bounded recon + Change Model + production candidate
  → deterministic quality
  → full verifier: Haiku for low/medium, Sonnet for high
  → known blocking repair: Sonnet implementer
  → deterministic quality
  → targeted verifier: Haiku only
  → READY_FOR_MANUAL_QA
  → human exploratory UI QA
     → /qa-fix: new bug → Haiku narrow repair; first reopen → Sonnet/medium narrow repair
       → quality → Haiku targeted recheck
     → /qa-accept: DONE
```

Product Designer is a separate workflow and is not changed or used as the owner of
production `/deliver` work.

## Model routing

- `/deliver`, `/start`, `/qa-fix`, `/qa-accept`: Haiku controller turns.
- `implementer`: Sonnet, max 32 turns.
- `verifier-lite`: Haiku, low/medium first full review, max 10 turns.
- `verifier`: Sonnet, high-risk first full review only, max 14 turns.
- `verifier-targeted`: Haiku, known repaired defects only, max 6 turns.
- `qa-repairer`: Haiku, first repair of explicit manual-QA defects, max 12 turns.
- `qa-repairer-sonnet`: Sonnet/medium, first human reopen of the same `manual_bug_id`, max 16 turns.
- second reopen of the same bug: stop at `NEEDS_HUMAN_REVIEW`; no third autonomous attempt.
- `product-designer`: unchanged.

`delivery.py` computes `verification_route`; `verifier-guard.py` rejects the wrong
agent type before it may read/test the repository.

## Deterministic evidence

`delivery.py quality` owns reusable proof. Change Models may declare up to five
safe `feature_checks`:

- `node scripts/*-selftest.mjs`
- `python3 scripts/*-selftest.py`
- `npm run test:<name>`

Changed `scripts/*-selftest.{mjs,py}` are discovered automatically. Production UI
changes also select the isolated Electron baseline check. Prefer one focused
real-app smoke journey for critical UI behavior; manual QA owns visual polish,
clipping, overlay placement, scrolling completeness and interaction feel.

## Manual QA

Verifier PASS is **not product acceptance**. It transitions to
`READY_FOR_MANUAL_QA`. `delivery.py report` presents the package and stops.

Human findings enter through `/qa-fix`; a YAML/JSON file path is supported directly. YAML `bugs` uses `id/status/description/steps` and imports only Open entries, max three defects per batch. `id` is stable QA identity: first report routes to Haiku; reopening the same id routes directly to Sonnet/medium; a second reopen stops automation for a human decision. The ordinary cap of three **new-defect** QA batches does not block a first reopen. Human-reported visual defects are repair work even when an independent verifier would classify similar polish as non-blocking.

`/qa-accept <note>` is the only normal transition from `READY_FOR_MANUAL_QA` to
`DONE`.

## Handoff / limit recovery

Normal limit recovery needs no LLM handoff:

```text
limit/reset → new session → /start
```

Optional checkpoint is deterministic:

```text
python3 .claude/scripts/delivery.py checkpoint --reason "usage limit"
```

`/handoff` is only a cheap forked-Haiku wrapper around that command. Never invoke
it automatically at a context percentage.

## State rules

Machine state: `.claude/delivery/current.json` (ignored by Git). Compact
`status --json` is normal; `--full` is runtime debugging only.

High-risk or unresolved decisions stop at `BLOCKED_DECISION` for explicit human
`authorize-high`. Budget exhaustion stops at `NEEDS_HUMAN_REVIEW`. No automatic
second full verifier is permitted.

Storybook/`ui-ux/ux/` supplied to `/deliver` is read-only reference material.
Production delivery cannot become READY without production paths changing and
cannot modify those reference artifacts.


## QA repair bootstrap

`/qa-fix bugs.yaml` may be used even when no active delivery exists. In that case `delivery.py` snapshots the current working tree as the already-tested baseline and starts a QA-only repair delivery directly in `REPAIRING`. It must not run a new full `/deliver`, broad reconnaissance, or full verifier.
