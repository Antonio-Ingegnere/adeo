# Adeo delivery runtime

Goal: maximize accepted production change per token. LLM work is externally bounded.

## Default pipeline

A new `/deliver` starts with one deterministic protocol call:

```text
python3 .claude/scripts/delivery.py begin --task "<task>" --target production --json
```

`begin` atomically creates the delivery and initial implementer claim. Controllers
do not guess `claim` syntax or split initial state creation across multiple turns.

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

Product Designer is a separate standalone workflow and is never the owner of
production `/deliver` work. Invoke it explicitly with `/design <request>`. A terminal
`DONE`/`FAILED` delivery with no stale claims does not block standalone design.

## Model routing

- `/deliver`, `/start`, `/qa-fix`, `/qa-accept`: Haiku controller turns.
- `implementer`: Sonnet, max 32 turns.
- `verifier-lite`: Haiku, low/medium first full review, max 10 turns.
- `verifier`: Sonnet, high-risk first full review only, max 14 turns.
- `verifier-targeted`: Haiku, known repaired defects only, max 6 turns.
- `qa-repairer`: Haiku, first repair of explicit manual-QA defects, max 12 turns.
- `qa-repairer-sonnet`: Sonnet/medium, first human reopen of the same `manual_bug_id`, max 16 turns.
- second reopen of the same bug: stop at `NEEDS_HUMAN_REVIEW`; no third autonomous attempt.
- `/design`: Haiku/low controller for the standalone `product-designer`.
- `product-designer`: Sonnet/medium, writes only under `ui-ux/ux/`.

`delivery.py` computes `verification_route`; `verifier-guard.py` rejects the wrong
agent type before it may read/test the repository.


## Standalone Product Design

Use `/design <request>` to invoke exactly one `product-designer` without creating a
production delivery. `/design prototype <request>` maps directly to Explore mode;
`requirements`, `specify`, `implementation-review`, and `audit` map to the agent's
other defined modes. The skill performs a compact lifecycle preflight and refuses
to run in parallel with an active delivery. `DONE` and `FAILED` are terminal history,
so with no stale worker/verifier claims they are treated like no active delivery by
`delivery-owner-guard.py`. The designer remains confined to `ui-ux/ux/` and cannot
modify production code, tests, dependencies, Git state, or delivery state.

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

Human findings enter through `/qa-fix`; a YAML/JSON file path is supported directly. YAML `bugs` uses `id/status/description/steps` and imports only Open entries, max three defects per batch. `id` is stable QA identity: first report routes to Haiku; reopening the same id routes directly to Sonnet/medium; a second reopen stops automation for a human decision. Human-triggered QA batches are not globally capped; only work inside each batch is bounded. Human-reported visual defects are repair work even when an independent verifier would classify similar polish as non-blocking.

`/qa-accept <note>` is the only normal transition from `READY_FOR_MANUAL_QA` to `DONE`. Acceptance also appends one immutable JSON line to `docs/agent/delivery-metrics.jsonl` with model-pass, QA-batch, reopen and manual-acceptance metrics. The LLM never writes or summarizes this ledger.

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

Machine state: `.claude/delivery/current.json` (ignored by Git). It stores a sparse Git-aware baseline: the start `HEAD` plus hashes only for pre-existing dirty/untracked paths. Clean tracked files, generated UX evidence images, workflow archives and `.claude/` runtime files are not copied into state. Compact `status --json` is normal; `--full` is runtime debugging only. Legacy v1 full-snapshot state is compacted automatically on first load.

High-risk or unresolved decisions stop at `BLOCKED_DECISION` for explicit human
`authorize-high`. Budget exhaustion stops at `NEEDS_HUMAN_REVIEW`. No automatic
second full verifier is permitted.

Storybook/`ui-ux/ux/` supplied to `/deliver` is read-only reference material.
Production delivery cannot become READY without production paths changing and
cannot modify those reference artifacts.


## QA repair bootstrap

`/qa-fix bugs.yaml` may be used even when no active delivery exists. In that case `delivery.py` snapshots the current working tree as the already-tested baseline and starts a QA-only repair delivery directly in `REPAIRING`. It must not run a new full `/deliver`, broad reconnaissance, or full verifier.


## Manual-QA non-convergence escalation

New manual-QA bugs start with Haiku. Before each fresh/resumed Haiku repair, the
controller records `delivery.py qa-attempt`; at most two attempts are allowed per
QA batch. If Haiku returns `ESCALATE_TO_SONNET` or the attempt cap is exhausted,
stop and ask the human to run `/qa-escalate <reason>`. That command is the only
normal route transition from `qa-repairer` to `qa-repairer-sonnet`; never edit
`current.json` directly. Metrics record both `haiku_qa_attempts` and
`qa_escalations_to_sonnet`.

## Git commit and push routing

Git bookkeeping is a Haiku task. Use `/commit`, `/push`, or `/commit-push`; natural-language requests such as `commit and push` should invoke the matching Haiku skill rather than keeping Sonnet on the turn. These skills never use broad staging (`git add .`, `git add -A`) or force-push. With an active delivery they stage only compact `status --json` `changed_paths`, plus the append-only delivery metrics ledger when it belongs to the accepted delivery; unrelated pre-existing working-tree files stay untouched.

## Delivery metrics dashboard

Acceptance metrics remain append-only in `docs/agent/delivery-metrics.jsonl`.
Aggregation is deterministic; the LLM never reads the ledger to calculate the report.

```text
python3 .claude/scripts/delivery.py metrics             # terminal summary
python3 .claude/scripts/delivery.py metrics --json      # machine-readable aggregate
python3 .claude/scripts/delivery.py metrics --html      # regenerate local HTML
python3 .claude/scripts/delivery.py metrics --html --open
```

`/metrics` is a Haiku/low wrapper for the HTML view. The generated dashboard lives
at `.claude/metrics/dashboard.html` and is ignored by Git. It shows accepted-feature
count, expensive reasoning passes, QA-batch average, reopen/escalation rates, a
per-feature trend, distribution, recent deliveries, and threshold-based attention.
Partial records are retained but excluded from averages whenever complete records exist.

## Standalone QA escalation

Explicit human `/qa-fix` batches are not an autonomy budget and therefore do not
stop after three passes. Use `delivery.py qa-history --json` for a compact manual-QA
history. `/qa-escalate` may select a prior `D-...` or `manual_bug_id` directly from
`READY_FOR_MANUAL_QA`, reactivate that defect, and route it to Sonnet/medium without
a fresh `/deliver` or manual `current.json` edits.
