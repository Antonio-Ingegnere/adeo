---
name: deliver
description: Start feature/bugfix work, explicitly resume an interruption, or roll back a delivery.
disable-model-invocation: true
---

Pass the human's chosen operation to the local wrapper exactly once, with safely
quoted literal input. Never infer feature versus bugfix with a model.

```
python3 .claude/scripts/delivery.py deliver feature "<human request>"
python3 .claude/scripts/delivery.py deliver bugfix "<human bug report>"
python3 .claude/scripts/delivery.py deliver resume
python3 .claude/scripts/delivery.py deliver rollback "<optional reason>"
```

Resume and rollback require the explicit corresponding human command. Never
retry automatically. On INTERRUPTED report the state, reason and recovery flags.
The human may edit only agent timeout before resume. Do not edit pointers, restore
files manually, invent artifacts or bypass a blocked result. Rollback restores the
recorded pre-delivery state, withdraws pending QA, retains history and retires work.
It must refuse active processes, human drift and ACCEPTED work.

Switchyard owns stages, models, capabilities, budgets, recovery and verification.
READY_FOR_MANUAL_QA ends delivery without a commit: report candidate and stop for QA.
Do not start follow-up work automatically. See [setup and recovery](../../../docs/agent/switchyard-delivery.md).
