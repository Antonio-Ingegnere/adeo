---
name: deliver
description: Run one Switchyard delivery and stop for human manual QA.
disable-model-invocation: true
---

Run `python3 .claude/scripts/delivery.py deliver --task "<complete user task>"` once.
Pass the task literally using safe argument quoting. Do not interpolate task text as shell code.
Switchyard owns all analysis, implementation, deterministic verification and the one repair attempt.
Do not spawn legacy agents, run a second workflow, or declare success from prose.
Report the terminal, correlation and run IDs. READY_FOR_MANUAL_QA requires external human testing.
NEEDS_REDIAGNOSIS means stop. Active/legacy lifecycle errors mean stop without overwriting state.
See [setup and recovery](../../../docs/agent/switchyard-delivery.md).
