# Machine-owned delivery lifecycle

States:

```text
UNDERSTANDING → IMPLEMENTING → VERIFYING
                      ↑            │
                      └─ REPAIRING ─┘
                                   ↓
                        READY_FOR_MANUAL_QA
                          │               │
                      /qa-fix         /qa-accept
                          │               ↓
                       REPAIRING          DONE
```

High-risk/unknown work may stop at `BLOCKED_DECISION`. Exhausted bounded resources
stop at `NEEDS_HUMAN_REVIEW`. `FAILED` is terminal.

## Ownership

Production `/deliver` has one worker claim: `implementer`. A new delivery uses one
atomic controller call, `delivery.py begin --task "..." --target production --json`,
which creates `UNDERSTANDING` state and the initial implementer claim together. The
controller must not split this into guessed `start`/`claim` calls. Low-level `start`
remains only for backwards compatibility and tests.

Product Designer is not a production execution owner. Both manual-QA repairers
claim the same implementer role so existing mutation guards remain authoritative;
`implementer-guard.py` also enforces the machine-selected `qa_repair_route` by
subagent type.

## Verification route

`delivery.py status --json` exposes `verification_route` while VERIFYING:

| Mode/risk | Agent | Model |
|---|---|---|
| full low/medium | `verifier-lite` | Haiku |
| full high | `verifier` | Sonnet |
| targeted any risk | `verifier-targeted` | Haiku |

The PreToolUse verifier guard checks the subagent `agent_type` and rejects any
route mismatch.

## Quality gate

Quality runs before every verifier. It includes repository diff checks, inferred
project checks, Change Model evidence, and safe feature-specific commands. A
verifier should not rerun recorded PASS commands without a concrete evidence gap.

UI production changes select the isolated Electron baseline check. Feature-specific
real-app journeys should be encoded as deterministic self-tests and declared in
`feature_checks` rather than repeatedly explored by an LLM.

## Manual QA

Independent verification establishes engineering confidence, not visual/product
acceptance. PASS → `READY_FOR_MANUAL_QA`.

`qa-fix --file` accepts JSON or YAML (`bugs:`, `id/status/description/steps`) and imports up to three Open human defects. `manual_bug_id` is stable across human QA passes; legacy/inline findings without an explicit id receive a deterministic `AUTO-...` identity. A new id routes to Haiku `qa-repairer`; the first reopen of an existing id routes directly to Sonnet/medium `qa-repairer-sonnet`; a second reopen hard-stops at `NEEDS_HUMAN_REVIEW`. No full verifier is reopened. Human-triggered QA batches are not globally capped. Each batch is bounded to three Open defects, two Haiku attempts, and one autonomous reopen per stable bug identity.

`qa-accept --reason` verifies the repository still matches the verifier receipt, appends one deterministic record to `docs/agent/delivery-metrics.jsonl`, and then records `DONE`. The JSONL file is append-only and intended to be committed with accepted changes.

## Resume and checkpoint

`/start` reconstructs work from compact state and Git summaries. A checkpoint is
optional and generated deterministically with `delivery.py checkpoint`; it is not
an LLM summary and contains only execution-critical state.


## QA repair bootstrap

`/qa-fix bugs.yaml` may be used even when no active delivery exists. In that case `delivery.py` snapshots the current working tree as the already-tested baseline and starts a QA-only repair delivery directly in `REPAIRING`. It must not run a new full `/deliver`, broad reconnaissance, or full verifier.

## Sparse repository baseline

`current.json` does not mirror the repository. The baseline is `{head, dirty}`: Git `HEAD` represents every clean tracked file and `dirty` stores only pre-existing modified/deleted/untracked path state. Candidate paths and fingerprints are derived on demand from Git plus that sparse map. Generated UX evidence images, `.claude/` runtime files, delivery metrics, and Claude archive ZIPs are excluded from candidate accounting. Legacy v1 full hash maps are compacted on first load.

## Delivery metrics

On manual acceptance the runtime appends one JSONL record to `docs/agent/delivery-metrics.jsonl`. It tracks `sonnet_implementation_passes`, `sonnet_full_verifier_passes`, `sonnet_reopen_passes`, `haiku_agent_passes`, `qa_batches`, `reopens`, `expensive_reasoning_passes`, risk, timestamps and acceptance. Metrics from a migrated v1 delivery are marked `metrics_partial=true`; new v2 deliveries are complete.


### Haiku QA attempt and escalation accounting

Every new/resumed `qa-repairer` invocation must first call `delivery.py qa-attempt`.
The runtime caps a batch at two Haiku attempts. A third request moves the delivery
to `NEEDS_HUMAN_REVIEW`. Human `/qa-escalate <reason>` runs
`delivery.py qa-escalate --reason ...`, clears the stale worker lease, switches
`qa_repair_route` to `qa-repairer-sonnet`, and increments
`qa_escalations_to_sonnet`. It is not a reopen and does not alter reopen count.
The append-only accepted-delivery metrics also include `haiku_qa_attempts`.

## Commit/push

After manual acceptance, Git bookkeeping is intentionally cheap: `/commit`, `/push`, and `/commit-push` run on Haiku. They use explicit delivery-owned paths from compact delivery status, may include the append-only `docs/agent/delivery-metrics.jsonl` acceptance record, and never broad-stage or force-push.

## Metrics view (v3.5)

`docs/agent/delivery-metrics.jsonl` remains the append-only source of truth. Use
`delivery.py metrics` for a terminal report or `delivery.py metrics --html --open`
for the generated local dashboard. No LLM is used for aggregation. Generated HTML
is disposable and ignored at `.claude/metrics/dashboard.html`.

### v3.6 standalone QA semantics

Human-triggered `/qa-fix` batches are unlimited as a count; this is not autonomous
looping because every batch requires explicit human input. Per-batch governors remain:
max three defects, max two Haiku attempts, and one autonomous reopen per stable bug.
Legacy manual-QA records are backfilled with deterministic `AUTO-...` identities.
`qa-history --json` exposes only compact manual defect history, and human
`qa-escalate --defect-id D-...` or `--manual-bug-id ...` may reactivate a prior bug
straight from `READY_FOR_MANUAL_QA` for bounded Sonnet/medium structural repair.
