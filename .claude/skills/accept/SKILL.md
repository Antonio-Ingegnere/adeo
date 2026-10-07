---
name: accept
description: Accept the reviewed V2 candidate through deterministic Switchyard safety checks.
disable-model-invocation: true
---

Use only after the human explicitly accepts the current QA candidate. Read `python3 .claude/scripts/delivery.py status`.
Bind this action to the candidate identity the human reviewed; do not silently substitute a later candidate.
Run `python3 .claude/scripts/delivery.py accept --candidate <reviewed-candidate-identity>` once.
Do not stage or commit anything yourself. Switchyard owns exact-scope staging and the final commit.
Report ACCEPTED or COMMIT_BLOCKED with its reason. No fallback acceptance, cleanup, retry or push.
Legacy work is read-only and cannot be accepted through V2.
