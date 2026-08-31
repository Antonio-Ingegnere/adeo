# Adeo autonomous delivery

Normal entry point:

```text
/deliver <task>
```

The workflow is optimized for **accepted product change per token**. LLMs are
not trusted to decide their own loop depth, review breadth, or amount of fresh
context. Expensive work is externally bounded by the delivery runtime.

## Delivery shape

```text
task
→ choose one execution owner
→ bounded reconnaissance + Change Model
→ implementation candidate
→ deterministic quality gate
→ one bounded full verifier
→ repair named blockers if needed
→ targeted re-check of those blockers only
→ READY_FOR_PRODUCT_REVIEW
```

If runtime budgets are exhausted, or targeted repair verification notices a new
blocker, the task moves to:

```text
NEEDS_HUMAN_REVIEW
```

No automatic next verifier round is allowed from there.

## Target and one-owner rule

`/deliver` always targets the shipping product. Storybook `/story/...`,
`ui-ux/ux/` concepts, briefs, decisions, screenshots and mockups supplied to
`/deliver` are read-only references. Editing/refining those artifacts is a
separate product-design workflow, not a production delivery.

Route before broad reconnaissance:

- ordinary production implementation → `implementer`;
- high-risk architecture/security/migration/public-contract decision →
  `architect`, then `implementer`;
- `product-designer` is never the execution owner for production `/deliver`.

A stale handoff cannot override this target. `status --json` exposes
`delivery_target` and `target_consistent`; if an old Change Model targets a
prototype that was only a reference, use `delivery.py retarget` instead of
continuing it.

The selected owner performs reconnaissance, Change Model construction and the
candidate in the same context. The orchestrator must not do a full recon and
then pay another agent to repeat it. Do not send work to an agent whose guard
forbids the target path and then relay its prose to a second agent.

Before spawning a delivery owner, record exactly one `worker-claim` for the
phase. Implementer/product-designer read hooks reject repository context before
that claim, so a wrongly routed second agent fails before it can spend a full
reconnaissance pass.

Codex is explicit opt-in only.

## Machine-owned lifecycle

`.claude/delivery/current.json` is modified only by
`.claude/scripts/delivery.py`.

```text
UNDERSTANDING
BLOCKED_DECISION
IMPLEMENTING
VERIFYING
REPAIRING
NEEDS_HUMAN_REVIEW
READY_FOR_PRODUCT_REVIEW
FAILED
```

Useful commands:

```text
python3 .claude/scripts/delivery.py status --json
python3 .claude/scripts/delivery.py retarget --target production --task '<shipping task>' --reference '<prototype>' --reason '<why>'
python3 .claude/scripts/delivery.py worker-claim --role <role> --json
npm run quality:delivery
python3 .claude/scripts/delivery.py verifier-claim --json
python3 .claude/scripts/delivery.py report
```


`status --json` is deliberately compact: it omits baseline hashes, closed defect
history and full verifier receipts so routine resume/agent prompts do not ingest
machine-owned history. `status --full --json` exists only for runtime debugging.

`READY_FOR_PRODUCT_REVIEW` requires matching quality + verifier fingerprints.
Any repository change after readiness invalidates those receipts.

## Change Model

Reconnaissance is mandatory but bounded. The transient Change Model stores only
execution-critical knowledge:

- observable intent;
- relevant current behavior/domain ownership;
- short data/control flow;
- important invariants;
- implementation location;
- affected areas;
- explicit non-change boundaries;
- unresolved decisions;
- risk and deterministic evidence IDs.

The runtime caps the Change Model at 8 KB and list sizes at eight entries.
Persistent specifications are reserved for durable business rules, contracts,
state models, persistence/security semantics and architecture decisions.

## Deterministic quality first

`npm run quality:delivery` derives checks from changed paths plus Change Model
evidence. Known checks include:

```text
git diff --check + direct checks for changed untracked text files
npm run build
npm run test:workflow
node scripts/query-selftest.mjs
node scripts/shortcuts-selftest.mjs
npm run test:isolation
npm run test:quick-add
npm run check:ux-boundary
npm run storybook:build
```

