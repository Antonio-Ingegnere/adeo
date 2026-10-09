---
name: qa-fix
description: Preserve the implementation and record human QA feedback through V2 reopen.
disable-model-invocation: true
---

Follow [/reopen](../reopen/SKILL.md) to bind the human's feedback to the displayed
candidate and record REOPENED. No provider or commit runs during reopen. Report the
durable feedback and stop; a subsequent corrective delivery is a new human decision.
Do not use the old REPAIR preset. `/deliver rollback` instead discards the current
attempt and restores its recorded pre-delivery state; never substitute it for QA feedback.
