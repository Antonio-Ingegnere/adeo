# Autonomous delivery runtime

`/deliver` stores transient machine state in `current.json`. The runtime is
owned by `.claude/scripts/delivery.py`; agents may not promote themselves to
ready or decide to spend unlimited verification/repair work.

State machine:

```text
UNDERSTANDING
→ BLOCKED_DECISION (genuine/high-risk decision only)
→ IMPLEMENTING
→ VERIFYING (full, once)
→ REPAIRING
→ VERIFYING (targeted repair check only)
→ READY_FOR_PRODUCT_REVIEW

Any exhausted budget or new blocker discovered during targeted verification
→ NEEDS_HUMAN_REVIEW
```

`FAILED` remains available for an explicit terminal failure.


## Production target

`/deliver` is a shipping-product workflow. Storybook `/story/...`, `ui-ux/ux/`
concepts, briefs, decisions, screenshots and mockups are read-only reference
artifacts. They cannot satisfy a production delivery.

Machine state records `delivery_target` and the Change Model records matching
`target`. For production delivery, `quality` requires at least one production
path change and rejects candidate changes to `ui-ux/ux/` / Storybook references.
A stale handoff/model that treated the prototype as the target must be reset with
`delivery.py retarget`; do not continue it.

## Single execution owner

Before a production implementation/architecture subagent is spawned, the
orchestrator records exactly one owner:

```text
python3 .claude/scripts/delivery.py worker-claim --role implementer --json
python3 .claude/scripts/delivery.py worker-claim --role architect --json
```

`product-designer` is not a production `/deliver` owner. Only one owner command is used for a phase. A different second role is
rejected. Delivery-aware read hooks require the claim before repository context
is loaded, preventing an incorrectly routed second agent from performing a
duplicate reconnaissance pass.


## Compact status

Routine agents use `delivery.py status --json`. It intentionally omits baseline
hashes, closed defect history and complete verifier receipts. Use
`delivery.py status --full --json` only when debugging the runtime itself; do not
feed it to ordinary implementation or verification agents.

## Hard budgets

The runtime enforces finite LLM work:

| Risk | Full verifier | Targeted verifier | Repair candidates |
| --- | ---: | ---: | ---: |
| low | 1 | 1 | 2 |
| medium | 1 | 2 | 3 |
| high | 1 | 2 | 3 |

A verifier must claim budget before doing work:

```text
python3 .claude/scripts/delivery.py verifier-claim --json
```

The first claim is `full`; after a repair + green quality gate it is
`targeted`. Targeted verification may only re-check existing repaired blocking
defects. It is not another broad adversarial review.

Documentation, cosmetic, fidelity and maintainability findings are non-blocking
observations unless the task itself is documentation or an executable/public
contract. They cannot create an autonomous repair loop.

A new blocker noticed during targeted verification moves the task to
`NEEDS_HUMAN_REVIEW` instead of creating a new defect → repair → verifier
cycle.

`NEEDS_HUMAN_REVIEW` is not an invitation to retry automatically. After an
explicit user decision, `resume-human` may grant a small bounded extension of
repair/targeted-verifier budget; it never grants another full verifier.

## Readiness

`READY_FOR_PRODUCT_REVIEW` requires:

- a passing deterministic quality receipt;
- a verifier receipt for the identical repository fingerprint;
- no unresolved blocking verifier defect in the allowed bounded workflow.

Any repository change after readiness invalidates the receipts and returns the
delivery to repair.

Durable specs/plans remain exceptional tools for high-risk product,
architecture, security, persistence, migration and public-contract decisions.
Ordinary execution state stays transient.
