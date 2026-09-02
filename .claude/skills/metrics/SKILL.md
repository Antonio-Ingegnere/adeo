---
name: metrics
description: View the deterministic delivery-efficiency dashboard built from the append-only delivery metrics ledger. Use only when the user explicitly asks to view delivery metrics, report, dashboard, or workflow efficiency.
argument-hint: [terminal|json]
model: haiku
effort: low
disable-model-invocation: true
---

This skill is a thin UI entry point. Do not read or summarize the JSONL ledger with the LLM.
The deterministic runtime owns aggregation and rendering.

- Default `/metrics`: run exactly:

```text
python3 .claude/scripts/delivery.py metrics --html --open
```

- `/metrics terminal`: run exactly:

```text
python3 .claude/scripts/delivery.py metrics
```

- `/metrics json`: run exactly:

```text
python3 .claude/scripts/delivery.py metrics --json
```

Do not modify `docs/agent/delivery-metrics.jsonl`. The generated HTML is disposable
and must stay untracked at `.claude/metrics/dashboard.html`.