The cheap deterministic layer should own repeatable matrices. An LLM should not
manually walk 64 axe combinations, every viewport/theme fixture, or the same
keyboard path again after it can be encoded as a script/test.

## Verifier policy

The verifier is Sonnet/medium, read-only, and must claim runtime budget before
investigating:

```text
python3 .claude/scripts/delivery.py verifier-claim --json
```

### Full mode

Exactly one full verifier per delivery. It is limited to:

- at most 3 high-value adversarial scenarios;
- at most 3 blocking root-cause defects;
- no manual Cartesian verification matrices;
- no re-running already-green deterministic checks without concrete reason;
- no broad docs/comments/fidelity audit.

Blocking severities are functional correctness, meaningful accessibility,
security, data loss, contract and regression failures.

Documentation, cosmetic, fidelity and maintainability findings are
non-blocking observations unless the task itself is documentation or an
executable/public contract. They cannot create repair loops.

### Targeted mode

After a repair + green quality gate, verification is **targeted**. It may only
reproduce the existing repaired blocking defect IDs. It must not search for new
edge cases or re-audit the product.

If it notices a genuinely new blocking issue while reproducing an old one, the
runtime stops at `NEEDS_HUMAN_REVIEW` instead of creating another autonomous
round.

## Hard budgets

| Risk | Full verifier | Targeted verifier | Repair candidates |
| --- | ---: | ---: | ---: |
| LOW | 1 | 1 | 2 |
| MEDIUM | 1 | 2 | 3 |
| HIGH | 1 | 2 | 3 |

There is deliberately no "repeat while progress is being made" rule.

`NEEDS_HUMAN_REVIEW` is a hard autonomous stop. If the user explicitly chooses
one more bounded repair attempt, record that choice with `delivery.py
resume-human --reason "..."`. A human extension may add only a small number of
repair/targeted-verifier slots and never grants another full verifier.

## Agent guidance

### Implementer

- Sonnet/medium.
- Read task + Change Model once.
- On repair, read/fix only open blocking defects.
- Do not opportunistically clean docs/comments/neighboring code.
- Convert verifier reproductions into deterministic regression evidence when
  practical.

### Product designer

- Sonnet/medium.
- Read only mode-relevant UX rules, not the entire UX corpus each invocation.
- `/deliver` repair: read named blockers + touched files + directly relevant
  rule only.
- Manual rendering budget is normally <=4 representative state/view/theme
  combinations; broader matrices belong in deterministic checks.
- Codex delegation only when the user explicitly asks for Codex.

### Architect

Opus/high remains available only for exceptional high-risk durable decisions.
It is not a default planning step.

## High-risk durable decisions

Legacy SDD remains only for decisions worth preserving:

```text
/feature start mode=full request="Describe the durable decision"
/implementation-plan start spec=<path> [plan=<id>]
/implementation-plan approve plan=<id>
python3 .claude/scripts/delivery.py authorize-high \
  --reference .claude/plans/archive/<approved-revision>.md
```

Do not create routine FAST/STANDARD artifacts or readiness-review documents.

## Fresh-session continuation

```text
/handoff reason=context|pause|stage|model-switch
/clear <short-task-name>
/start
```

Handoffs are execution checkpoints, not new documentation. Runtime validation
limits them to a few concise items and <=5 KB total. Do not paste diffs, logs or
complete prior narratives into a handoff.

## Product review package

Final output should contain:

- product behavior implemented;
- affected system areas / preserved contracts;
- deterministic checks actually passed;
- blocking verifier defects repaired;
- recent non-blocking observations/residual risk;
- diff size and useful preview/runnable evidence.

Do not narrate agent choreography or celebrate completion of the process.

## Core invariants

- Never trust an LLM to choose unlimited LLM work.
- Never repeat broad reconnaissance in another agent.
- Never let non-blocking findings create a new LLM round.
- Never launch a fresh full verifier after repair.
- Fresh context is an expense; use it once where independence matters.
- Prefer scripts/tests over repeated LLM reasoning.
- Stop when runtime says `NEEDS_HUMAN_REVIEW`.
