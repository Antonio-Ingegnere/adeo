---
name: repair
description: Start fresh diagnosis for a human-reported bug in the active QA-ready lifecycle.
disable-model-invocation: true
---

Run `python3 .claude/scripts/delivery.py repair --task "<complete bug report>"` once.
If the user supplies a report file, read its contents and pass the report as task text, safely quoted.
The wrapper requires an active QA-ready parent and starts a new FRESH_DIAGNOSIS run.
Do not bootstrap missing lifecycle state, choose providers, or continue an old diagnosis.
Report READY_FOR_MANUAL_QA or NEEDS_HUMAN and stop. Do not automatically retry.
