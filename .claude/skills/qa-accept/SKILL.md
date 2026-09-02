---
name: qa-accept
description: Explicitly accept the manually tested delivery and mark it DONE.
argument-hint: <short acceptance note>
model: haiku
effort: low
disable-model-invocation: true
---

Run `python3 .claude/scripts/delivery.py qa-accept --reason "$ARGUMENTS"`. The runtime verifies the candidate, marks `DONE`, and append-only records delivery metrics in `docs/agent/delivery-metrics.jsonl`. Do not inspect or modify code or the metrics file. Report the resulting terminal state only.
