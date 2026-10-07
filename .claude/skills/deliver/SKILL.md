---
name: deliver
description: Start explicit feature or bugfix work through frozen Switchyard V2.
disable-model-invocation: true
---

The human chooses `feature` or `bugfix`; never infer the kind using a model. If omitted, ask for that choice.
Run once with safely quoted literal input:
```
python3 .claude/scripts/delivery.py deliver --kind <feature|bugfix> --task "<complete human request>"
```
Switchyard owns stages, provider selection, capabilities, escalation and verification.
Report the terminal and candidate identity. READY_FOR_MANUAL_QA ends delivery without a commit;
the candidate is stored in persistent external Adeo data. Stop for human QA.
Never manufacture a MicroSpec, handoff or diagnosis, automatically retry, or resume legacy work.
See [setup and recovery](../../../docs/agent/switchyard-delivery.md).
