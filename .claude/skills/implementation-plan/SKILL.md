---
name: implementation-plan
description: Deprecated compatibility alias. The old implementation-plan lifecycle is removed.
model: haiku
effort: low
disable-model-invocation: true
argument-hint: '[legacy arguments ignored]'
---

# Deprecated compatibility alias

Do not create or approve an implementation-plan artifact. The old Architect,
revisioned plans, immutable snapshots, and plan approval workflow are removed.

Use the active `/deliver` Change Model as the only bounded implementation model.
If a genuine high-risk decision is unresolved, `/deliver` must stop at
`BLOCKED_DECISION` until the user explicitly authorizes it; then the same
implementation flow continues.
