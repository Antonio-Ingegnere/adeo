---
name: handoff
description: Inspect the current Switchyard lifecycle without resuming execution.
disable-model-invocation: true
---

Run `python3 .claude/scripts/delivery.py status` and `git status --short`. Report the current terminal. Do not resume an interrupted run, create receipts, or mutate state. See [recovery](../../../docs/agent/switchyard-delivery.md).
