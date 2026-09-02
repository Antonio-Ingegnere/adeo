---
name: feature
description: Deprecated compatibility alias for the removed SDD feature workflow. Never creates specs or plans.
model: haiku
effort: low
disable-model-invocation: true
argument-hint: '[legacy arguments ignored]'
---

# Deprecated compatibility alias

The old FAST/STANDARD/FULL `/feature` workflow is removed.

Do **not** create a specification, approval artifact, plan, or subagent. Do not
restore `.claude/plans`, `spec-owner`, or `architect` machinery.

- If there is no active delivery, tell the user to use `/deliver <task>`.
- If the active `/deliver` is `BLOCKED_DECISION`, surface only the unresolved
  decision from `delivery.py status --json`. After explicit user approval,
  continue with `delivery.py authorize-high --reason '<approved decision>'`.
- Otherwise continue the active `/deliver` lifecycle.

This alias exists only so stale repository instructions cannot resurrect the old
SDD runtime.
