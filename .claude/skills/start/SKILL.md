---
name: start
description: Resume an active /deliver lifecycle from machine state without trusting stale handoff intent.
argument-hint: '[task=<short-name>]'
disable-model-invocation: true
---

Resume machine-owned delivery; do not reconstruct conversation history.

1. Run `python3 .claude/scripts/delivery.py status --json`.
2. Inspect `git status --short`, `git diff --stat`, and `git diff --name-only`.
3. Before reading the handoff, validate delivery intent:
   - `/deliver` target must be `production`;
   - `target_consistent` must be true when a Change Model exists;
   - production implementation locations must not be only Storybook/`ui-ux/ux/`.
4. If an old handoff/model targeted a prototype that was merely supplied as a
   reference, **do not resume it**. Use `delivery.py retarget --target production`
   with the actual shipping task/reference, then restart from `UNDERSTANDING`.
5. Otherwise read only the original task, compact Change Model, open structured
   defects and latest bounded handoff. Load only the exact `read_first` paths or
   smallest affected production subset.

Do not initially load old transcripts, archived plans, whole source trees or
complete logs.

State handling:

- `UNDERSTANDING`: production `/deliver` → claim `implementer`; `architect` only
  for genuine high-risk decisions. Never claim `product-designer` merely because
  a Storybook prototype is referenced.
- `BLOCKED_DECISION`: ask only the genuine decision / complete authorization.
- `IMPLEMENTING` / `REPAIRING`: resume the existing single owner when valid; for
  production delivery the implementation owner is `implementer`.
- `VERIFYING`: invoke only the runtime-authorized verifier mode.
- `NEEDS_HUMAN_REVIEW`: stop autonomous work.
- `READY_FOR_PRODUCT_REVIEW`: run `delivery.py report`, but only after target
  consistency and production-path quality checks have passed.

Repository reality and the explicit shipping intent beat a stale handoff.
