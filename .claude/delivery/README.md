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

Production `/deliver` has one worker claim: `implementer`. Product Designer is not
a production execution owner. Both manual-QA repairers claim the same implementer
role so existing mutation guards remain authoritative; `implementer-guard.py` also
enforces the machine-selected `qa_repair_route` by subagent type.

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

`qa-fix --file` accepts JSON or YAML (`bugs:`, `id/status/description/steps`) and imports up to three Open human defects. `manual_bug_id` is stable across human QA passes. A new id routes to Haiku `qa-repairer`; the first reopen of an existing id routes directly to Sonnet/medium `qa-repairer-sonnet`; a second reopen hard-stops at `NEEDS_HUMAN_REVIEW`. No full verifier is reopened. At most three new-defect QA batches are automated, while one first-reopen repair is still allowed after that cap.

`qa-accept --reason` verifies the repository still matches the verifier receipt and
then records `DONE`.

## Resume and checkpoint

`/start` reconstructs work from compact state and Git summaries. A checkpoint is
optional and generated deterministically with `delivery.py checkpoint`; it is not
an LLM summary and contains only execution-critical state.


## QA repair bootstrap

`/qa-fix bugs.yaml` may be used even when no active delivery exists. In that case `delivery.py` snapshots the current working tree as the already-tested baseline and starts a QA-only repair delivery directly in `REPAIRING`. It must not run a new full `/deliver`, broad reconnaissance, or full verifier.
