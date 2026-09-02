---
name: handoff
description: Cheap explicit checkpoint wrapper. Normal limit recovery should use /start without a handoff.
argument-hint: '[reason]'
model: haiku
effort: low
context: fork
agent: general-purpose
background: false
disable-model-invocation: true
---

Do not summarize conversation history or inspect repository files.
Run exactly:

```text
python3 .claude/scripts/delivery.py checkpoint --reason "$ARGUMENTS"
```

Return only the command result plus: `After reset, run /start.`

For zero-LLM cost, the user can run the same `delivery.py checkpoint` command
directly in the shell. A checkpoint is optional because `/start` resumes from
machine state without it.
