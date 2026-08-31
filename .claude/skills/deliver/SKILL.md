---
name: deliver
description: Implement a shipping Adeo product change from a task, ticket, Storybook prototype, or other reference artifact using a bounded token-efficient workflow.
argument-hint: <task-or-reference>
---

`/deliver` means **implement the shipping product**. It is not a design/prototype
editing command.

Optimize for **accepted product change per token**. The LLM is not trusted to
choose its own loop depth, review depth, number of agents, or amount of context.
Runtime limits in `.claude/scripts/delivery.py` are authoritative.

## Non-negotiable target rule

Storybook stories, `/story/...` identifiers, `ui-ux/ux/` concepts, briefs,
decisions, screenshots and mockups supplied to `/deliver` are **read-only
references** unless the user explicitly asks to change the prototype instead of
implementing the product.

Examples:

- `/deliver /story/foo -- this is the prototype` = implement `foo` in the
  shipping app using that story as reference.
- `implement the feature shown in ui-ux/ux/concepts/foo.stories.ts` = production
  implementation; do not edit the story.
- `refine/change/redesign the Storybook concept itself` = not `/deliver`; use
  the product-design workflow explicitly.

Never infer `product-designer` ownership merely because the task mentions
Storybook, UX, prototype, mockup, or `ui-ux/ux/`.

## 1. Start or validate resume state

New delivery:

```text
python3 .claude/scripts/delivery.py start --target production --task "$ARGUMENTS"
```

When the task contains an explicit prototype/story reference, also record it:

```text
--reference '<reference>'
```

For an active delivery, first inspect:

```text
python3 .claude/scripts/delivery.py status --json
```

Before trusting an old handoff, verify all three:

1. `delivery_target == "production"`;
2. `target_consistent == true` when a Change Model exists;
3. the Change Model describes implementation in production paths, not only
   `ui-ux/ux/`, Storybook, briefs or decisions.

If an old delivery treated the prototype/reference as the implementation target,
**do not continue it**. Reset machine truth with `delivery.py retarget`, for
example:

```text
python3 .claude/scripts/delivery.py retarget \
  --target production \
  --task '<actual shipping feature>' \
  --reference '<prototype/story>' \
  --reason 'prototype was reference, not delivery target'
```

Retargeting snapshots the current repository as the new baseline and clears the
stale Change Model, verifier history and handoff so prior prototype work cannot
masquerade as product implementation.

## 2. One production owner before reconnaissance

Ordinary `/deliver` work is owned by `implementer`.

Use `architect` first only for a genuine high-risk architecture/security/
migration/public-contract decision. A `product-designer` is **not an execution
owner for production `/deliver`**.

Claim before the worker reads repository context:

```text
python3 .claude/scripts/delivery.py worker-claim --role implementer --json
```

Then spawn/resume exactly one implementer. The worker performs reconnaissance,
Change Model construction and candidate implementation in the same context.
Do not perform a full orchestrator reconnaissance and ask the worker to repeat
it. Do not fan out multiple agents by default.

## 3. Bounded reconnaissance + Change Model

Inspect only enough code to answer:

- what shipping behavior changes;
- where that behavior lives in production;
- immediate callers/dependencies/state flow;
- relevant domain/contracts/invariants;
- what must not change;
- which deterministic evidence proves the change.

A production Change Model must include:

```json
{
  "target": "production",
  "intent": "Observable shipping capability",
  "current_system": "Relevant current production behavior",
  "domain": "Meaning of the affected concept",
  "flow": ["relevant control/data flow"],
  "invariants": ["rules that must remain true"],
  "implementation_location": ["src/... or other production path"],
  "affected": ["affected production boundaries"],
  "do_not_change": ["unrelated contracts/boundaries"],
  "unknowns": [],
  "risk": "low|medium|high",
  "evidence": ["applicable deterministic checks"],
  "decision_required": false
}
```

The runtime rejects a production Change Model that points only at Storybook/
`ui-ux/ux/` or declares all production sources out of scope.

Record it with:

```text
python3 .claude/scripts/delivery.py model --file /private/tmp/<model>.json
```

## 4. Implement the shipping feature

Implement only the production change required by the Change Model. Prototype/
design artifacts are read-only references. Reuse their intended behavior and
Adeo production components/tokens where applicable; do not "improve" or rewrite
the prototype as a substitute for wiring the feature into the app.

If the user supplied a high-fidelity Storybook prototype, the implementer should
trace how equivalent production UI/state/persistence is actually constructed and
wire the feature into those production paths.

## 5. Deterministic quality before LLM review

The orchestrator runs:

```text
python3 .claude/scripts/delivery.py quality
```

For a production delivery the gate refuses to proceed when:

- no production path changed; or
- `ui-ux/ux/` / Storybook reference artifacts were modified as the candidate.

This is a hard guard against "implemented the prototype instead of the product".

Turn recurring checks into deterministic scripts. Do not repeatedly spend LLM
reasoning on viewport matrices, accessibility matrices, known regressions or
other executable evidence.

## 6. Bounded verification and repair

After deterministic quality passes, use one bounded verifier according to the
runtime budget. The verifier may challenge domain/implementation correctness but
must not expand scope or re-audit unrelated documentation.

If it finds a blocking defect:

```text
same owner -> repair known defect -> quality -> targeted re-check only
```

Do not start a new full audit after each repair. Documentation/cosmetic/fidelity/
maintainability observations are non-blocking. Budget exhaustion transitions to
`NEEDS_HUMAN_REVIEW`; it never grants itself another LLM round.

## 7. Product review means product

`READY_FOR_PRODUCT_REVIEW` is valid only for a candidate that changed the
shipping implementation and passed the production target gate.

The final report should state the actual production paths changed, functional
behavior delivered, deterministic evidence, verifier result and residual risk.
Do not call a Storybook-only concept "implemented product code".
