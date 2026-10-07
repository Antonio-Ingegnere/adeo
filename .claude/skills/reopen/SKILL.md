---
name: reopen
description: Record human QA feedback without committing or starting another provider run.
disable-model-invocation: true
---

Read `python3 .claude/scripts/delivery.py status` and bind the human feedback to the reviewed candidate identity.
Run once:
```
python3 .claude/scripts/delivery.py reopen --candidate <reviewed-candidate-identity> --feedback "<literal human feedback>"
```
Report REOPENED. Worktree and HEAD are preserved; feedback remains durable.
Do not automatically launch a repair. A later explicit `/deliver bugfix` is a new work item;
its human request may include the stored feedback displayed by status, never old provider transcripts.
